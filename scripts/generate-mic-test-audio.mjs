#!/usr/bin/env node
/**
 * Generate public/audio/mic-test-zh.{wav,mp3} with Gemini TTS (Kore).
 * English (mic-test-en.*) is supplied by the team and must not be overwritten.
 * Raw model output is 24 kHz PCM; we normalize to -3 dBTP and resample to 48 kHz.
 * Requires GEMINI_API_KEY in the environment / .env (never commit keys).
 * Optional: ffmpeg on PATH for loudnorm + mp3.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("GEMINI_API_KEY missing");
  process.exit(1);
}

const MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const texts = {
  // English clip is user-supplied at public/audio/mic-test-en.{mp3,wav} — do not overwrite.
  zh: "请说这句话：我的麦克风工作正常，以便我们验证您的麦克风。",
};

function pcmToWav(pcm, sampleRate = 24000) {
  const dataLen = pcm.length;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  pcm.copy(buf, 44);
  return buf;
}

async function synthesize(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
        },
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || res.statusText);
  const part = json?.candidates?.[0]?.content?.parts?.find(
    (p) => p.inlineData || p.inline_data,
  );
  const inline = part?.inlineData || part?.inline_data;
  if (!inline?.data) throw new Error("no audio");
  const raw = Buffer.from(inline.data, "base64");
  if (raw.slice(0, 4).toString() === "RIFF") return raw;
  const rate = Number(
    /rate=(\d+)/.exec(inline.mimeType || inline.mime_type || "")?.[1] || 24000,
  );
  return pcmToWav(raw, rate);
}

function runFfmpeg(args) {
  const r = spawnSync("ffmpeg", ["-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(r.stderr?.slice(-400) || "ffmpeg failed");
  }
}

const outDir = path.join(process.cwd(), "public/audio");
fs.mkdirSync(outDir, { recursive: true });

for (const [lang, text] of Object.entries(texts)) {
  const wav24 = await synthesize(text);
  const rawPath = path.join(outDir, `mic-test-${lang}-raw24k.wav`);
  const wavPath = path.join(outDir, `mic-test-${lang}.wav`);
  const mp3Path = path.join(outDir, `mic-test-${lang}.mp3`);
  fs.writeFileSync(rawPath, wav24);
  try {
    runFfmpeg([
      "-i", rawPath,
      "-af", "loudnorm=I=-16:TP=-3:LRA=11,aresample=48000",
      "-ar", "48000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      wavPath,
    ]);
    runFfmpeg([
      "-i", wavPath,
      "-codec:a", "libmp3lame",
      "-qscale:a", "2",
      mp3Path,
    ]);
    fs.unlinkSync(rawPath);
    console.log("wrote", wavPath, "and", mp3Path);
  } catch (err) {
    // No ffmpeg: keep 24 kHz wav only
    fs.renameSync(rawPath, wavPath);
    console.warn("ffmpeg unavailable, kept 24 kHz wav only:", err.message);
    console.log("wrote", wavPath);
  }
}
