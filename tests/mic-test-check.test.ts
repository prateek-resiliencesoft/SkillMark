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

test("fails when speech is shorter than 1.5s", () => {
  const v = evaluateMicTest({
    speechMs: 800,
    peakRms: 0.1,
    meanSpeechRms: 0.05,
  });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "too_short");
  assert.equal(MIC_TEST_CHECK.minSpeechMs, 1500);
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
