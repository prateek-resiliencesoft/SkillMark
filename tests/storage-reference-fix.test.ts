import assert from "node:assert/strict";
import test from "node:test";

import { rewriteStoredRefs, storedUrlToPath, type RefFixContext } from "@/server/storage-reference-fix";

const ctx: RefFixContext = { bucketBaseUrl: "https://s3.us-west-004.backblazeb2.com/skillmark-media" };
const KEY = "orgs/o1/projects/p1/candidates/Jane_1234abcd/recordings/interview.webm";
const SIGN = "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc";

test("path-style Backblaze URL for an orgs/ key becomes the key", () => {
  assert.equal(storedUrlToPath(`${ctx.bucketBaseUrl}/${KEY}${SIGN}`, ctx), KEY);
});

test("legacy `<bucket>/<path>` key drops the logical bucket", () => {
  assert.equal(
    storedUrlToPath(`${ctx.bucketBaseUrl}/recordings/sess-1/audio.webm${SIGN}`, ctx),
    "sess-1/audio.webm",
  );
});

test("other Backblaze URL styles are recognised without the configured endpoint", () => {
  const none: RefFixContext = { bucketBaseUrl: null };
  assert.equal(storedUrlToPath(`https://s3.eu-central-003.backblazeb2.com/other/${KEY}`, none), KEY);
  assert.equal(storedUrlToPath(`https://f004.backblazeb2.com/file/skillmark-media/${KEY}`, none), KEY);
  assert.equal(storedUrlToPath(`https://skillmark-media.s3.us-west-004.backblazeb2.com/${KEY}`, none), KEY);
});

test("encoded segments are decoded", () => {
  const url = `${ctx.bucketBaseUrl}/orgs/o1/projects/p1/candidates/Ren%C3%A9_1/CV/my%20cv.pdf`;
  assert.equal(storedUrlToPath(url, ctx), "orgs/o1/projects/p1/candidates/René_1/CV/my cv.pdf");
});

test("/api/files links become paths (both link shapes)", () => {
  assert.equal(storedUrlToPath(`https://app.example/api/files/recordings/${KEY}?token=t`, ctx), KEY);
  assert.equal(storedUrlToPath(`/api/files/screenshots/screenshots/sess-1/a.jpg?token=t`, ctx), "sess-1/a.jpg");
  assert.equal(storedUrlToPath(`/api/files/screenshots/sess-1/a.jpg?token=t`, ctx), "sess-1/a.jpg");
});

test("bare paths, data URLs and unrelated links are left alone", () => {
  assert.equal(storedUrlToPath(KEY, ctx), null);
  assert.equal(storedUrlToPath("data:image/png;base64,AAAA", ctx), null);
  assert.equal(storedUrlToPath("https://example.com/orgs/o1/x.png", ctx), null);
});

test("rewrites nested session JSON and counts changes", () => {
  const screenshots = [
    { url: `${ctx.bucketBaseUrl}/${KEY.replace("recordings/interview.webm", "images/a.jpg")}${SIGN}`, path: "orgs/o1/projects/p1/candidates/Jane_1234abcd/images/a.jpg", type: "camera" },
    { url: "orgs/o1/x/images/b.jpg", path: "orgs/o1/x/images/b.jpg", type: "screen" },
  ];
  const { value, changed } = rewriteStoredRefs(screenshots, ctx);
  assert.equal(changed, 1);
  assert.equal(value[0].url, "orgs/o1/projects/p1/candidates/Jane_1234abcd/images/a.jpg");
  assert.deepEqual(value[1], screenshots[1]);

  const untouched = { a: 1, b: [KEY] };
  const r = rewriteStoredRefs(untouched, ctx);
  assert.equal(r.changed, 0);
  assert.equal(r.value, untouched);
});
