"use client";

import { BrandWordmark } from "@/components/ui/brand-wordmark";
import Image from "next/image";
import { useAppLocale } from "@/components/app-locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  CalendarClock,
  Eye,
  EyeOff,
  FileBarChart2,
  Lock,
  LogIn,
  Mail,
  Mic,
  ShieldCheck,
  User,
  UserPlus,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState } from "react";

interface AuthSplitViewProps {
  defaultTab?: "login" | "register";
}

export function AuthSplitView({ defaultTab = "login" }: AuthSplitViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next");
  const nextUrl =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.includes("://")
      ? rawNext
      : "/dashboard";
  const addMode = searchParams.has("add");
  const prefillEmail = searchParams.get("email") ?? "";
  const sessionExpired = searchParams.get("reason") === "session_expired";
  const nextQuery = (() => {
    const q = new URLSearchParams();
    if (rawNext && nextUrl === rawNext) q.set("next", rawNext);
    if (addMode) q.set("add", "1");
    const str = q.toString();
    return str ? `?${str}` : "";
  })();

  const { toast } = useToast();
  const { t } = useAppLocale();

  const [activeTab, setActiveTab] = useState<"login" | "register">(defaultTab);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  const switchTab = useCallback(
    (tab: "login" | "register") => {
      if (tab === activeTab) return;
      setActiveTab(tab);
      // Update the URL without a route change, so the page shell never remounts.
      const url = tab === "login" ? `/login${nextQuery}` : `/register${nextQuery}`;
      window.history.replaceState(window.history.state, "", url);
    },
    [activeTab, nextQuery],
  );

  // Keep the tab in sync if the URL changes underneath us (back/forward).
  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname;
      if (path.startsWith("/register")) setActiveTab("register");
      else if (path.startsWith("/login")) setActiveTab("login");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Smooth card height between the login and register forms.
  const cardContentRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState<number | "auto">("auto");
  useEffect(() => {
    const el = cardContentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCardHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

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
          "Unable to reach the ResilienceSoft Interview server. Ensure the app and database (docker compose up -d) are running.",
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
          description: "Welcome to ResilienceSoft Interview! Redirecting...",
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

  const isLogin = activeTab === "login";
  const features = [
    { icon: CalendarClock, title: "Scheduled AI interviews", text: "Set up a role once and invite candidates in minutes." },
    { icon: Mic, title: "Voice interview from any device", text: "Candidates join from a browser, no installs needed." },
    { icon: FileBarChart2, title: "Clear scored reports", text: "Skill scores, transcripts and a hiring summary." },
  ];

  return (
    <div className="h-dvh w-full overflow-hidden bg-background lg:grid lg:grid-cols-2">
      {/* ── Left: brand + interview illustration (desktop) ── */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#F1EEFE] via-[#ECE8FD] to-[#F7EEF6] dark:from-[#14112A] dark:via-[#120F22] dark:to-[#1A1020] lg:flex lg:flex-col">
        {/* soft blobs */}
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[#5941F2]/15 blur-3xl dark:bg-[#5941F2]/25" />
        <div aria-hidden className="pointer-events-none absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-[#D9328E]/10 blur-3xl dark:bg-[#D9328E]/20" />
        <div aria-hidden className="pointer-events-none absolute bottom-10 left-1/4 h-64 w-64 rounded-full bg-[#8734BF]/10 blur-3xl dark:bg-[#8734BF]/20" />
        <div
          aria-hidden
          className="pointer-events-none absolute right-12 top-12 h-24 w-32 opacity-40 dark:opacity-25"
          style={{ backgroundImage: "radial-gradient(#5941F2 1.5px, transparent 1.5px)", backgroundSize: "16px 16px" }}
        />

        <div className="relative z-10 flex flex-col px-12 pt-8 xl:px-16">
          <BrandWordmark height={40} priority />

          <h1 className="mt-8 font-heading text-3xl font-bold leading-tight tracking-tight text-foreground xl:text-4xl [@media(max-height:760px)]:mt-5">
            Your next interview,
            <br />
            made{" "}
            <span className="bg-gradient-to-r from-[#5941F2] via-[#8734BF] to-[#F23064] bg-clip-text text-transparent">
              simple
            </span>
          </h1>
          <p className="mt-2 text-base text-muted-foreground">Practice. Interview. Grow.</p>

          <ul className="mt-6 space-y-3 [@media(max-height:760px)]:mt-4 [@media(max-height:760px)]:space-y-2">
            {features.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#5941F2] shadow-sm ring-1 ring-[#5941F2]/10 dark:bg-white/10 dark:text-[#A99AF7] dark:ring-white/10">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="pt-0.5">
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="text-xs text-muted-foreground [@media(max-height:760px)]:hidden">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* brand-tinted curved floor behind the desk base */}
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 z-0 h-56 w-[85%] rounded-[50%] bg-gradient-to-tr from-[#5941F2]/20 via-[#8734BF]/12 to-transparent blur-2xl dark:from-[#5941F2]/30 dark:via-[#8734BF]/20" />
        <div className="relative z-10 mt-4 min-h-0 w-[94%] flex-1 [@media(max-height:760px)]:mt-3">
          <Image
            src="/images/auth/interview-pov.webp"
            alt="Candidate taking an AI video interview on a laptop"
            fill
            priority
            sizes="(min-width: 1024px) 48vw, 0px"
            className="select-none object-contain object-left-bottom"
          />
        </div>
      </aside>

      {/* ── Right: form ── */}
      <main className="relative flex h-dvh flex-col overflow-hidden px-6 py-5 sm:px-12 sm:py-8">
        {/* compact logo on mobile */}
        <div className="flex justify-center lg:hidden">
          <BrandWordmark height={32} priority />
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center py-4">
          <div className="w-full max-w-md rounded-2xl sm:border sm:border-border/60 sm:bg-card sm:p-8 sm:shadow-xl sm:shadow-primary/5 [@media(max-height:760px)]:sm:p-6">
            {/* Sign In / Create Account tabs with sliding indicator */}
            <div className="relative mb-7 flex rounded-xl border border-border bg-muted/60 p-1 [@media(max-height:760px)]:mb-4">
              <span
                aria-hidden
                className={`absolute inset-y-1 w-[calc(50%-4px)] rounded-lg bg-primary shadow-sm transition-all duration-300 ease-out ${isLogin ? "left-1" : "left-[calc(50%+0px)]"}`}
              />
              {(["login", "register"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => switchTab(tab)}
                  aria-pressed={activeTab === tab}
                  className={`relative z-10 flex-1 rounded-lg py-2 text-sm font-semibold transition-colors duration-200 ${
                    activeTab === tab ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "login" ? t("auth.signIn") || "Sign In" : t("auth.createAccount") || "Create Account"}
                </button>
              ))}
            </div>

            <motion.div
              initial={false}
              animate={{ height: cardHeight }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div ref={cardContentRef}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, x: isLogin ? -12 : 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: isLogin ? 12 : -12 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                  >
                    <div className="mb-7 flex flex-col items-center text-center [@media(max-height:760px)]:mb-4">
                      <span className="mb-3 flex h-11 w-11 items-center [@media(max-height:760px)]:hidden justify-center rounded-2xl bg-gradient-to-br from-[#5941F2] to-[#8734BF] text-white shadow-lg shadow-[#5941F2]/30">
                        {isLogin ? <LogIn className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                      </span>
                      <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">
                        {isLogin ? "Welcome back!" : t("auth.createAccount") || "Create your account"}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {isLogin
                          ? addMode
                            ? "Sign in to add another account to this browser"
                            : t("auth.signInSubtitle") || "Sign in to continue to your dashboard"
                          : "Create your recruiter or admin account in seconds"}
                      </p>
                    </div>

                    {sessionExpired && (
                      <div
                        role="alert"
                        className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive"
                      >
                        Your session{prefillEmail ? ` for ${prefillEmail}` : ""} has expired. Sign in again to continue.
                      </div>
                    )}

                    <form onSubmit={isLogin ? handleSignIn : handleSignUp} className="space-y-5 [@media(max-height:760px)]:space-y-3">
                      {!isLogin && (
                        <div className="space-y-2">
                          <Label htmlFor="auth-name" className="text-sm font-medium text-foreground">
                            Full name
                          </Label>
                          <div className="relative">
                            <User className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              id="auth-name"
                              type="text"
                              placeholder="Jane Doe"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              className="h-11 rounded-lg border-input bg-background pl-10 placeholder:text-muted-foreground/70 focus-visible:ring-primary"
                            />
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label htmlFor="auth-email" className="text-sm font-medium text-foreground">
                          {t("auth.email") || "Email address"}
                        </Label>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="auth-email"
                            type="email"
                            placeholder="Enter your email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="h-11 rounded-lg border-input bg-background pl-10 placeholder:text-muted-foreground/70 focus-visible:ring-primary"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="auth-password" className="text-sm font-medium text-foreground">
                          {t("auth.password") || "Password"}
                        </Label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="auth-password"
                            type={showPassword ? "text" : "password"}
                            placeholder="Enter your password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                            className="h-11 rounded-lg border-input bg-background pl-10 placeholder:text-muted-foreground/70 focus-visible:ring-primary pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3.5 top-3.5 text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        {isLogin && (
                          <div className="flex justify-end pt-1">
                            <span className="cursor-pointer text-sm font-medium text-primary hover:underline">
                              Forgot password?
                            </span>
                          </div>
                        )}
                      </div>

                      <Button
                        type="submit"
                        disabled={loading}
                        className="!mt-7 flex h-11 [@media(max-height:760px)]:!mt-5 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 transition-all hover:bg-primary/90"
                      >
                        {loading ? (
                          <span className="flex items-center gap-2">
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                            Please wait...
                          </span>
                        ) : (
                          <>
                            {isLogin ? t("auth.signIn") || "Sign in" : t("auth.createAccount") || "Create account"}
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </form>

                    {addMode && (
                      <button
                        type="button"
                        onClick={() => router.push(nextUrl)}
                        className="mt-4 w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Cancel and go back
                      </button>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>

            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground [@media(max-height:760px)]:mt-4">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Your data is safe with us
            </div>
            <p className="mt-1.5 text-center text-[11px] leading-relaxed text-muted-foreground/80">
              By continuing, you agree to ResilienceSoft Interview&apos;s Terms of Service and Privacy Policy.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
