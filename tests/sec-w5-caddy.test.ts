import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

/** Body of each `reverse_proxy <upstream> { ... }` block. */
function proxyBlocks(src: string): { upstream: string; body: string }[] {
  const out: { upstream: string; body: string }[] = [];
  const re = /reverse_proxy\s+(?:@\w+\s+)?(\S+)\s*\{([\s\S]*?)\n\t\}/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push({ upstream: m[1], body: m[2] });
  return out;
}

describe("Caddy edge hardening", () => {
  for (const file of ["Caddyfile", "scripts/dev.caddy"]) {
    const src = read(file);

    it(`${file}: every proxy strips client CF-Connecting-IP and pins forwarding headers`, () => {
      const blocks = proxyBlocks(src);
      assert.ok(blocks.length > 0);
      assert.doesNotMatch(src, /reverse_proxy\s+(?:@\w+\s+)?\S+\s*\n/, "no proxy without a header block");
      for (const { upstream, body } of blocks) {
        assert.match(body, /header_up -CF-Connecting-IP/, `${upstream} strips CF-Connecting-IP`);
        assert.match(body, /header_up X-Real-IP \{remote_host\}/, `${upstream} overwrites X-Real-IP`);
        assert.match(body, /header_up X-Forwarded-For \{remote_host\}/, `${upstream} overwrites X-Forwarded-For`);
        if (!upstream.startsWith("voice:")) {
          assert.match(body, /header_up X-Forwarded-Host \{host\}/, `${upstream} overwrites X-Forwarded-Host`);
        }
      }
    });

    it(`${file}: request bodies are capped (100MB recordings, 32MB everything else)`, () => {
      assert.match(src, /@largeUpload path \/api\/session\/upload\n\trequest_body @largeUpload \{\n\t\tmax_size 110MB/);
      assert.match(src, /@regularBody not path \/api\/session\/upload\n\trequest_body @regularBody \{\n\t\tmax_size 32MB/);
    });
  }
});

describe("voice relay containers get what the session check needs", () => {
  for (const file of ["docker-compose.prod.yml", "docker-compose.dev.yml"]) {
    it(file, () => {
      const src = read(file);
      const voice = src.slice(src.indexOf("\n  voice:") + 1);
      const next = voice.slice(1).search(/\n  [a-z][\w-]*:\n/);
      const block = next === -1 ? voice : voice.slice(0, next + 1);
      assert.match(block, /AUTH_SECRET: \$\{AUTH_SECRET:\?/);
      assert.match(block, /NEXT_PUBLIC_APP_URL: \$\{NEXT_PUBLIC_APP_URL:\?/);
      assert.match(block, /POSTGREST_URL: http:\/\/rest:3000/);
      assert.match(block, /depends_on:\n\s+rest:/);
    });
  }
});
