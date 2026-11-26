import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canBeginInterviewFromPreflight,
  canEnterInterview,
  canUseDisplayMedia,
  displayMediaOptions,
  ENTIRE_SCREEN_SURFACE,
  isAcceptableScreenShare,
  isEntireScreenShare,
  isLikelyMobileDevice,
  mustBeEntireScreen,
  SCREEN_SHARE_REQUIRED_START,
  screenShareErrorHelp,
  screenShareSupport,
} from "@/lib/screen-share";

describe("getDisplayMedia is feature-detected", () => {
  it("is available only when the function exists", () => {
    assert.equal(canUseDisplayMedia(undefined), false);
    assert.equal(canUseDisplayMedia({}), false);
    assert.equal(canUseDisplayMedia({ getDisplayMedia: true }), false);
    assert.equal(canUseDisplayMedia({ getDisplayMedia: async () => null }), true);
    assert.equal(screenShareSupport({ getDisplayMedia: async () => null }), "available");
    assert.equal(screenShareSupport({}), "unsupported");
  });
});

describe("mobile UA is recognised (for the entire-screen rule only)", () => {
  it("treats phones, Android, iPad and iPadOS-as-Macintosh as mobile", () => {
    assert.equal(isLikelyMobileDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)"), true);
    assert.equal(isLikelyMobileDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131.0.0.0 Mobile Safari/537.36"), true);
    assert.equal(isLikelyMobileDevice("Mozilla/5.0 (Linux; Android 14; SM-X810) AppleWebKit/537.36"), true);
    assert.equal(isLikelyMobileDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), true);
    assert.equal(isLikelyMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", { maxTouchPoints: 5 }), true);
  });
  it("does not treat a desktop computer as mobile", () => {
    assert.equal(isLikelyMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0.0.0 Safari/537.36", { maxTouchPoints: 0 }), false);
    assert.equal(isLikelyMobileDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36"), false);
  });
});

describe("entire-screen rule is kept on desktop and not loosened", () => {
  it("accepts monitor, and a share with no reported surface", () => {
    assert.equal(isEntireScreenShare("monitor"), true);
    assert.equal(isEntireScreenShare(undefined), true);
    assert.equal(isEntireScreenShare(null), true);
    assert.equal(isEntireScreenShare("window"), false);
    assert.equal(isEntireScreenShare("browser"), false);
  });
  it("requires entire screen on desktop, accepts any share on mobile", () => {
    assert.equal(mustBeEntireScreen({ isMobile: false }), true);
    assert.equal(mustBeEntireScreen({ isMobile: true }), false);
    assert.equal(isAcceptableScreenShare("browser", { isMobile: false }), false);
    assert.equal(isAcceptableScreenShare("monitor", { isMobile: false }), true);
    assert.equal(isAcceptableScreenShare("browser", { isMobile: true }), true);
  });
  it("asks the picker for the entire screen", () => {
    const opts = displayMediaOptions();
    assert.equal((opts.video as { displaySurface: string }).displaySurface, ENTIRE_SCREEN_SURFACE);
    assert.equal(opts.preferCurrentTab, false);
  });
});

describe("interview entry cannot be bypassed", () => {
  it("blocks a missing share, including a refresh or a direct URL", () => {
    assert.equal(canEnterInterview({ hasActiveScreenShare: false }), false);
    assert.equal(canEnterInterview({ hasActiveScreenShare: false, isPreview: false }), false);
  });
  it("allows entry once a live share is in hand, and in interviewer preview", () => {
    assert.equal(canEnterInterview({ hasActiveScreenShare: true }), true);
    assert.equal(canEnterInterview({ hasActiveScreenShare: false, isPreview: true }), true);
  });
});

describe("server start requires a recorded screen share", () => {
  it("rejects skipped, denied, stopped, or missing events", () => {
    for (const status of ["skipped", "denied", "stopped", "failed", "error"]) {
      const r = canBeginInterviewFromPreflight({ eventsAvailable: true, latestScreenShare: { status } });
      assert.equal(r.ok, false, status);
      if (!r.ok) assert.equal(r.error, SCREEN_SHARE_REQUIRED_START);
    }
    const missing = canBeginInterviewFromPreflight({ eventsAvailable: true, latestScreenShare: null });
    assert.equal(missing.ok, false);
  });
  it("allows start after screen_share started", () => {
    const r = canBeginInterviewFromPreflight({ eventsAvailable: true, latestScreenShare: { status: "started" } });
    assert.equal(r.ok, true);
  });
  it("does not block when preflight events cannot be read", () => {
    const r = canBeginInterviewFromPreflight({ eventsAvailable: false, latestScreenShare: null });
    assert.equal(r.ok, true);
  });
});

describe("error copy is short and tells the candidate what to do", () => {
  it("mentions Retry, Entire screen, and macOS Screen Recording for a denial", () => {
    assert.match(screenShareErrorHelp("denied"), /Retry/);
    assert.match(screenShareErrorHelp("denied"), /Entire screen/);
    assert.match(screenShareErrorHelp("denied"), /Screen Recording/);
    assert.match(screenShareErrorHelp("not_entire"), /Entire screen/);
    assert.match(screenShareErrorHelp("unsupported"), /laptop or desktop/);
  });
});

describe("client and server wiring (source checks)", async () => {
  const { readFileSync } = await import("node:fs");
  const onboarding = readFileSync("src/components/session/interviewee-onboarding.tsx", "utf8");
  const start = readFileSync("src/app/api/session/start/route.ts", "utf8");
  const invite = readFileSync("src/app/i/invite/[token]/session/page.tsx", "utf8");
  const slug = readFileSync("src/app/i/[slug]/session/page.tsx", "utf8");
  const screenFn = onboarding.slice(
    onboarding.indexOf("function ScreenCheck"),
    onboarding.indexOf("export function IntervieweeOnboarding"),
  );

  it("removes the screen-share skip and auto-skip paths", () => {
    assert.equal(onboarding.includes("setScreenSkipped"), false);
    assert.equal(screenFn.includes("automatically skipped"), false);
    assert.equal(screenFn.includes("Skip anyway"), false);
    assert.equal(screenFn.includes("allowSkip"), false);
    assert.match(onboarding, /if \(!getStoredScreenStream\(\)\)/);
  });

  it("checks screen_share on first session start, and wraps both interview pages", () => {
    assert.match(start, /latestPreflightEvent\(sessionId, "screen_share"\)/);
    assert.match(start, /canBeginInterviewFromPreflight/);
    assert.match(invite, /<ScreenShareGate/);
    assert.match(slug, /<ScreenShareGate/);
    assert.match(slug, /optional=\{isPreview\}/);
  });
});
