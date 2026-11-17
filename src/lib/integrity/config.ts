/**
 * Effective integrity settings. Lip-sync, reading-pattern and liveness checks
 * consume the head tracker's face frames, so each level requires the one
 * before it: anti-cheat → head tracking → integrity checks → liveness.
 */
export interface IntegrityConfigInput {
  antiCheatingEnabled?: boolean | null;
  headMovementDetectionEnabled?: boolean | null;
  integrityChecksEnabled?: boolean | null;
  livenessChallengesEnabled?: boolean | null;
}

export interface IntegrityConfig {
  headMovementDetectionEnabled: boolean;
  integrityChecksEnabled: boolean;
  livenessChallengesEnabled: boolean;
}

export function effectiveIntegrityConfig(c: IntegrityConfigInput | null | undefined): IntegrityConfig {
  const head = !!c?.antiCheatingEnabled && !!c?.headMovementDetectionEnabled;
  const integrity = head && !!c?.integrityChecksEnabled;
  return {
    headMovementDetectionEnabled: head,
    integrityChecksEnabled: integrity,
    livenessChallengesEnabled: integrity && !!c?.livenessChallengesEnabled,
  };
}
