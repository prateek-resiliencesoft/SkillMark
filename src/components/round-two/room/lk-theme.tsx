"use client";

import { StartAudio } from "@livekit/components-react";

/**
 * LiveKit's `[data-lk-theme]` forces `color: #fff` and a dark color-scheme on every
 * descendant. Scope it to LiveKit widgets only (video tiles, device toggles, PreJoin),
 * never to page shells, so app text keeps the light/dark design tokens.
 */
export const LK_THEME = { "data-lk-theme": "default" } as const;

/** Browser autoplay unlock, themed and floating so it never shifts the layout. */
export function AudioUnlock() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center" {...LK_THEME}>
      <StartAudio label="Click to enable audio" className="lk-button pointer-events-auto shadow-lg" />
    </div>
  );
}
