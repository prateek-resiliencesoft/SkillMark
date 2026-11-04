"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { WaterCaustics } from "@/components/ui/water-caustics";

/** Full-page auth background: theme-matched WebGL water caustics (one shared canvas). */
export function AuthHeroDecor() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [small, setSmall] = useState(false);
  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(max-width: 1023px)");
    const on = () => setSmall(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  if (!mounted) return null;
  const dark = resolvedTheme === "dark";

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <WaterCaustics
        palette={
          dark
            ? ["#140d33", "#3a2690", "#5941F2", "#D9328E", "#fff1f8"]
            : ["#e9e6fb", "#cfc6fb", "#a99af7", "#f0a8cb", "#ffffff"]
        }
        // Lightened + theme-blended: lavender (#5941F2 family) in light, app dark bg in dark.
        bg={dark ? "#0b0a14" : "#d9d3fb"}
        bgAlpha={0.6}
        speed={0.64}
        scale={1.27}
        intensity={0.04}
        dispersion={0.21}
        rays={0.36}
        depth={dark ? 0.55 : 0.4}
        wobble={0.46}
        mouse={small ? 0 : 0.39}
        ambient={0.5}
      />
    </div>
  );
}

/** Soft radial scrim placed behind the logo/wordmark so they stay readable over the caustics. */
export function AuthHeroScrim() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(255,255,255,0.6),transparent_75%)] dark:[background:radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(13,11,22,0.55),transparent_75%)]"
    />
  );
}
