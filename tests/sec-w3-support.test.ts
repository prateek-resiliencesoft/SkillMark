/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { w3Db } from "./sec-w3-db";

const dir = mkdtempSync(path.join(os.tmpdir(), "skillmark-w3-support-"));
process.env.STORAGE_DIR = dir;
process.env.STORAGE_CAP_GATE = "off";
process.env.AUTH_SECRET = "test-secret-for-w3-support-0123456789";

// The route reads the user and storage client from request cookies; stub both.
const stubs = mkdtempSync(path.join(os.tmpdir(), "w3-support-stubs-"));
const authStub = path.join(stubs, "auth.cjs");
const serverStub = path.join(stubs, "server.cjs");
writeFileSync(authStub, "exports.getAuthUser = async () => globalThis.__w3User ?? null;");
writeFileSync(serverStub, "exports.createClient = () => ({ storage: globalThis.__w3Storage });");
(nodeModule as any).registerHooks?.({
  resolve(specifier: string, context: unknown, nextResolve: (s: string, c: unknown) => unknown) {
    if (specifier === "@/lib/auth") return { url: pathToFileURL(authStub).href, shortCircuit: true };
    if (specifier === "@/lib/supabase/server") return { url: pathToFileURL(serverStub).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let n = 0;
async function setup() {
  const { storage } = await import("@/lib/storage");
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const db = w3Db({ support_tickets: [] });
  (supabaseAdmin as any).from = db.from.bind(db);
  const user = { id: `user-${++n}`, email: "u@example.com" };
  (globalThis as any).__w3User = user;
  (globalThis as any).__w3Storage = storage;
  const { POST } = await import("@/app/api/support/route");
  return { POST, db, user };
}

async function ticket(files: { name: string; bytes: number; type?: string }[]) {
  const form = new FormData();
  form.append("message", "help");
  for (const f of files) form.append("attachments", new Blob([new Uint8Array(f.bytes).fill(0x41)], { type: f.type ?? "" }), f.name);
  const encoded = new Response(form);
  const body = new Uint8Array(await encoded.arrayBuffer());
  return new Request("http://app.test/api/support", {
    method: "POST",
    body,
    headers: { "content-type": encoded.headers.get("content-type") ?? "" },
  });
}

describe("SKILLMARK-STORAGE-UNBOUNDED-SUPPORT-QUOTA-EXHAUSTION", () => {
  it("rejects too many attachments, oversized files and oversized bodies", async () => {
    const { POST, db } = await setup();
    assert.equal((await POST(await ticket(Array.from({ length: 6 }, (_, i) => ({ name: `${i}.png`, bytes: 10 }))))).status, 400);
    assert.equal((await POST(await ticket([{ name: "big.png", bytes: 11 * 1024 * 1024 }]))).status, 413);
    assert.equal(
      (await POST(await ticket(Array.from({ length: 3 }, (_, i) => ({ name: `${i}.png`, bytes: 8 * 1024 * 1024 }))))).status,
      413,
    );
    assert.equal(db.tables.support_tickets.length, 0);
  });

  it("rate limits tickets per user", async () => {
    const { POST } = await setup();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await POST(await ticket([]))).status);
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });

  it("stores a server-derived content type and a safe extension", async () => {
    const { POST, db, user } = await setup();
    const res = await POST(await ticket([{ name: "x.html", bytes: 20, type: "text/html" }]));
    assert.equal(res.status, 200);
    const att = db.tables.support_tickets[0].attachments[0];
    assert.match(att.path, new RegExp(`^${user.id}/[0-9a-f-]+\\.bin$`));
    const { readFile } = await import("@/lib/storage");
    const { contentType } = await readFile("support-attachments", att.path);
    assert.notEqual(contentType, "text/html");
  });
});
