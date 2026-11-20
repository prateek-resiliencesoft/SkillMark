-- ────────────────────────────────────────────────────────────
-- 41-atomic-strike-append.sql: append one anti-cheating violation atomically.
--
-- session.reportAntiCheatingViolation used to read antiCheatingLog, append in JS
-- and write the whole array back, so concurrent reports (two guards, or a
-- candidate firing requests in parallel) overwrote each other and lost strikes
-- before the disqualification threshold. This function locks the session row,
-- appends, counts strikes and applies the DISQUALIFIED transition in one
-- transaction. Ended, superseded or archived sessions are never modified.
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.append_anti_cheating_violation(
  p_session_id uuid,
  p_violation jsonb,
  p_strike_types text[],
  p_max_strikes integer,
  p_last_label text DEFAULT NULL,
  p_max_log integer DEFAULT 500
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_session    sessions;
  v_log        jsonb;
  v_strikes    integer;
  v_disqualify boolean := false;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_log := CASE WHEN jsonb_typeof(v_session."antiCheatingLog") = 'array'
                THEN v_session."antiCheatingLog" ELSE '[]'::jsonb END;

  IF v_session.status::text <> 'IN_PROGRESS'
     OR v_session."supersededAt" IS NOT NULL
     OR v_session."dataArchivedAt" IS NOT NULL
     OR jsonb_array_length(v_log) >= p_max_log THEN
    SELECT count(*) INTO v_strikes FROM jsonb_array_elements(v_log) e WHERE e->>'type' = ANY(p_strike_types);
    RETURN jsonb_build_object('applied', false, 'status', v_session.status::text, 'strikes', v_strikes, 'disqualify', false, 'log', v_log);
  END IF;

  v_log := v_log || jsonb_build_array(p_violation);
  SELECT count(*) INTO v_strikes FROM jsonb_array_elements(v_log) e WHERE e->>'type' = ANY(p_strike_types);
  v_disqualify := (p_violation->>'type') = ANY(p_strike_types) AND v_strikes >= p_max_strikes;

  IF v_disqualify THEN
    v_log := v_log || jsonb_build_array(jsonb_build_object(
      'type', 'disqualified',
      'timestamp', p_violation->'timestamp',
      'detail', format('Disqualified after %s anti-cheating violations (last: %s)', v_strikes, coalesce(p_last_label, p_violation->>'type'))
    ));
    UPDATE sessions
       SET "antiCheatingLog" = v_log, status = 'DISQUALIFIED', "completedAt" = now()
     WHERE id = p_session_id;
  ELSE
    UPDATE sessions SET "antiCheatingLog" = v_log WHERE id = p_session_id;
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'status', CASE WHEN v_disqualify THEN 'DISQUALIFIED' ELSE v_session.status::text END,
    'strikes', v_strikes,
    'disqualify', v_disqualify,
    'log', v_log
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
