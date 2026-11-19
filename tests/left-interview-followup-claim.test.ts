import assert from "node:assert/strict";
import test from "node:test";
import { claimFollowup, releaseFollowup, type FollowupDb } from "../src/server/followup-claim";

/** In-memory fake of the one candidates row + the PostgREST chain claimFollowup uses. */
function fakeDb(row: { id: string; inviteToken: string; followupSentToken: string | null } | null, opts: { error?: { code: string; message: string } } = {}) {
  const calls: string[] = [];
  const db: FollowupDb = {
    from: () => {
      let patch: Record<string, unknown> = {};
      const eqs: Array<[string, unknown]> = [];
      let orFilter = "";
      const chain: Record<string, unknown> = {
        update: (p: Record<string, unknown>) => ((patch = p), chain),
        eq: (k: string, v: unknown) => (eqs.push([k, v]), chain),
        or: (f: string) => ((orFilter = f), chain),
        select: () => chain,
        then: (res: (v: unknown) => unknown) => {
          if (opts.error) return res({ data: null, error: opts.error });
          const match =
            row &&
            eqs.every(([k, v]) => (row as Record<string, unknown>)[k] === v) &&
            (!orFilter || row.followupSentToken === null || row.followupSentToken !== row.inviteToken);
          if (match && row) {
            Object.assign(row, patch);
            calls.push("updated");
          }
          return res({ data: match ? [{ id: row!.id }] : [], error: null });
        },
      };
      return chain;
    },
  };
  return { db, calls };
}

test("claim succeeds once per invite token, second claim is already-sent", async () => {
  const row = { id: "c1", inviteToken: "tok_A-1", followupSentToken: null as string | null };
  const { db } = fakeDb(row);
  assert.equal(await claimFollowup(db, "c1", "tok_A-1"), "claimed");
  assert.equal(await claimFollowup(db, "c1", "tok_A-1"), "already-sent");
});

test("a rotated invite token can be claimed again", async () => {
  const row = { id: "c1", inviteToken: "tok_A-1", followupSentToken: "tok_A-1" as string | null };
  const { db } = fakeDb(row);
  row.inviteToken = "tok_B-2";
  assert.equal(await claimFollowup(db, "c1", "tok_B-2"), "claimed");
  assert.equal(row.followupSentToken, "tok_B-2");
});

test("release clears our claim so it can retry", async () => {
  const row = { id: "c1", inviteToken: "tok_A-1", followupSentToken: null as string | null };
  const { db } = fakeDb(row);
  await claimFollowup(db, "c1", "tok_A-1");
  await releaseFollowup(db, "c1", "tok_A-1");
  assert.equal(row.followupSentToken, null);
  assert.equal(await claimFollowup(db, "c1", "tok_A-1"), "claimed");
});

test("missing column (old DB) reports unsupported; other errors report error", async () => {
  assert.equal(await claimFollowup(fakeDb(null, { error: { code: "42703", message: 'column "followupSentToken" does not exist' } }).db, "c1", "tok"), "unsupported");
  assert.equal(await claimFollowup(fakeDb(null, { error: { code: "PGRST204", message: "Could not find the 'followupSentAt' column" } }).db, "c1", "tok"), "unsupported");
  assert.equal(await claimFollowup(fakeDb(null, { error: { code: "08006", message: "connection failure" } }).db, "c1", "tok"), "error");
});

test("unsafe token is refused (never interpolated into the filter)", async () => {
  const { db } = fakeDb({ id: "c1", inviteToken: "x", followupSentToken: null });
  assert.equal(await claimFollowup(db, "c1", "a,b)"), "error");
});
