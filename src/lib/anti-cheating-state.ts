/**
 * Browser-side coordination between anti-cheating detectors so one event
 * isn't double-counted: while any of our own warning modals is open, or a
 * permission prompt (camera/mic) is expected, page-departure / head events
 * are ignored.
 */
let openModals = 0;
let suppressUntil = 0;
let ended = false;

export function markModalOpen(open: boolean) {
  openModals = Math.max(0, openModals + (open ? 1 : -1));
  // Short grace after closing so the click on OK / refocus isn't counted.
  if (!open) suppressUntil = Math.max(suppressUntil, Date.now() + 3000);
}

export function isAnyModalOpen() {
  return openModals > 0;
}

/** e.g. before getUserMedia(): the permission bubble steals focus. */
export function suppressDetections(ms: number) {
  suppressUntil = Math.max(suppressUntil, Date.now() + ms);
}

export function detectionsSuppressed() {
  return ended || openModals > 0 || Date.now() < suppressUntil;
}

export function markInterviewEnded() {
  ended = true;
}

/** Test helper. */
export function resetAntiCheatingState() {
  openModals = 0;
  suppressUntil = 0;
  ended = false;
}
