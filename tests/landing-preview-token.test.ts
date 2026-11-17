import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import {
  buildPreviewApiUrl,
  buildPreviewTabUrl,
  PREVIEW_API_TOKEN_PARAM,
  PREVIEW_TAB_TOKEN_PARAM,
} from "../landingpage_connection/shared/preview";
import {
  signPreviewToken,
  verifyPreviewToken,
} from "../landingpage_connection/server/preview-token";

const PREV = process.env.AUTH_SECRET;

before(() => {
  process.env.AUTH_SECRET = "test-auth-secret-with-at-least-32-chars!!";
});

after(() => {
  if (PREV === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = PREV;
});

test("preview token round-trips", async () => {
  const token = await signPreviewToken("user-123", 60);
  const verified = await verifyPreviewToken(token);
  assert.deepEqual(verified, { userId: "user-123" });
});

test("preview token rejects garbage", async () => {
  assert.equal(await verifyPreviewToken("not.a.jwt"), null);
});

test("preview token fails closed without AUTH_SECRET", async () => {
  const saved = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  await assert.rejects(() => signPreviewToken("user-123"), /AUTH_SECRET/);
  process.env.AUTH_SECRET = saved;
});

test("preview tab URL and API URL stay on the documented contract", async () => {
  const token = await signPreviewToken("user-456", 60);
  const tabUrl = buildPreviewTabUrl({
    landingOrigin: "https://land.example",
    token,
    slug: "pricing",
  });
  const apiUrl = buildPreviewApiUrl({
    apiBase: "https://app.example/api/public/landing",
    token,
  });

  assert.equal(
    tabUrl,
    `https://land.example/pricing?${PREVIEW_TAB_TOKEN_PARAM}=${encodeURIComponent(token)}`,
  );
  assert.equal(
    apiUrl,
    `https://app.example/api/public/landing/preview?${PREVIEW_API_TOKEN_PARAM}=${encodeURIComponent(token)}`,
  );

  // Landing ContentProvider reads the tab query param and fetches the API URL.
  const tabParams = new URL(tabUrl).searchParams;
  assert.equal(tabParams.get(PREVIEW_TAB_TOKEN_PARAM), token);
  const apiParams = new URL(apiUrl).searchParams;
  assert.equal(apiParams.get(PREVIEW_API_TOKEN_PARAM), token);

  // Same token must verify for the public preview endpoint.
  assert.deepEqual(await verifyPreviewToken(token), { userId: "user-456" });
});

test("preview tab URL home and slug normalization", () => {
  const token = "abc.def";
  assert.equal(
    buildPreviewTabUrl({ landingOrigin: "https://land.example/", token }),
    `https://land.example/?${PREVIEW_TAB_TOKEN_PARAM}=abc.def`,
  );
  assert.equal(
    buildPreviewTabUrl({ landingOrigin: "https://land.example", token, slug: "/about/" }),
    `https://land.example/about?${PREVIEW_TAB_TOKEN_PARAM}=abc.def`,
  );
});

test("preview API URL never points at the marketing HTML origin", () => {
  const apiUrl = buildPreviewApiUrl({
    apiBase: "https://app.example/api/public/landing",
    token: "t",
  });
  assert.match(apiUrl, /\/api\/public\/landing\/preview\?/);
  assert.doesNotMatch(apiUrl, /lp_preview_token/);
});
