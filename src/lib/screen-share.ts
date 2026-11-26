/**
 * Screen-share rules for the round-1 device check and interview entry.
 * Pure and unit-tested: whether a share is enough to start, whether the
 * browser can share, and the copy shown when it cannot.
 */

export const ENTIRE_SCREEN_SURFACE = "monitor";

export type ScreenShareSupport = "available" | "unsupported";

export type ScreenShareStartEvent = { status: string } | null;

/** True when this browser exposes getDisplayMedia (secure context + API). */
export function canUseDisplayMedia(mediaDevices?: { getDisplayMedia?: unknown } | null): boolean {
  return typeof mediaDevices?.getDisplayMedia === "function";
}

/**
 * Phone / tablet UA (including iPadOS, which reports as Macintosh with touch).
 * Used only to relax the "entire screen" rule — support itself is feature-detected.
 */
export function isLikelyMobileDevice(
  userAgent: string,
  opts: { maxTouchPoints?: number } = {},
): boolean {
  const ua = userAgent || "";
  if (/iPhone|iPod|Android.+Mobile|webOS|BlackBerry|Opera Mini|IEMobile|Mobile Safari/i.test(ua)) {
    return true;
  }
  if (/Android/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  // iPadOS 13+ defaults to a desktop Macintosh UA; touch points give it away.
  if (/Macintosh/i.test(ua) && (opts.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

export function screenShareSupport(mediaDevices?: { getDisplayMedia?: unknown } | null): ScreenShareSupport {
  return canUseDisplayMedia(mediaDevices) ? "available" : "unsupported";
}

/** The share is a full screen, or the browser did not report a surface (treat as accepted). */
export function isEntireScreenShare(displaySurface?: string | null): boolean {
  if (!displaySurface) return true;
  return displaySurface === ENTIRE_SCREEN_SURFACE;
}

/** Desktop: require Entire Screen when the browser reports a surface. Mobile: any share. */
export function mustBeEntireScreen(opts: { isMobile?: boolean } = {}): boolean {
  return !opts.isMobile;
}

export function isAcceptableScreenShare(
  displaySurface: string | null | undefined,
  opts: { isMobile?: boolean } = {},
): boolean {
  if (!mustBeEntireScreen(opts)) return true;
  return isEntireScreenShare(displaySurface);
}

/** Constraints that ask the picker to prefer the entire screen, without tightening the fallback. */
export function displayMediaOptions(): Record<string, unknown> {
  return {
    video: { displaySurface: ENTIRE_SCREEN_SURFACE },
    preferCurrentTab: false,
  };
}

/**
 * The interview UI may render only when a live screen share is in hand,
 * except interviewer preview (and tests) which skip the device check.
 */
export function canEnterInterview(opts: { isPreview?: boolean; hasActiveScreenShare: boolean }): boolean {
  if (opts.isPreview) return true;
  return opts.hasActiveScreenShare;
}

/**
 * Server start hook: a first begin is allowed only when preflight recorded
 * screen_share/started. If the events table cannot be read, do not block.
 * A later resume (interview already began) is not checked here.
 */
export function canBeginInterviewFromPreflight(opts: {
  eventsAvailable: boolean;
  latestScreenShare?: ScreenShareStartEvent;
}): { ok: true } | { ok: false; error: string } {
  if (!opts.eventsAvailable) return { ok: true };
  if (opts.latestScreenShare?.status === "started") return { ok: true };
  return { ok: false, error: SCREEN_SHARE_REQUIRED_START };
}

export const SCREEN_SHARE_REQUIRED_START =
  "Screen sharing is required before the interview can start. Share your entire screen, then try again.";

export const SCREEN_SHARE_UNSUPPORTED_TITLE = "This interview needs a computer";

export const SCREEN_SHARE_UNSUPPORTED_BODY =
  "This interview needs a laptop or desktop browser with screen sharing (Chrome, Edge, Firefox, or Safari). Your current browser cannot share the screen.";

export const SCREEN_SHARE_DENIED_HELP =
  "Allow screen recording for this browser, then click Retry and choose Entire screen — not a window or tab. On a Mac: System Settings → Privacy & Security → Screen Recording.";

export const SCREEN_SHARE_NOT_ENTIRE_HELP =
  "Please share your entire screen, not a window or tab. Click Retry and select Entire screen.";

export const SCREEN_SHARE_FAILED_HELP =
  "Screen sharing failed. Click Retry and choose Entire screen.";

export const SCREEN_SHARE_STOPPED_TITLE = "Screen sharing stopped";

export const SCREEN_SHARE_STOPPED_BODY =
  "Please share your entire screen again to continue the interview.";

export function screenShareErrorHelp(
  kind: "denied" | "not_entire" | "unsupported" | "failed",
): string {
  if (kind === "denied") return SCREEN_SHARE_DENIED_HELP;
  if (kind === "not_entire") return SCREEN_SHARE_NOT_ENTIRE_HELP;
  if (kind === "unsupported") return SCREEN_SHARE_UNSUPPORTED_BODY;
  return SCREEN_SHARE_FAILED_HELP;
}
