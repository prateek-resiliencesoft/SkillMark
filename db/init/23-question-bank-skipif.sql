-- Skip conditions on question-bank items (copied onto interview questions).
ALTER TABLE public.question_bank_items
  ADD COLUMN IF NOT EXISTS "skipIf" jsonb;

-- Heuristic defaults: skip location / current-role premade Qs when intro already covered them.
UPDATE public.question_bank_items
SET "skipIf" = jsonb_build_object(
  'answerContainsAny', to_jsonb(ARRAY[
    'live', 'living', 'location', 'city', 'based in', 'located in'
  ]),
  'reason', 'Covered in intro (location)'
)
WHERE "skipIf" IS NULL
  AND (
    text ~* 'where do you live'
    OR text ~* 'where are you (based|located|from)'
    OR text ~* 'current(ly)? (city|location|residence)'
    OR text ~* 'which city'
  );

UPDATE public.question_bank_items
SET "skipIf" = jsonb_build_object(
  'answerContainsAny', to_jsonb(ARRAY[
    'currently working', 'currently doing', 'work at', 'working as', 'my job', 'i work', 'employed'
  ]),
  'reason', 'Covered in intro (current role)'
)
WHERE "skipIf" IS NULL
  AND (
    text ~* 'what (are you|do you) currently (doing|work)'
    OR text ~* 'current(ly)? (role|job|position|occupation)'
    OR text ~* 'where (do|are) you (currently )?work'
    OR text ~* 'what do you do (for (a )?living|now)'
  );
