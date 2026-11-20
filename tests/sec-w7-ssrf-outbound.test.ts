import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { fetchRemoteDocument, RemoteDocumentError } from "@/lib/documents/remote-text";
import { guardedUnwrappingFetch } from "@/lib/ai/providers/compatible";
import { dispatchOutboundWebhook } from "@/lib/messaging/webhooks";
import { resilioSendUrl } from "@/lib/messaging/resilio-url";
import { createSafeFetch, isPrivateIp } from "@/lib/network-security";

let server: http.Server;
let port = 0;
let hits = 0;

before(async () => {
  server = http.createServer((req, res) => {
    hits++;
    if (req.url === "/json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ secret: "postgrest-row" }));
    } else if (req.url === "/page") {
      res.setHeader("content-type", "text/html");
      res.end("<html><body><main>Hello</main></body></html>");
    } else if (req.url === "/to-internal") {
      res.statusCode = 302;
      res.setHeader("location", "http://rest.internal:3000/users");
      res.end();
    } else {
      res.end("ok");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

describe("extract-text URL mode (fetchRemoteDocument)", () => {
  it("rejects loopback, http, IPv4-mapped literals and internal hostnames without connecting", async () => {
    const before = hits;
    for (const url of [
      `http://127.0.0.1:${port}/json`,
      `https://127.0.0.1:${port}/json`,
      `https://[::ffff:7f00:1]:${port}/json`,
      "https://localhost/",
      "http://rest:3000/users",
    ]) {
      await assert.rejects(() => fetchRemoteDocument(url), RemoteDocumentError, url);
    }
    assert.equal(hits, before);
  });

  // public.test resolves to the local server to stand in for a public host.
  const testFetch = createSafeFetch(
    async (h) => (h === "public.test" ? [{ address: "127.0.0.1", family: 4 }] : h === "rest.internal" ? [{ address: "172.18.0.5", family: 4 }] : []),
    (ip) => ip !== "127.0.0.1" && isPrivateIp(ip),
  );
  const viaTest: typeof testFetch = (u, init) => testFetch(u, { ...init, allowHttp: true });

  it("does not reflect non-HTML bodies (internal JSON APIs)", async () => {
    await assert.rejects(() => fetchRemoteDocument(`http://public.test:${port}/json`, viaTest), RemoteDocumentError);
    const ok = await fetchRemoteDocument(`http://public.test:${port}/page`, viaTest);
    assert.equal(ok.kind, "html");
  });

  it("refuses redirects into the internal network", async () => {
    await assert.rejects(() => fetchRemoteDocument(`http://public.test:${port}/to-internal`, viaTest), RemoteDocumentError);
  });
});

describe("outbound webhook delivery", () => {
  it("never connects to private/internal destinations", async () => {
    const before = hits;
    for (const url of [`http://127.0.0.1:${port}/hook`, `https://127.0.0.1:${port}/hook`, `https://[::ffff:7f00:1]:${port}/hook`, "https://[::1]/"]) {
      const r = await dispatchOutboundWebhook({ url, event: "session.completed", organizationId: "o", data: {} });
      assert.equal(r.ok, false, url);
      assert.match(r.error ?? "", /public https/);
    }
    assert.equal(hits, before);
  });
});

describe("ResilioHub base URL", () => {
  it("cannot override the API path with query/fragment/credentials", () => {
    assert.equal(resilioSendUrl("https://hub.example.com/"), "https://hub.example.com/api/v1/send_templet");
    assert.equal(resilioSendUrl(null), "https://resiliohub.com/api/v1/send_templet");
    for (const b of ["https://evil.example/x?", "https://evil.example/#", "https://u:p@evil.example"]) {
      assert.throws(() => resilioSendUrl(b), b);
    }
  });
});

describe("tenant LLM baseUrl fetch", () => {
  it("rejects internal endpoints before any request is sent", async () => {
    const before = hits;
    await assert.rejects(() => guardedUnwrappingFetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", body: "{}" }));
    await assert.rejects(() => guardedUnwrappingFetch(`https://[::ffff:a9fe:a9fe]/latest/meta-data/`));
    assert.equal(hits, before);
  });
});
