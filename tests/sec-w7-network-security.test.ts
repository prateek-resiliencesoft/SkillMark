import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  assertSafeRemoteUrl,
  createSafeFetch,
  isPrivateIp,
  ResponseTooLargeError,
  safeFetch,
  UnsafeUrlError,
} from "@/lib/network-security";

describe("isPrivateIp numeric CIDR checks", () => {
  it("blocks WHATWG-canonicalized IPv4-mapped IPv6", () => {
    assert.equal(new URL("https://[::ffff:127.0.0.1]/").hostname, "[::ffff:7f00:1]");
    for (const ip of [
      "::ffff:7f00:1",
      "::ffff:a9fe:a9fe",
      "::ffff:169.254.169.254",
      "::ffff:172.16.0.1",
      "::ffff:100.64.0.1",
      "::ffff:0.0.0.0",
      "::ffff:a00:1",
      "[::ffff:c0a8:101]",
    ]) {
      assert.equal(isPrivateIp(ip), true, ip);
    }
    assert.equal(isPrivateIp("::ffff:808:808"), false);
  });

  it("blocks special IPv6 ranges", () => {
    for (const ip of [
      "::",
      "::1",
      "::7f00:1", // IPv4-compatible
      "64:ff9b::7f00:1", // NAT64 → loopback
      "64:ff9b::a9fe:a9fe",
      "64:ff9b:1::1", // local-use NAT64
      "100::1", // discard
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "febf::1",
      "fec0::1",
      "ff02::1",
      "2001::1", // Teredo
      "2001:db8::1",
      "3fff::1",
      "2002:7f00:1::1", // 6to4 → 127.0.0.1
      "2002:a9fe:a9fe::",
      "fe80::1%eth0",
    ]) {
      assert.equal(isPrivateIp(ip), true, ip);
    }
    assert.equal(isPrivateIp("2606:4700:4700::1111"), false);
    assert.equal(isPrivateIp("64:ff9b::808:808"), false);
  });

  it("blocks special IPv4 ranges and garbage input", () => {
    for (const ip of [
      "100.64.0.1",
      "100.127.255.255",
      "192.0.0.8",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.5",
      "224.0.0.1",
      "255.255.255.255",
      "not-an-ip",
      "",
    ]) {
      assert.equal(isPrivateIp(ip), true, ip);
    }
    assert.equal(isPrivateIp("100.128.0.1"), false);
    assert.equal(isPrivateIp("172.32.0.1"), false);
  });

  it("assertSafeRemoteUrl rejects mapped/compat literals that bypassed the old prefix checks", async () => {
    for (const url of [
      "https://[::ffff:127.0.0.1]/",
      "https://[::ffff:169.254.169.254]/latest/meta-data/",
      "https://[64:ff9b::7f00:1]/",
      "https://0x7f000001/",
      "https://user:pass@example.com/",
    ]) {
      await assert.rejects(() => assertSafeRemoteUrl(url), UnsafeUrlError, url);
    }
  });
});

describe("safeFetch", () => {
  let server: http.Server;
  let port = 0;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/ok") {
        res.end(`host=${req.headers.host};auth=${req.headers.authorization ?? ""}`);
      } else if (req.url === "/big") {
        res.end("x".repeat(5000));
      } else if (req.url === "/stream-big") {
        res.write("y".repeat(3000));
        res.end("y".repeat(3000));
      } else if (req.url?.startsWith("/redirect?to=")) {
        res.statusCode = 302;
        res.setHeader("location", decodeURIComponent(req.url.slice("/redirect?to=".length)));
        res.end();
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });

  after(() => server.close());

  // "public.test" stands in for a public host: it resolves to the local test server and only
  // 127.0.0.1 is exempted from the restricted-IP policy, everything else uses the real policy.
  const resolver = async (host: string) => {
    if (host === "public.test" || host === "other.test") return [{ address: "127.0.0.1", family: 4 }];
    if (host === "internal.test") return [{ address: "10.0.0.7", family: 4 }];
    if (host === "metadata.test") return [{ address: "::ffff:a9fe:a9fe", family: 6 }];
    return [];
  };
  const testFetch = createSafeFetch(resolver, (ip) => ip !== "127.0.0.1" && isPrivateIp(ip));

  it("connects to the pinned, validated address (no second DNS lookup)", async () => {
    const res = await testFetch(`http://public.test:${port}/ok`, { allowHttp: true });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), `host=public.test:${port};auth=`);
  });

  it("rejects private destinations before connecting", async () => {
    await assert.rejects(() => testFetch("http://internal.test/", { allowHttp: true }), UnsafeUrlError);
    await assert.rejects(() => testFetch("https://metadata.test/"), UnsafeUrlError);
    await assert.rejects(() => safeFetch(`http://127.0.0.1:${port}/ok`), /https scheme/);
    await assert.rejects(() => safeFetch(`http://127.0.0.1:${port}/ok`, { allowHttp: true }), /restricted/);
    await assert.rejects(() => safeFetch(`https://[::ffff:7f00:1]:${port}/ok`), /restricted/);
  });

  it("revalidates every redirect hop", async () => {
    const hop = (to: string) => `http://public.test:${port}/redirect?to=${encodeURIComponent(to)}`;
    await assert.rejects(() => testFetch(hop("http://internal.test/secret"), { allowHttp: true }), UnsafeUrlError);
    await assert.rejects(() => testFetch(hop("https://[::ffff:a9fe:a9fe]/"), { allowHttp: true }), UnsafeUrlError);
    await assert.rejects(() => testFetch(hop("http://example.com/"), {}), /https scheme/);

    const ok = await testFetch(hop(`http://public.test:${port}/ok`), { allowHttp: true });
    assert.equal(await ok.text(), `host=public.test:${port};auth=`);
  });

  it("strips credentials on cross-origin redirects and caps the hop count", async () => {
    const sameOrigin = await testFetch(
      `http://public.test:${port}/redirect?to=${encodeURIComponent("/ok")}`,
      { allowHttp: true, headers: { authorization: "Bearer s" } },
    );
    assert.match(await sameOrigin.text(), /auth=Bearer s$/);
    const crossOrigin = await testFetch(
      `http://public.test:${port}/redirect?to=${encodeURIComponent(`http://other.test:${port}/ok`)}`,
      { allowHttp: true, headers: { authorization: "Bearer s" } },
    );
    assert.match(await crossOrigin.text(), /auth=$/);

    let chain = `http://public.test:${port}/ok`;
    for (let i = 0; i < 5; i++) chain = `http://public.test:${port}/redirect?to=${encodeURIComponent(chain)}`;
    await assert.rejects(() => testFetch(chain, { allowHttp: true }), /Too many redirects/);
    await assert.rejects(
      () => testFetch(`http://public.test:${port}/redirect?to=%2Fok`, { allowHttp: true, redirect: "error" }),
      /Redirects are not allowed/,
    );
  });

  it("caps the response body by content-length and while streaming", async () => {
    await assert.rejects(
      () => testFetch(`http://public.test:${port}/big`, { allowHttp: true, maxBytes: 1000 }),
      ResponseTooLargeError,
    );
    const res = await testFetch(`http://public.test:${port}/stream-big`, { allowHttp: true, maxBytes: 4000 });
    await assert.rejects(() => res.text(), ResponseTooLargeError);
  });
});
