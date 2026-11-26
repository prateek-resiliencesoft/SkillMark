// Recording rescue tool for one interview session. Runs INSIDE the app
// container with the app's own env (S3_* / STORAGE_DIR); Node built-ins only,
// so it works with any app image. Secrets are never printed.
//
// Pipe it in from the repo checkout (no copy into the image needed):
//   docker compose -f docker-compose.prod.yml exec -T app node --input-type=module - <command> ... < scripts/recording-rescue.mjs
//
// Commands
//   list <prefix>                         READ-ONLY. Objects under a key prefix in the bucket and on disk,
//                                         plus a per-session/run summary of recording parts.
//   head <objectKey>                      READ-ONLY. Is this exact object in the bucket / on disk (size, type)?
//   rebuild <sessionId> <recordingsPrefix> [--write] [--target=local|s3]
//                                         Without --write: READ-ONLY dry run (which parts, gaps, output key).
//                                         With --write: WRITES a new file
//                                           <recordingsPrefix>/recording-<sessionId>-rebuilt.<ext>
//                                         (never overwrites anything; refuses if it exists), then prints the
//                                         SQL to link it. target=local (default) writes to STORAGE_DIR,
//                                         target=s3 uploads to the bucket.
import { createHash, createHmac } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(1).filter((a, i) => !(i === 0 && (a === "-" || a.endsWith(".mjs"))));
const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
const [cmd, ...args] = argv.filter((a) => !a.startsWith("--"));

const first = (...v) => v.map((x) => x?.trim()).find(Boolean) ?? "";
const env = process.env;
const accountId = first(env.R2_ACCOUNT_ID);
const S3 = {
  endpoint: first(env.S3_ENDPOINT, env.B2_ENDPOINT, env.R2_ENDPOINT, accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "").replace(/\/+$/, ""),
  bucket: first(env.S3_BUCKET, env.B2_BUCKET, env.R2_BUCKET),
  region: first(env.S3_REGION, env.B2_REGION) || "auto",
  id: first(env.S3_ACCESS_KEY_ID, env.B2_KEY_ID, env.R2_ACCESS_KEY_ID),
  secret: first(env.S3_SECRET_ACCESS_KEY, env.B2_APPLICATION_KEY, env.R2_SECRET_ACCESS_KEY),
};
const hasS3 = !!(S3.endpoint && S3.bucket && S3.id && S3.secret);
const STORAGE_DIR = path.resolve(env.STORAGE_DIR || "./storage");

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha = (d) => createHash("sha256").update(d).digest("hex");
const hm = (k, d) => createHmac("sha256", k).update(d).digest();

function sign(method, key, query = {}, extra = {}, body = "") {
  const u = new URL(S3.endpoint);
  const uri = `${u.pathname.replace(/\/+$/, "")}/${enc(S3.bucket)}${key ? "/" + key.replace(/^\/+/, "").split("/").map(enc).join("/") : ""}`;
  const q = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&");
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amz.slice(0, 8);
  const ph = sha(body);
  const h = { host: u.host, "x-amz-content-sha256": ph, "x-amz-date": amz, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), String(v)])) };
  const names = Object.keys(h).sort();
  const creq = [method, uri, q, names.map((n) => `${n}:${h[n].trim()}\n`).join(""), names.join(";"), ph].join("\n");
  const scope = `${day}/${S3.region}/s3/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", amz, scope, sha(creq)].join("\n");
  const kS = hm(hm(hm(hm(`AWS4${S3.secret}`, day), S3.region), "s3"), "aws4_request");
  h.authorization = `AWS4-HMAC-SHA256 Credential=${S3.id}/${scope}, SignedHeaders=${names.join(";")}, Signature=${createHmac("sha256", kS).update(sts).digest("hex")}`;
  delete h.host;
  return { url: `${u.origin}${uri}${q ? "?" + q : ""}`, headers: h };
}

async function s3List(prefix) {
  if (!hasS3) return [];
  const out = [];
  let token = null;
  do {
    const query = { "list-type": "2", prefix, "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const r = sign("GET", null, query);
    const res = await fetch(r.url, { headers: r.headers });
    if (!res.ok) throw new Error(`bucket list failed: HTTP ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1]?.replace(/&amp;/g, "&");
      if (key) out.push({ key, size: Number(/<Size>(\d+)/.exec(m[1])?.[1] ?? 0), modified: /<LastModified>([^<]+)/.exec(m[1])?.[1] ?? "", where: "bucket" });
    }
    token = /<IsTruncated>true/.test(xml) ? /<NextContinuationToken>([\s\S]*?)<\//.exec(xml)?.[1] ?? null : null;
  } while (token);
  return out;
}

