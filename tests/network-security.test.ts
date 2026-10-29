import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafeRemoteUrl, isPrivateIp } from "@/lib/network-security";

describe("network-security SSRF protection", () => {
  it("identifies private IPv4 addresses correctly", () => {
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("10.0.0.5"), true);
    assert.equal(isPrivateIp("192.168.1.100"), true);
    assert.equal(isPrivateIp("172.16.0.1"), true);
    assert.equal(isPrivateIp("172.31.255.255"), true);
    assert.equal(isPrivateIp("169.254.169.254"), true); // AWS/cloud metadata
    assert.equal(isPrivateIp("0.0.0.0"), true);
  });

  it("identifies private IPv6 addresses correctly", () => {
    assert.equal(isPrivateIp("::1"), true);
    assert.equal(isPrivateIp("::"), true);
    assert.equal(isPrivateIp("fe80::1"), true);
    assert.equal(isPrivateIp("fc00::1"), true);
    assert.equal(isPrivateIp("fd00::1"), true);
  });

  it("permits public IP addresses", () => {
    assert.equal(isPrivateIp("8.8.8.8"), false);
    assert.equal(isPrivateIp("1.1.1.1"), false);
    assert.equal(isPrivateIp("93.184.216.34"), false);
  });

  it("rejects non-https URLs", async () => {
    await assert.rejects(
      () => assertSafeRemoteUrl("http://example.com/recording.webm"),
      /URL must use https scheme/,
    );
    await assert.rejects(
      () => assertSafeRemoteUrl("ftp://example.com/recording.webm"),
      /URL must use https scheme/,
    );
  });

  it("rejects loopback and internal hosts", async () => {
    await assert.rejects(
      () => assertSafeRemoteUrl("https://localhost:3000/api"),
      /Host resolves to a restricted\/private network address/,
    );
    await assert.rejects(
      () => assertSafeRemoteUrl("https://127.0.0.1:3000/api"),
      /Host resolves to a restricted\/private network address/,
    );
  });

  it("accepts valid public https domains", async () => {
    const url = await assertSafeRemoteUrl("https://cloudflare.com/test.json");
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "cloudflare.com");
  });
});
