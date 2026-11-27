/**
 * Daily (or manual) AI price / FX refresh for AI Studio.
 *
 * Usage: `npx tsx scripts/sync-ai-prices.ts`
 *
 * v1: refreshes USD→INR FX and re-applies known seed rates for catalog rows.
 * Scrapers for vendor pricing pages can plug into `refreshKnownUsdRates` later;
 * on failure we keep last good catalog prices.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

async function fetchUsdInr(): Promise<number> {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=INR");
    if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
    const body = (await res.json()) as { rates?: { INR?: number } };
    const n = body.rates?.INR;
    if (!n || !Number.isFinite(n)) throw new Error("no INR rate");
    return n;
  } catch (err) {
    console.warn("FX fetch failed, keeping previous:", (err as Error).message);
    const { data } = await db.from("ai_price_fx").select('"usdInr"').eq("id", 1).maybeSingle();
    return data?.usdInr != null ? Number(data.usdInr) : 93;
  }
}

/** Known list prices (USD). Extend when scrape adapters land. */
const KNOWN: {
  provider: string;
  modelId: string;
  inputUsdPerMtok?: number;
  outputUsdPerMtok?: number;
  audioInUsdPerMtok?: number;
  audioOutUsdPerMtok?: number;
  perMinuteUsd?: number;
}[] = [
  { provider: "openai", modelId: "gpt-4o-mini", inputUsdPerMtok: 0.15, outputUsdPerMtok: 0.6 },
  { provider: "openai", modelId: "gpt-4o", inputUsdPerMtok: 2.5, outputUsdPerMtok: 10 },
  {
    provider: "openai",
    modelId: "gpt-realtime-1.5",
    inputUsdPerMtok: 4,
    outputUsdPerMtok: 16,
    audioInUsdPerMtok: 32,
    audioOutUsdPerMtok: 64,
    perMinuteUsd: 0.4,
  },
  { provider: "openai", modelId: "gpt-4o-mini-transcribe", perMinuteUsd: 0.003 },
  { provider: "gemini", modelId: "gemini-3.6-flash", inputUsdPerMtok: 0.75, outputUsdPerMtok: 3.75 },
  {
    provider: "gemini",
    modelId: "gemini-3.1-flash-live-preview",
    inputUsdPerMtok: 0.75,
    outputUsdPerMtok: 4.5,
    audioInUsdPerMtok: 3,
    audioOutUsdPerMtok: 12,
    perMinuteUsd: 0.05,
  },
  { provider: "gemini", modelId: "gemini-3.5-transcribe", perMinuteUsd: 0.005 },
  { provider: "anthropic", modelId: "claude-sonnet-4-20250514", inputUsdPerMtok: 3, outputUsdPerMtok: 15 },
  { provider: "groq", modelId: "openai/gpt-oss-20b", inputUsdPerMtok: 0.075, outputUsdPerMtok: 0.3 },
  { provider: "groq", modelId: "whisper-large-v3-turbo", perMinuteUsd: 0.00067 },
];

async function main() {
  const usdInr = await fetchUsdInr();
  const now = new Date().toISOString();
  const { error: fxErr } = await db.from("ai_price_fx").upsert({
    id: 1,
    usdInr,
    asOf: now,
    source: "frankfurter",
    updatedAt: now,
  });
  if (fxErr) throw fxErr;
  console.log(`FX USD/INR = ${usdInr}`);

  for (const row of KNOWN) {
    const { error } = await db.from("ai_model_catalog").upsert(
      {
        provider: row.provider,
        modelId: row.modelId,
        inputUsdPerMtok: row.inputUsdPerMtok ?? null,
        outputUsdPerMtok: row.outputUsdPerMtok ?? null,
        audioInUsdPerMtok: row.audioInUsdPerMtok ?? null,
        audioOutUsdPerMtok: row.audioOutUsdPerMtok ?? null,
        perMinuteUsd: row.perMinuteUsd ?? null,
        source: "price_sync",
        updatedAt: now,
      },
      { onConflict: "provider,modelId" },
    );
    if (error) console.warn(`catalog ${row.provider}/${row.modelId}:`, error.message);
  }
  console.log(`Updated ${KNOWN.length} catalog price rows`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
