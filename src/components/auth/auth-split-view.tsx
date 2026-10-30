"use client";

import { useAppLocale } from "@/components/app-locale-provider";
import { Button } from "@/components/ui/button";
import { DitheredLogo } from "@/components/ui/dithered-logo";
import { CursorDrivenParticleTypography } from "@/components/ui/cursor-driven-particle-typography";
import { LiquidGlassLogoReveal } from "@/components/ui/liquid-glass-logo-reveal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Sparkles,
  User,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState } from "react";

interface AuthSplitViewProps {
  defaultTab?: "login" | "register";
}

type AnimationStage = "glass_center" | "gliding" | "gathering" | "settled";

const INTRO_SESSION_KEY = "skillmark_intro_played";

export function AuthSplitView({ defaultTab = "login" }: AuthSplitViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") || "/dashboard";
  const nextQuery = searchParams.get("next")
    ? `?next=${encodeURIComponent(searchParams.get("next")!)}`
    : "";

  const { toast } = useToast();
  const { t } = useAppLocale();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [activeTab, setActiveTab] = useState<"login" | "register">(defaultTab);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  const switchTab = useCallback(
    (tab: "login" | "register") => {
      setActiveTab(tab);
      router.replace(tab === "login" ? `/login${nextQuery}` : `/register${nextQuery}`);
    },
    [router, nextQuery],
  );

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Animation choreography states
  const [stage, setStage] = useState<AnimationStage>("settled");
  const [isFirstPlay, setIsFirstPlay] = useState(false);
  const [gatherCount, setGatherCount] = useState(0);
  const glassTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Check if intro has already run in this session
    try {
      const played = sessionStorage.getItem(INTRO_SESSION_KEY);
      if (!played) {
        setIsFirstPlay(true);
        setStage("glass_center");
      }
    } catch {
      // Fallback if sessionStorage is disabled
      setStage("settled");
    }
  }, []);

  const advanceFromGlass = useCallback(() => {
    setStage((prev) => {
      if (prev !== "glass_center") return prev;
      return "gliding";
    });

    // Schedule subsequent choreography stages
    setTimeout(() => {
      setStage("gathering");
      setGatherCount((c) => c + 1);
    }, 450);

    setTimeout(() => {
      setStage("settled");
      try {
        sessionStorage.setItem(INTRO_SESSION_KEY, "true");
      } catch {
        // no-op
      }
    }, 1100);
  }, []);

  // Safety fallback timer for glass reveal if WebGL takes too long or device is slow
  useEffect(() => {
    if (stage === "glass_center") {
      glassTimerRef.current = setTimeout(() => {
        advanceFromGlass();
      }, 2600);
    }
    return () => {
      if (glassTimerRef.current) clearTimeout(glassTimerRef.current);
    };
  }, [stage, advanceFromGlass]);

  const replayIntro = () => {
    try {
      sessionStorage.removeItem(INTRO_SESSION_KEY);
    } catch {
      // no-op
    }
    setIsFirstPlay(true);
    setStage("glass_center");
  };

  const supabase = createClient();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        const errorDesc =
          error.message?.toLowerCase().includes("invalid login credentials") ||
          error.message?.toLowerCase().includes("invalid email or password")
            ? "Invalid email or password. If you haven't created an account yet, switch to the 'Create Account' tab above."
            : error.message || "Unable to sign in. Please check your credentials.";
        toast({
          title: "Sign In Failed",
          description: errorDesc,
          variant: "destructive",
        });
        setLoading(false);
      } else {
        window.location.href = nextUrl;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: "Connection Error",
        description:
          msg ||
          "Unable to reach the Skillmark server. Ensure the app and database (docker compose up -d) are running.",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error, data } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name.trim() || undefined,
          },
        },
      });

      if (error) {
        toast({
          title: "Registration Failed",
          description: error.message,
          variant: "destructive",
        });
        setLoading(false);
      } else if (data.session) {
        toast({
          title: "Account Created",
          description: "Welcome to Skillmark! Redirecting...",
        });
        window.location.href = nextUrl;
      } else {
        toast({
          title: "Account Created",
          description: "Sign in with your new credentials.",
        });
        switchTab("login");
        setLoading(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: "Connection Error",
        description: msg || "Unable to complete registration.",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col lg:grid lg:grid-cols-12 bg-background overflow-hidden selection:bg-primary/20">
      {/* ── STAGE 1: Fullscreen Liquid Glass Logo Reveal in Center ── */}
      <AnimatePresence>
        {stage === "glass_center" && (
          <motion.div
            key="liquid-glass-opening-stage"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.94, filter: "blur(8px)" }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-2xl"
          >
            {/* Ambient background glow */}
            <div className="absolute h-96 w-96 rounded-full bg-primary/20 blur-[130px] pointer-events-none animate-pulse" />

            {/* Liquid Glass Reveal Canvas */}
            <div className="relative w-80 h-80 sm:w-96 sm:h-96 flex items-center justify-center">
              <LiquidGlassLogoReveal
                logo="/images/skillmark-logo.png"
                look={isDark ? "dark" : "light"}
                background={isDark ? "#09090b" : "#ffffff"}
                logoColor="#5941F2"
                tileSize={300}
                logoScale={0.7}
                finalScale={0.72}
                loop={false}
                hold={0}
                speed={1.05}
                className="w-full h-full rounded-3xl"
                onComplete={advanceFromGlass}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Left Column: Interactive Dithered Canvas & Branding ── */}
      <div className="relative lg:col-span-6 xl:col-span-7 flex flex-col items-center justify-center p-8 lg:p-14 border-b lg:border-b-0 lg:border-r border-border/40 bg-gradient-to-b from-muted/15 via-background to-muted/20">
        {/* Subtle ambient glow behind canvas */}
        <div className="absolute h-80 w-80 md:h-96 md:w-96 rounded-full bg-primary/15 blur-[120px] pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center text-center max-w-lg">
          {/* Logo element that slides and morphs from center into left column */}
          <motion.div
            key="dithered-logo-container"
            initial={isFirstPlay ? { scale: 1.25, y: -30, opacity: 0 } : false}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{
              type: "spring",
              stiffness: 180,
              damping: 22,
              duration: 0.8,
            }}
            className="relative cursor-pointer transition-transform duration-300 hover:scale-[1.02]"
          >
            <DitheredLogo
              imageSrc="/images/skillmark-logo.png"
              particleColor="#5941F2"
              scale={0.55}
              gridSize={160}
              className="h-64 w-64 sm:h-72 sm:w-72 md:h-80 md:w-80"
            />
          </motion.div>

          {/* Product Brand Title & Tagline with Particle Gathering Typography */}
          <motion.div
            key="particle-typography-container"
            initial={isFirstPlay ? { opacity: 0, y: 20 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: isFirstPlay ? 0.3 : 0 }}
            className="mt-6 w-full max-w-lg h-36 sm:h-40"
          >
            <CursorDrivenParticleTypography
              text="SKILLMARK"
              subtitle="Measure what matters"
              fontSize={54}
              subtitleFontSize={14}
              particleSize={0.7}
              particleDensity={1.1}
              dispersionStrength={13}
              returnSpeed={0.08}
              interactionRadius={75}
              className="h-full w-full"
              gatherOnMount={isFirstPlay}
              triggerGather={gatherCount}
            />
          </motion.div>

          {/* Replay intro action */}
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            onClick={replayIntro}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/50 px-3 py-1 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 transition-all shadow-xs backdrop-blur-sm"
          >
            <Sparkles className="h-3 w-3 text-primary" />
            <span>Replay opening reveal</span>
          </motion.button>
        </div>
      </div>

      {/* ── Right Column: Animated Auth Form & Segmented Controls ── */}
      <div className="lg:col-span-6 xl:col-span-5 flex flex-col items-center justify-center p-6 sm:p-10 lg:p-14">
        <motion.div
          key="auth-form-container"
          initial={isFirstPlay ? { opacity: 0, x: 80, scale: 0.96 } : false}
          animate={stage === "settled" ? { opacity: 1, x: 0, scale: 1 } : isFirstPlay ? { opacity: 0, x: 80, scale: 0.96 } : { opacity: 1, x: 0, scale: 1 }}
          transition={{
            type: "spring",
            stiffness: 170,
            damping: 22,
            duration: 0.8,
          }}
          className="w-full max-w-md space-y-6"
        >
          {/* Animated Segmented Switch */}
          <div className="relative flex rounded-2xl bg-muted/60 p-1.5 border border-border/60 backdrop-blur-md">
            {/* Sliding Pill Active Indicator */}
            <div
              className={cn(
                "absolute inset-y-1.5 rounded-xl bg-primary shadow-sm transition-all duration-300 ease-out",
                activeTab === "login"
                  ? "left-1.5 w-[calc(50%-6px)]"
                  : "left-[calc(50%+3px)] w-[calc(50%-6px)]",
              )}
            />

            <button
              type="button"
              onClick={() => switchTab("login")}
              className={cn(
                "relative z-10 flex-1 py-2.5 text-sm font-semibold transition-colors duration-200 text-center rounded-xl",
                activeTab === "login"
                  ? "text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Sign In
            </button>

            <button
              type="button"
              onClick={() => switchTab("register")}
              className={cn(
                "relative z-10 flex-1 py-2.5 text-sm font-semibold transition-colors duration-200 text-center rounded-xl",
                activeTab === "register"
                  ? "text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Create Account
            </button>
          </div>

          {/* Auth Card Container */}
          <div className="rounded-2xl border border-border/80 bg-card/90 p-8 shadow-xl shadow-black/5 backdrop-blur-lg transition-all duration-300">
            <div className="mb-6 space-y-1">
              <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">
                {activeTab === "login"
                  ? t("auth.welcomeBack") || "Welcome back"
                  : t("auth.createAccount") || "Get started with Skillmark"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {activeTab === "login"
                  ? t("auth.signInSubtitle") || "Enter your credentials to access your dashboard"
                  : "Create your recruiter or admin account in seconds"}
              </p>
            </div>

            {/* Form */}
            <form
              onSubmit={activeTab === "login" ? handleSignIn : handleSignUp}
              className="space-y-4"
            >
              {activeTab === "register" && (
                <div className="space-y-2 animate-in fade-in-50 duration-200">
                  <Label htmlFor="auth-name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Full Name
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      id="auth-name"
                      type="text"
                      placeholder="Jane Doe"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="pl-10 h-11 rounded-xl bg-background border-border/80 focus-visible:ring-primary"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="auth-email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("auth.email") || "Email Address"}
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="auth-email"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-10 h-11 rounded-xl bg-background border-border/80 focus-visible:ring-primary"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auth-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("auth.password") || "Password"}
                  </Label>
                  {activeTab === "login" && (
                    <span className="text-xs text-muted-foreground/80 hover:text-primary transition-colors cursor-pointer">
                      Forgot password?
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="pl-10 pr-10 h-11 rounded-xl bg-background border-border/80 focus-visible:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-3 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 mt-2 rounded-xl bg-primary text-primary-foreground font-semibold shadow-md shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    <span>Please wait...</span>
                  </div>
                ) : (
                  <>
                    <span>
                      {activeTab === "login"
                        ? t("auth.signIn") || "Sign In"
                        : t("auth.createAccount") || "Create Account"}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </div>

          {/* Footer details */}
          <div className="text-center text-xs text-muted-foreground/80 leading-relaxed">
            By continuing, you agree to Skillmark&apos;s Terms of Service and Privacy Policy.
          </div>
        </motion.div>
      </div>
    </div>
  );
}