async function localList(prefix) {
  const out = [];
  const root = path.resolve(STORAGE_DIR, prefix);
  const base = prefix.endsWith("/") ? root : path.dirname(root);
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (!e.name.endsWith(".meta")) {
        const key = path.relative(STORAGE_DIR, full);
        if (!key.startsWith(prefix)) continue;
        const st = await fs.stat(full);
        out.push({ key, size: st.size, modified: st.mtime.toISOString(), where: "disk" });
      }
    }
  }
  await walk(base);
  return out;
}

const PART_RE = /^part-([0-9a-f-]{36})-(\d{10,16})-(\d{1,6})-(\d{1,6})\.(webm|m4a|mp4|ogg)$/i;
function partsOf(objects, sessionId) {
  const runs = new Map();
  for (const o of objects) {
    const m = PART_RE.exec(o.key.split("/").pop());
    if (!m || (sessionId && m[1].toLowerCase() !== sessionId.toLowerCase())) continue;
    const sid = m[1].toLowerCase();
    const id = `${sid}:${m[2]}`;
    const run = runs.get(id) ?? { sessionId: sid, runId: Number(m[2]), ext: m[5].toLowerCase(), parts: new Map() };
    if (!run.parts.has(Number(m[3])) || o.where === "disk") run.parts.set(Number(m[3]), { ...o, seq: Number(m[3]), t: Number(m[4]) });
    runs.set(id, run);
  }
  return [...runs.values()].sort((a, b) => a.runId - b.runId).map((r) => {
    const parts = [...r.parts.values()].sort((a, b) => a.seq - b.seq);
    const missing = [];
    for (let i = 0, j = 0; parts.length && i <= parts[parts.length - 1].seq; i++) { if (parts[j]?.seq === i) j++; else missing.push(i); }
    return { ...r, parts, missing, seconds: Math.max(0, ...parts.map((p) => p.t)), bytes: parts.reduce((s, p) => s + p.size, 0) };
  });
}

async function readObject(o) {
  if (o.where === "disk") return fs.readFile(path.join(STORAGE_DIR, o.key));
  for (let a = 1; a <= 3; a++) {
    const r = sign("GET", o.key);
    const res = await fetch(r.url, { headers: r.headers });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 404) break;
    await new Promise((x) => setTimeout(x, 700 * a));
  }
  throw new Error(`could not read part ${o.key.split("/").pop()}`);
}

const hasBin = (b) => { try { execFileSync(b, ["-version"], { stdio: "ignore" }); return true; } catch { return false; } };
const run = (bin, a) => new Promise((res, rej) => execFile(bin, a, { timeout: 300_000 }, (e, so) => (e ? rej(e) : res(String(so)))));
const fmt = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

