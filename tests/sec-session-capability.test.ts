import assert from "node:assert/strict";
import test from "node:test";

import * as cap from "@/lib/session-capability";

process.env.AUTH_SECRET = "test-auth-secret-for-capability-0000000000";

const SID = "3f6c1d2e-8a4b-4c5d-9e0f-1a2b3c4d5e6f";
const OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

test("capability verifies only for its own session", () => {
  const token = cap.signSessionCapability(SID);
  assert.equal(cap.verifySessionCapability(SID, token), true);
  assert.equal(cap.verifySessionCapability(OTHER, token), false);
  assert.equal(cap.verifySessionCapability(SID, token.slice(0, -2) + "AA"), false);
  assert.equal(cap.verifySessionCapability(SID, null), false);
  assert.equal(cap.verifySessionCapability("not-a-uuid", token), false);
});

test("sessions that require a capability reject a bare UUID", () => {
  const session = { id: SID, capabilityRequired: true };
  assert.equal(cap.sessionCapabilityOk(session, null), false);
  assert.equal(cap.sessionCapabilityOk(session, cap.signSessionCapability(SID)), true);
  assert.equal(cap.sessionCapabilityOk({ id: SID, capabilityRequired: false }, null), true);
});

test("cookie header parsing picks the per-session cookie", () => {
  const token = cap.signSessionCapability(SID);
  const header = `a=1; ${cap.sessionCapabilityCookieName(OTHER)}=x; ${cap.sessionCapabilityCookieName(SID)}=${token}`;
  assert.equal(cap.readCapabilityFromCookieHeader(header, SID), token);
  const req = new Request("http://localhost/api/session/complete", { method: "POST", headers: { cookie: header } });
  assert.equal(cap.requestHasSessionCapability(req, { id: SID, capabilityRequired: true }), true);
  const bare = new Request("http://localhost/api/session/complete", { method: "POST" });
  assert.equal(cap.requestHasSessionCapability(bare, { id: SID, capabilityRequired: true }), false);
});

test("cookie is HttpOnly and SameSite=Strict", () => {
  const o = cap.sessionCapabilityCookieOptions();
  assert.equal(o.httpOnly, true);
  assert.equal(o.sameSite, "strict");
});
