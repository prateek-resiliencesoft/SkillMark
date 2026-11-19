import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchJson, HttpError, readJsonResponse, responseErrorMessage } from "@/lib/fetch-json";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Awaits a promise that must reject; returns the error typed. */
const rejection = (p: Promise<unknown>) =>
  p.then(
    () => assert.fail("expected rejection"),
    (e: unknown) => e as HttpError,
  );
const CV_MSG = "The server took too long to process the CVs. Please try again with fewer files.";

describe("readJsonResponse", () => {
  it("returns parsed JSON for a 200", async () => {
    assert.deepEqual(await readJsonResponse(json({ a: 1 })), { a: 1 });
  });

  it("empty 504 from the proxy → readable timeout message, not 'Unexpected end of JSON input'", async () => {
    const err = await rejection(readJsonResponse(new Response("", { status: 504 }), { timeoutMessage: CV_MSG }));
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 504);
    assert.equal(err.message, CV_MSG);
  });

  it("HTML 502 body → timeout message", async () => {
    const res = new Response("<html>Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
    const err = await rejection(readJsonResponse(res));
    assert.match(err.message, /took too long/i);
  });

  it("uses the server's error text and code when present", async () => {
    const err = await rejection(readJsonResponse(json({ error: "AI quota exhausted", code: "AI_QUOTA_EXHAUSTED" }, 429)));
    assert.equal(err.message, "AI quota exhausted");
    assert.equal(err.code, "AI_QUOTA_EXHAUSTED");
    assert.equal(err.status, 429);
  });

  it("200 with an empty or non-JSON body is an error, not a crash", async () => {
    for (const body of ["", "<html>login</html>"]) {
      const err = await rejection(readJsonResponse(new Response(body, { status: 200 })));
      assert.ok(err instanceof HttpError);
      assert.match(err.message, /unexpected response/i);
    }
  });

  it("non-OK without an error field falls back to the status", async () => {
    const err = await rejection(readJsonResponse(json({}, 500)));
    assert.match(err.message, /HTTP 500/);
  });
});

describe("responseErrorMessage", () => {
  it("never throws on empty bodies", async () => {
    assert.match(await responseErrorMessage(new Response(null, { status: 503 })), /temporarily unavailable/i);
    assert.equal(await responseErrorMessage(json({ error: "nope" }, 400)), "nope");
  });
});

describe("fetchJson", () => {
  const withFetch = async (impl: typeof fetch, run: () => Promise<void>) => {
    const real = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      await run();
    } finally {
      globalThis.fetch = real;
    }
  };

  it("network failure becomes a readable HttpError", async () => {
    await withFetch(
      (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      async () => {
        const err = await rejection(fetchJson("/x"));
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 0);
        assert.match(err.message, /connection/i);
      },
    );
  });

  it("empty 504 with the batch timeout message", async () => {
    await withFetch((async () => new Response("", { status: 504 })) as typeof fetch, async () => {
      const err = await rejection(fetchJson("/x", undefined, { timeoutMessage: CV_MSG }));
      assert.equal(err.message, CV_MSG);
    });
  });

  it("passes success JSON through", async () => {
    await withFetch((async () => json({ ok: true })) as typeof fetch, async () => {
      assert.deepEqual(await fetchJson("/x"), { ok: true });
    });
  });
});
