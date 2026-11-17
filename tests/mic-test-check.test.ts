import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMicTest,
  MIC_TEST_CHECK,
  micTestAudioSrc,
} from "@/lib/voice/mic-test-check";

test("fails when no speech was detected", () => {
  const v = evaluateMicTest({ speechMs: 0, peakRms: 0.001, meanSpeechRms: 0 });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "no_speech");
});

test("fails when speech is shorter than 1s", () => {
  const v = evaluateMicTest({
    speechMs: 400,
    peakRms: 0.1,
    meanSpeechRms: 0.05,
  });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "too_short");
  assert.equal(MIC_TEST_CHECK.minSpeechMs, 1000);
});

test("fails when speech is too quiet", () => {
  const v = evaluateMicTest({
    speechMs: 2000,
    peakRms: 0.03,
    meanSpeechRms: 0.005,
  });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "too_quiet");
});

test("fails when peak clips", () => {
  const v = evaluateMicTest({
    speechMs: 2000,
    peakRms: 0.95,
    meanSpeechRms: 0.4,
  });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "clipping");
});

test("passes clear speech of adequate length and level", () => {
  const v = evaluateMicTest({
    speechMs: 1800,
    peakRms: 0.2,
    meanSpeechRms: 0.05,
    noiseFloorRms: 0.004,
  });
  assert.equal(v.pass, true);
  assert.match(v.message, /passed/i);
});

test("micTestAudioSrc picks language clip (mp3 default, wav optional)", () => {
  assert.equal(micTestAudioSrc("en"), "/audio/mic-test-en.mp3");
  assert.equal(micTestAudioSrc("zh-CN"), "/audio/mic-test-zh.mp3");
  assert.equal(micTestAudioSrc("en", "wav"), "/audio/mic-test-en.wav");
});

test("a partial sentence (about 1s of clear speech) passes", () => {
  const v = evaluateMicTest({ speechMs: 1024, peakRms: 0.15, meanSpeechRms: 0.04, noiseFloorRms: 0.003 });
  assert.equal(v.pass, true);
});

test("at the listening timeout, a short but clear voice still passes", () => {
  const stats = { speechMs: 640, peakRms: 0.12, meanSpeechRms: 0.04, noiseFloorRms: 0.003 };
  assert.equal(evaluateMicTest(stats).reason, "too_short");
  assert.equal(evaluateMicTest(stats, { final: true }).pass, true);
  // Silence is still a fail at the timeout.
  assert.equal(evaluateMicTest({ speechMs: 0, peakRms: 0.002, meanSpeechRms: 0 }, { final: true }).reason, "no_speech");
});

test("timings: prompt lead-in and listening window are sane", () => {
  assert.ok(MIC_TEST_CHECK.playbackLeadInSec >= 0.2 && MIC_TEST_CHECK.playbackLeadInSec <= 1);
  assert.ok(MIC_TEST_CHECK.listenTimeoutMs > MIC_TEST_CHECK.minSpeechMs * 3);
  assert.ok(MIC_TEST_CHECK.minSpeechMsAtTimeout < MIC_TEST_CHECK.minSpeechMs);
});

test("fail messages point to Retry and never use another product name", () => {
  for (const stats of [
    { speechMs: 0, peakRms: 0.001, meanSpeechRms: 0 },
    { speechMs: 300, peakRms: 0.1, meanSpeechRms: 0.05 },
  ]) {
    const v = evaluateMicTest(stats);
    assert.match(v.message, /Retry/);
    assert.doesNotMatch(v.message, /aural/i);
  }
});