async function main() {
  console.log(`storage: bucket=${hasS3 ? "configured" : "not configured"} disk=${STORAGE_DIR}`);
  if (cmd === "list") {
    const prefix = (args[0] ?? "").replace(/^\/+/, "");
    if (!prefix.startsWith("orgs/")) throw new Error("usage: list orgs/<org>/projects/<project>/candidates/<candidate>/");
    const objs = [...(await s3List(prefix)), ...(await localList(prefix))].sort((a, b) => a.key.localeCompare(b.key));
    for (const o of objs) console.log(`${o.where.padEnd(6)} ${fmt(o.size).padStart(10)}  ${o.modified.slice(0, 19)}  ${o.key.slice(prefix.length)}`);
    console.log(`${objs.length} object(s) under ${prefix}`);
    for (const r of partsOf(objs)) {
      console.log(`parts: session ${r.sessionId} run ${r.runId} (${new Date(r.runId).toISOString()}): ${r.parts.length} part(s), ~${r.seconds}s, ${fmt(r.bytes)}, .${r.ext}` +
        (r.parts[0]?.seq !== 0 ? ", FIRST PART MISSING" : "") + (r.missing.length ? `, missing seq ${r.missing.join(",")}` : ", no gaps"));
    }
    return;
  }
  if (cmd === "head") {
    const key = args[0];
    if (!key) throw new Error("usage: head <objectKey>");
    if (hasS3) {
      const r = sign("HEAD", key);
      const res = await fetch(r.url, { method: "HEAD", headers: r.headers });
      console.log(`bucket: HTTP ${res.status}${res.ok ? `, ${fmt(Number(res.headers.get("content-length") ?? 0))}, ${res.headers.get("content-type")}` : ""}`);
    }
    try { const st = await fs.stat(path.join(STORAGE_DIR, key)); console.log(`disk: ${fmt(st.size)}`); } catch { console.log("disk: not found"); }
    return;
  }
  if (cmd === "rebuild") {
    const [sessionId, recPrefixRaw] = args;
    if (!/^[0-9a-f-]{36}$/i.test(sessionId ?? "") || !recPrefixRaw?.startsWith("orgs/")) {
      throw new Error("usage: rebuild <sessionId> orgs/.../recordings/ [--write] [--target=local|s3]");
    }
    const recPrefix = recPrefixRaw.replace(/\/?$/, "/");
    const objs = [...(await s3List(recPrefix)), ...(await localList(recPrefix))];
    const runs = partsOf(objs, sessionId);
    if (!runs.length) { console.log("No recording parts found for this session; nothing to rebuild."); return; }
    const complete = runs.filter((r) => r.parts[0]?.seq === 0 && !r.missing.length);
    const pool = complete.length ? complete : runs;
    for (const r of runs) console.log(`run ${r.runId}: ${r.parts.length} parts, ~${r.seconds}s, ${r.missing.length ? `missing ${r.missing.join(",")}` : "complete"}${pool.includes(r) ? "" : " (skipped)"}`);
    const ffmpeg = hasBin("ffmpeg");
    const ext = pool.length > 1 ? "m4a" : pool[0].ext;
    const target = flags.target === "s3" ? "s3" : "local";
    const outKey = `${recPrefix}recording-${sessionId}-rebuilt.${ext}`;
    console.log(`output: ${outKey} (target=${target}, ffmpeg=${ffmpeg ? "yes" : "no"})`);
    if (target === "s3" && !hasS3) throw new Error("target=s3 but the bucket is not configured");
    if (!flags.write) { console.log("Dry run. Add --write to build and save it."); return; }

    // Never overwrite.
    if (target === "local") {
      if (await fs.stat(path.join(STORAGE_DIR, outKey)).then(() => true, () => false)) throw new Error("output already exists on disk; not overwriting");
    } else {
      const r = sign("HEAD", outKey);
      if ((await fetch(r.url, { method: "HEAD", headers: r.headers })).ok) throw new Error("output already exists in the bucket; not overwriting");
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rescue-"));
    try {
      const inputs = [];
      for (let i = 0; i < pool.length; i++) {
        const bufs = [];
        for (const p of pool[i].parts) bufs.push(await readObject(p));
        const f = path.join(dir, `run${i}.${pool[i].ext}`);
        await fs.writeFile(f, Buffer.concat(bufs));
        inputs.push(f);
      }
      let outFile = path.join(dir, `out.${ext}`);
      if (pool.length > 1) {
        if (!ffmpeg) throw new Error("several runs need ffmpeg to join; not installed");
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs.flatMap((f) => ["-i", f]), "-filter_complex", `${inputs.map((_, i) => `[${i}:a]`).join("")}concat=n=${inputs.length}:v=0:a=1[a]`, "-map", "[a]", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", outFile]);
      } else if (ffmpeg) {
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", inputs[0], "-vn", "-c", "copy", ...(ext === "webm" ? [] : ["-movflags", "+faststart"]), outFile]).catch(async (e) => {
          console.log(`remux failed (${String(e.message).slice(0, 120)}); keeping the joined bytes`);
          outFile = inputs[0];
        });
      } else outFile = inputs[0];
      const data = await fs.readFile(outFile);
      let seconds = pool.reduce((s, r) => s + r.seconds, 0);
      if (hasBin("ffprobe")) {
        const d = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", outFile]).catch(() => "")).trim());
        if (Number.isFinite(d) && d > 0) seconds = Math.round(d);
        console.log(`ffprobe duration: ${Number.isFinite(d) ? d.toFixed(1) + "s" : "unknown"}`);
      }
      if (!data.length) throw new Error("rebuilt file is empty");
      const type = ext === "webm" ? "audio/webm" : ext === "ogg" ? "audio/ogg" : "audio/mp4";
      if (target === "local") {
        const full = path.join(STORAGE_DIR, outKey);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, data);
        await fs.writeFile(full + ".meta", type);
      } else {
        const r = sign("PUT", outKey, {}, { "content-type": type, "content-length": data.length }, data);
        const res = await fetch(r.url, { method: "PUT", headers: r.headers, body: data });
        if (!res.ok) throw new Error(`bucket upload failed: HTTP ${res.status}`);
      }
      console.log(`WROTE ${outKey} (${fmt(data.length)}, ~${seconds}s) to ${target}.`);
      console.log("To link it to the session (WRITE), run on the VPS:");
      console.log(`docker exec -i skillmark-db-1 psql -U skillmark -d skillmark -c "update sessions set \\"audioRecordingUrl\\"='${outKey}', \\"audioDuration\\"=${seconds} where id='${sessionId}' and \\"mediaClearedAt\\" is null;"`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }
  throw new Error("commands: list <prefix> | head <objectKey> | rebuild <sessionId> <recordingsPrefix> [--write] [--target=local|s3]");
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
