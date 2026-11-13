import assert from "node:assert/strict";
import test from "node:test";

import {
  groupRecordingParts,
  isRunComplete,
  parseRecordingPartKey,
  recordingExtForMime,
  recordingPartFileName,
} from "@/lib/recording-parts";

const SID = "be0a0182-f321-4110-8fc2-2a7d65a9dd97";
const OTHER = "a4ecb928-b197-420f-80a7-a01c971add9e";
const dir = "orgs/o/projects/p/candidates/c/recordings/";

test("part file names round-trip", () => {
  const name = recordingPartFileName({ sessionId: SID, runId: 1794549145000, seq: 3, elapsedSec: 40.4, ext: "m4a" });
  assert.equal(name, `part-${SID}-1794549145000-00003-40.m4a`);
  const p = parseRecordingPartKey(dir + name);
  assert.ok(p);
  assert.equal(p.seq, 3);
  assert.equal(p.elapsedSec, 40);
  assert.equal(p.ext, "m4a");
  assert.equal(parseRecordingPartKey(dir + "recording-1794550048857.m4a"), null);
});

test("groupRecordingParts orders parts, splits runs and ignores other sessions", () => {
  const k = (sid: string, run: number, seq: number, t: number) =>
    dir + recordingPartFileName({ sessionId: sid, runId: run, seq, elapsedSec: t, ext: "webm" });
  const keys = [
    k(SID, 2000000000000, 1, 20),
    k(SID, 1000000000000, 1, 20),
    k(SID, 1000000000000, 0, 10),
    k(SID, 1000000000000, 2, 25),
    k(SID, 2000000000000, 0, 10),
    k(OTHER, 1000000000000, 0, 10),
    dir + "recording-123.webm",
  ];
  const runs = groupRecordingParts(keys, SID);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].parts.map((p) => p.seq), [0, 1, 2]);
  assert.equal(runs[0].durationSec, 25);
  assert.ok(isRunComplete(runs[0]));
  assert.ok(isRunComplete(runs[1]));
  const gap = groupRecordingParts([k(SID, 1, 0, 10), k(SID, 1, 2, 30)].map((x) => x.replace("-1-", "-1000000000001-")), SID);
  assert.equal(gap.length, 1);
  assert.equal(isRunComplete(gap[0]), false);
});

test("recordingExtForMime", () => {
  assert.equal(recordingExtForMime("audio/webm;codecs=opus"), "webm");
  assert.equal(recordingExtForMime("audio/mp4"), "m4a");
  assert.equal(recordingExtForMime(""), "webm");
});
