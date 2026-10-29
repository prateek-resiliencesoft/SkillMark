"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTheme } from "next-themes";
import { Hugeicon, Sun01Icon, Moon02Icon } from "@/components/ui/hugeicon";
import { FlippingWordSwap } from "@/components/ui/flipping-word-swap";
import { cn } from "@/lib/utils";

interface ThemeTransitionContextType {
  toggleTheme: () => void;
  setThemeWithTransition: (target: "light" | "dark") => void;
  isTransitioning: boolean;
  targetTheme: "light" | "dark" | null;
}

const ThemeTransitionContext = createContext<ThemeTransitionContextType>({
  toggleTheme: () => {},
  setThemeWithTransition: () => {},
  isTransitioning: false,
  targetTheme: null,
});

export function useThemeTransition() {
  return useContext(ThemeTransitionContext);
}

export function ThemeTransitionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [sourceTheme, setSourceTheme] = useState<"light" | "dark">("light");
  const [targetTheme, setTargetTheme] = useState<"light" | "dark" | null>(null);
  const [fadeState, setFadeState] = useState<"entering" | "active" | "leaving">("entering");
  const [isWordSwapped, setIsWordSwapped] = useState(false);
  const timeoutRefs = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    setMounted(true);
    return () => {
      timeoutRefs.current.forEach(clearTimeout);
    };
  }, []);

  const setThemeWithTransition = useCallback(
    (target: "light" | "dark") => {
      const current = (resolvedTheme || theme || "light") as "light" | "dark";
      if (current === target && !isTransitioning) {
        return;
      }

      // Clear any pending timeouts
      timeoutRefs.current.forEach(clearTimeout);
      timeoutRefs.current = [];

      setSourceTheme(current);
      setTargetTheme(target);
      setIsTransitioning(true);
      setIsWordSwapped(false);
      setFadeState("entering");

      // Step 1: Smoothly ramp in blur and floating typography (duration 650ms)
      const t0 = setTimeout(() => {
        setFadeState("active");
      }, 30);

      // Step 2: At peak blur, trigger character-by-character flipping word swap
      const t1 = setTimeout(() => {
        setIsWordSwapped(true);
      }, 520);

      // Step 3: Mid-flip, seamlessly apply theme so colors shift smoothly behind blur
      const t2 = setTimeout(() => {
        setTheme(target);
      }, 820);

      // Step 4: After new theme settles, slowly and gradually fade out the blur
      const t3 = setTimeout(() => {
        setFadeState("leaving");
      }, 1650);

      // Step 5: Complete transition and clean up
      const t4 = setTimeout(() => {
        setIsTransitioning(false);
        setTargetTheme(null);
        setIsWordSwapped(false);
      }, 2500);

      timeoutRefs.current = [t0, t1, t2, t3, t4];
    },
    [resolvedTheme, theme, isTransitioning, setTheme],
  );

  const toggleTheme = useCallback(() => {
    const current = (resolvedTheme || theme || "light") as "light" | "dark";
    const next = current === "dark" ? "light" : "dark";
    setThemeWithTransition(next);
  }, [resolvedTheme, theme, setThemeWithTransition]);

  return (
    <ThemeTransitionContext.Provider
      value={{
        toggleTheme,
        setThemeWithTransition,
        isTransitioning,
        targetTheme,
      }}
    >
      {children}
      {mounted && isTransitioning && targetTheme && (
        <ThemeSwitchOverlay
          sourceTheme={sourceTheme}
          targetTheme={targetTheme}
          fadeState={fadeState}
          isWordSwapped={isWordSwapped}
        />
      )}
    </ThemeTransitionContext.Provider>
  );
}

function ThemeSwitchOverlay({
  sourceTheme,
  targetTheme,
  fadeState,
  isWordSwapped,
}: {
  sourceTheme: "light" | "dark";
  targetTheme: "light" | "dark";
  fadeState: "entering" | "active" | "leaving";
  isWordSwapped: boolean;
}) {
  const isDarkTarget = targetTheme === "dark";

  // Determine starting and ending words for flipping word swap
  const word1 = sourceTheme === "dark" ? "Dark" : "Light";
  const word2 = targetTheme === "dark" ? "Dark" : "Light";

  return (
    <aside
      aria-label="Theme transition notification"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-0 z-[99999] flex items-center justify-center select-none",
        // Smooth, slow, gradual blur ramp in and fade out
        fadeState === "entering" && "opacity-0 backdrop-blur-none bg-background/0 transition-none",
        fadeState === "active" &&
          "opacity-100 backdrop-blur-2xl bg-background/65 transition-all duration-700 ease-out",
        fadeState === "leaving" &&
          "opacity-0 backdrop-blur-none bg-background/0 transition-all duration-800 ease-in-out",
      )}
    >
      {/* Radial ambient glow tint */}
      <div
        className={cn(
          "absolute inset-0 pointer-events-none transition-opacity duration-700",
          isDarkTarget
            ? "bg-[radial-gradient(ellipse_at_center,_rgba(89,65,242,0.22),transparent_70%)]"
            : "bg-[radial-gradient(ellipse_at_center,_rgba(41,108,242,0.16),transparent_70%)]",
          fadeState === "active" ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Only Dark Mode / Light Mode with Flipping Word Swap animation */}
      <div
        className={cn(
          "relative z-10 px-6 text-center select-none transition-all ease-out",
          fadeState === "entering" && "opacity-0 scale-95 translate-y-1.5",
          fadeState === "active" &&
            "opacity-100 scale-100 translate-y-0 duration-600",
          fadeState === "leaving" &&
            "opacity-0 scale-95 -translate-y-1.5 duration-700 ease-in-out",
        )}
      >
        <div className="flex items-baseline justify-center gap-3">
          <FlippingWordSwap
            word1={word1}
            word2={word2}
            isSwapped={isWordSwapped}
            duration={520}
            stagger={50}
            className="font-heading text-4xl sm:text-6xl font-bold tracking-tight text-foreground drop-shadow-md"
            toClassName="font-heading text-4xl sm:text-6xl font-bold tracking-tight text-foreground drop-shadow-md"
          />
          <span className="font-heading text-4xl sm:text-6xl font-bold tracking-tight text-foreground drop-shadow-md">
            Mode
          </span>
        </div>
      </div>
    </aside>
  );
}

export function ThemeSwitcherButton({
  className,
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { resolvedTheme, theme } = useTheme();
  const { toggleTheme } = useThemeTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 bg-background/50",
          className,
        )}
      />
    );
  }

  const isDark = (resolvedTheme || theme) === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      className={cn(
        "group relative inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-2.5 py-1.5 text-sm font-medium text-foreground transition-all duration-200",
        "hover:border-primary/50 hover:bg-muted/80 hover:text-primary hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
        className,
      )}
    >
      <div className="relative flex h-4 w-4 items-center justify-center">
        {isDark ? (
          <Hugeicon icon={Sun01Icon} className="h-4 w-4 text-amber-400 transition-transform duration-300 group-hover:rotate-45" />
        ) : (
          <Hugeicon icon={Moon02Icon} className="h-4 w-4 text-primary transition-transform duration-300 group-hover:-rotate-12" />
        )}
      </div>
      {showLabel && (
        <span className="text-xs font-medium">
          {isDark ? "Light Mode" : "Dark Mode"}
        </span>
      )}
    </button>
  );
}
