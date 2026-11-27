-- AI Studio: model catalog, FX, and superadmin preset templates.

CREATE TABLE IF NOT EXISTS ai_price_fx (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  "usdInr" numeric NOT NULL,
  "asOf" timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'seed',
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_price_fx (id, "usdInr", source)
VALUES (1, 93.0, 'seed')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_model_catalog (
  provider text NOT NULL,
  "modelId" text NOT NULL,
  "displayName" text,
  description text,
  modalities text[] NOT NULL DEFAULT '{}',
  "qualityTier" smallint NOT NULL DEFAULT 3 CHECK ("qualityTier" BETWEEN 1 AND 5),
  "suitableTasks" text[] NOT NULL DEFAULT '{}',
  "inputUsdPerMtok" numeric,
  "outputUsdPerMtok" numeric,
  "audioInUsdPerMtok" numeric,
  "audioOutUsdPerMtok" numeric,
  "perMinuteUsd" numeric,
  source text NOT NULL DEFAULT 'seed',
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, "modelId")
);

CREATE TABLE IF NOT EXISTS ai_preset_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  blurb text NOT NULL DEFAULT '',
  published boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdBy" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_preset_templates_published_idx
  ON ai_preset_templates (published) WHERE published = true;

-- Seed a few defaults used by Studio suggestions (rates approximate; sync job refreshes).
INSERT INTO ai_model_catalog (
  provider, "modelId", "displayName", description, modalities, "qualityTier",
  "suitableTasks", "inputUsdPerMtok", "outputUsdPerMtok", "audioInUsdPerMtok",
  "audioOutUsdPerMtok", "perMinuteUsd", source
) VALUES
  (
    'openai', 'gpt-4o-mini', 'GPT-4o mini', 'Fast cheap text model',
    ARRAY['text'], 3,
    ARRAY['screening','standard','interview','generate','resume','report','heavy','round2_live','round2_scoring','round2_report'],
    0.15, 0.60, NULL, NULL, NULL, 'seed'
  ),
  (
    'openai', 'gpt-4o', 'GPT-4o', 'Strong reports and reasoning',
    ARRAY['text'], 5,
    ARRAY['report','heavy','round2_report','generate','standard'],
    2.50, 10.00, NULL, NULL, NULL, 'seed'
  ),
  (
    'openai', 'gpt-4.1', 'GPT-4.1', 'Strong general text model',
    ARRAY['text'], 5,
    ARRAY['report','heavy','round2_report','generate','standard'],
    2.00, 8.00, NULL, NULL, NULL, 'seed'
  ),
  (
    'openai', 'gpt-4.1-mini', 'GPT-4.1 mini', 'Cheaper GPT-4.1 tier',
    ARRAY['text'], 3,
    ARRAY['screening','standard','interview','generate','resume','report'],
    0.40, 1.60, NULL, NULL, NULL, 'seed'
  ),
  (
    'openai', 'gpt-5', 'GPT-5', 'Flagship GPT-5 text',
    ARRAY['text'], 5,
    ARRAY['report','heavy','round2_report','generate','standard'],
    1.25, 10.00, NULL, NULL, NULL, 'seed'
  ),
  (
    'openai', 'gpt-5-mini', 'GPT-5 mini', 'Balanced GPT-5 tier',
    ARRAY['text'], 4,
    ARRAY['screening','standard','interview','generate','resume','report','round2_live','round2_scoring'],
    0.25, 2.00, NULL, NULL, NULL, 'seed'
  ),
  (
    'openai', 'gpt-5-nano', 'GPT-5 nano', 'Cheapest GPT-5 tier',
    ARRAY['text'], 2,
    ARRAY['screening','standard','interview','generate','resume'],
    0.05, 0.40, NULL, NULL, NULL, 'seed'
  ),
  (
    'openai', 'o3', 'o3', 'Reasoning model',
    ARRAY['text'], 5,
    ARRAY['report','heavy','round2_report'],
    2.00, 8.00, NULL, NULL, NULL, 'seed'
  ),
  (
    'openai', 'o3-mini', 'o3 mini', 'Smaller reasoning model',
    ARRAY['text'], 4,
    ARRAY['report','heavy','generate','standard'],
    1.10, 4.40, NULL, NULL, NULL, 'seed'
  ),
  (
    'openai', 'gpt-realtime-1.5', 'GPT Realtime 1.5', 'OpenAI Realtime voice (priciest)',
    ARRAY['audio','text'], 5,
    ARRAY['voice'],
    4.00, 16.00, 32.00, 64.00, 0.40, 'seed'
  ),
  (
    'openai', 'gpt-4o-mini-transcribe', 'GPT-4o mini Transcribe', 'OpenAI STT',
    ARRAY['audio'], 3,
    ARRAY['round2_transcript'],
    NULL, NULL, NULL, NULL, 0.003, 'seed'
  ),
  (
    'gemini', 'gemini-3.6-flash', 'Gemini 3.6 Flash', 'Default Gemini text Flash',
    ARRAY['text'], 3,
    ARRAY['screening','standard','interview','generate','resume','report','heavy','round2_live','round2_scoring','round2_report'],
    0.75, 3.75, NULL, NULL, NULL, 'seed'
  ),
  (
    'gemini', 'gemini-3.1-flash-live-preview', 'Gemini 3.1 Flash Live', 'Gemini Live voice',
    ARRAY['audio','text'], 4,
    ARRAY['voice'],
    0.75, 4.50, 3.00, 12.00, 0.05, 'seed'
  ),
  (
    'gemini', 'gemini-3.5-transcribe', 'Gemini 3.5 Transcribe', 'Gemini STT',
    ARRAY['audio'], 3,
    ARRAY['round2_transcript'],
    NULL, NULL, NULL, NULL, 0.005, 'seed'
  ),
  (
    'anthropic', 'claude-sonnet-4-20250514', 'Claude Sonnet 4', 'Strong writing / analysis',
    ARRAY['text'], 5,
    ARRAY['report','heavy','round2_report','generate','standard','round2_live'],
    3.00, 15.00, NULL, NULL, NULL, 'seed'
  ),
  (
    'groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B (Groq)', 'Fast cheap text on Groq',
    ARRAY['text'], 2,
    ARRAY['screening','standard','interview','generate','resume','round2_live','round2_scoring'],
    0.075, 0.30, NULL, NULL, NULL, 'seed'
  ),
  (
    'groq', 'whisper-large-v3-turbo', 'Whisper Large v3 Turbo', 'Groq STT',
    ARRAY['audio'], 3,
    ARRAY['round2_transcript'],
    NULL, NULL, NULL, NULL, 0.00067, 'seed'
  )
ON CONFLICT (provider, "modelId") DO NOTHING;
