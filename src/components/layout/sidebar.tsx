"use client";

import { useAppLocale } from "@/components/app-locale-provider";
import { useAuth } from "@/components/auth-provider";
import { OrgRequireGate } from "@/components/org-require-gate";
import { TourCelebration } from "@/components/tour/tour-celebration";
import { TourOverlay } from "@/components/tour/tour-overlay";
import { TourProvider } from "@/components/tour/tour-provider";
import { TourWelcome } from "@/components/tour/tour-welcome";
import { AuralLogo } from "@/components/ui/aural-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Hugeicon,
  createHugeicon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  PlayCircleIcon,
  Files01Icon,
  HelpCircleIcon,
  Folder01Icon,
  CustomerService01Icon,
  GaugeIcon,
  PlusSignIcon,
  Settings01Icon,
  Logout01Icon,
  Sun01Icon,
  Moon02Icon,
  ComputerIcon,
  PaintBoardIcon,
  SidebarLeftIcon,
  ArrowUp01Icon,
  ArrowUpRight01Icon,
  Loading03Icon,
} from "@/components/ui/hugeicon";
import { useTheme } from "next-themes";
import { FileText as LucideFileText, Plug as LucidePlug } from "lucide-react";
import { useThemeTransition } from "@/components/ui/theme-transition";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Header } from "./header";
import { SupportDrawer } from "./support-drawer";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { setThemeWithTransition } = useThemeTransition();
  const { t } = useAppLocale();

  const options = [
    { value: "light", icon: createHugeicon(Sun01Icon), label: t("common.light") },
    { value: "dark", icon: createHugeicon(Moon02Icon), label: t("common.dark") },
    { value: "system", icon: createHugeicon(ComputerIcon), label: t("common.system") },
  ] as const;

  return (
    <div className="flex items-center justify-between px-2 py-1.5 text-sm">
      <span className="flex items-center gap-2">
        <Hugeicon icon={PaintBoardIcon} className="h-4 w-4" />
        {t("sidebar.theme")}
      </span>
      <div className="flex items-center gap-1 rounded-md bg-muted/50 p-0.5">
        {options.map((opt) => {
          const isSelected = theme === opt.value;
          return (
            <button
              key={opt.value}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (opt.value === "system") {
                  setTheme("system");
                } else {
                  setThemeWithTransition(opt.value);
                }
              }}
              className={cn(
                "relative rounded-md p-1.5 transition-colors text-muted-foreground hover:text-foreground",
                isSelected && "text-foreground font-semibold",
              )}
            >
              {isSelected && (
                <motion.div
                  layoutId="sidebar-theme-active-indicator"
                  className="pointer-events-none absolute inset-0 rounded-md bg-background shadow-xs dark:bg-card"
                  transition={{ type: "spring", stiffness: 450, damping: 35 }}
                />
              )}
              <opt.icon className="relative z-10 h-4 w-4" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SidebarLink({
  href,
  icon: Icon,
  label,
  active,
  collapsed,
  suffix,
  onClick,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  collapsed: boolean;
  suffix?: React.ReactNode;
  onClick?: () => void;
}) {
  const router = useRouter();

  return (
    <Link
      href={href}
      prefetch={true}
      onClick={onClick}
      onMouseEnter={() => {
        try {
          router.prefetch(href);
        } catch {}
      }}
      onTouchStart={() => {
        try {
          router.prefetch(href);
        } catch {}
      }}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none",
        active
          ? "text-primary dark:text-white font-semibold"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
      )}
    >
      {active && (
        <motion.div
          layoutId="sidebar-active-indicator"
          className="pointer-events-none absolute inset-0 rounded-lg border-l-2 border-primary bg-primary/10 dark:bg-primary/20 dark:border-primary"
          transition={{
            type: "spring",
            stiffness: 450,
            damping: 35,
          }}
        />
      )}
      <Icon
        className={cn(
          "relative z-10 h-4 w-4 shrink-0 transition-colors",
          active ? "text-primary dark:text-white" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      {!collapsed &&
        (suffix ? (
          <>
            <span className="relative z-10 flex-1 truncate">{label}</span>
            <span className="relative z-10">{suffix}</span>
          </>
        ) : (
          <span className="relative z-10 truncate">{label}</span>
        ))}
    </Link>
  );
}

export function Sidebar({
  collapsed,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [creatingInterview, setCreatingInterview] = useState(false);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const { t } = useAppLocale();

  const projectNavigation = [
    { name: t("sidebar.dashboard"), href: "/dashboard", icon: createHugeicon(LayoutDashboardIcon) },
    { name: t("sidebar.interviews"), href: "/interviews", icon: createHugeicon(MessageSquareIcon) },
    { name: t("sidebar.batches"), href: "/batches", icon: createHugeicon(Files01Icon) },
    { name: t("sidebar.sessions"), href: "/candidates", icon: createHugeicon(PlayCircleIcon) },
    { name: t("sidebar.questions"), href: "/questions", icon: createHugeicon(HelpCircleIcon) },
  ];

  useEffect(() => {
    setCreatingInterview(false);
    setNavigatingTo(null);
  }, [pathname]);

  // Prime Next.js client-side route cache on mount for instant navigation
  useEffect(() => {
    const mainRoutes = [
      "/dashboard",
      "/interviews",
      "/batches",
      "/candidates",
      "/questions",
      "/settings",
      "/organizations",
      "/usage",
    ];
    mainRoutes.forEach((route) => {
      try {
        router.prefetch(route);
      } catch {}
    });
  }, [router]);

  const currentPath = navigatingTo ?? pathname;

  const isNavActive = (href: string) => {
    if (href === "/dashboard") return currentPath === "/dashboard";
    return currentPath.startsWith(href);
  };

  const displayName = profile?.name || user?.email?.split("@")[0] || "User";
  const initials =
    displayName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "U";

  const isOrgLevelPage =
    currentPath.startsWith("/organizations") ||
    currentPath.startsWith("/org/") ||
    currentPath.startsWith("/usage");

  const isSettingsActive = currentPath.startsWith("/settings");

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-background dark:bg-surface-sidebar transition-all duration-200",
        collapsed ? "w-16" : "w-52",
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/organizations" className="flex items-center gap-2">
          <AuralLogo size={28} className="shrink-0" priority />
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-heading text-sm font-bold tracking-[2px] leading-none">
                SKILLMARK
              </span>
              <span className="text-[10px] text-muted-foreground font-medium tracking-tight mt-0.5">
                Measure what matters
              </span>
            </div>
          )}
        </Link>
      </div>

      {isOrgLevelPage ? (
        <>
          {/* Org-level nav */}
          <nav className="flex-1 space-y-1 px-3 pt-3">
            <SidebarLink
              href="/organizations"
              icon={createHugeicon(Folder01Icon)}
              label={t("sidebar.organizations")}
              active={currentPath.startsWith("/organizations")}
              collapsed={collapsed}
              onClick={() => setNavigatingTo("/organizations")}
            />
          </nav>

          {/* Bottom section: Support */}
          <div className="space-y-1 px-3 pb-2">
            <button
              onClick={() => setSupportOpen(true)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Hugeicon icon={CustomerService01Icon} className="h-4 w-4 shrink-0" />
              {!collapsed && t("sidebar.support")}
            </button>
            <SidebarLink
              href="/usage"
              icon={createHugeicon(GaugeIcon)}
              label={t("sidebar.usage")}
              active={currentPath.startsWith("/usage")}
              collapsed={collapsed}
              onClick={() => setNavigatingTo("/usage")}
            />
          </div>
        </>
      ) : (
        <>
          {/* New Interview */}
          <div className="p-3">
            <Button
              className={cn(
                "w-full gap-2",
                collapsed ? "justify-center" : "justify-start",
              )}
              size={collapsed ? "icon" : "default"}
              disabled={creatingInterview}
              onClick={() => {
                if (pathname === "/interviews/new") return;
                setCreatingInterview(true);
                router.push("/interviews/new");
              }}
            >
              {creatingInterview ? (
                <Hugeicon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
              ) : (
                <Hugeicon icon={PlusSignIcon} className="h-4 w-4" />
              )}
              {!collapsed && t("sidebar.newInterview")}
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-3">
            {projectNavigation.map((item) => (
              <SidebarLink
                key={item.name}
                href={item.href}
                icon={item.icon}
                label={item.name}
                active={isNavActive(item.href)}
                collapsed={collapsed}
                onClick={() => setNavigatingTo(item.href)}
              />
            ))}
            <div className="pt-4">
              {!collapsed && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Integrations
                </p>
              )}
              {[
                { name: "Interview Form", href: "/integrations/forms", icon: LucideFileText },
                { name: "My Integrations", href: "/integrations", icon: LucidePlug },
              ].map((item) => (
                <SidebarLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.name}
                  active={
                    item.href === "/integrations"
                      ? currentPath === "/integrations"
                      : currentPath.startsWith(item.href)
                  }
                  collapsed={collapsed}
                  onClick={() => setNavigatingTo(item.href)}
                />
              ))}
            </div>
          </nav>

          {/* Bottom section: Settings + Support */}
          <div className="space-y-1 px-3 pb-2">
            <SidebarLink
              href="/settings"
              icon={createHugeicon(Settings01Icon)}
              label={t("sidebar.projectSettings")}
              active={isSettingsActive}
              collapsed={collapsed}
              onClick={() => setNavigatingTo("/settings")}
            />
            <button
              onClick={() => setSupportOpen(true)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Hugeicon icon={CustomerService01Icon} className="h-4 w-4 shrink-0" />
              {!collapsed && t("sidebar.support")}
            </button>
            <SidebarLink
              href="/usage"
              icon={createHugeicon(GaugeIcon)}
              label={t("sidebar.usage")}
              active={currentPath.startsWith("/usage")}
              collapsed={collapsed}
              onClick={() => setNavigatingTo("/usage")}
              suffix={
                <Hugeicon
                  icon={ArrowUpRight01Icon}
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    currentPath.startsWith("/usage")
                      ? "text-primary"
                      : "text-muted-foreground",
                  )}
                />
              }
            />
          </div>
        </>
      )}

      <SupportDrawer open={supportOpen} onOpenChange={setSupportOpen} />

      {/* User profile */}
      <div className="border-t">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted outline-none",
                collapsed && "justify-center px-0",
              )}
            >
              <Avatar className="h-8 w-8 shrink-0 rounded-md">
                <AvatarImage src={profile?.avatar ?? undefined} />
                <AvatarFallback className="text-xs rounded-md">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <>
                  <div className="flex flex-col items-start overflow-hidden text-left">
                    <span className="truncate w-full font-medium text-foreground">
                      {displayName}
                    </span>
                    <span className="truncate w-full text-xs text-muted-foreground">
                      {user?.email ?? ""}
                    </span>
                  </div>
                  <Hugeicon icon={ArrowUp01Icon} className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <Avatar className="h-7 w-7 shrink-0 rounded-md">
                <AvatarImage src={profile?.avatar ?? undefined} />
                <AvatarFallback className="text-[10px] rounded-md">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col overflow-hidden">
                <span className="truncate text-sm font-medium text-foreground">
                  {displayName}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {user?.email ?? ""}
                </span>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account" className="flex items-center gap-2">
                <Hugeicon icon={Settings01Icon} className="h-4 w-4" />
                {t("sidebar.accountSettings")}
              </Link>
            </DropdownMenuItem>
            <ThemeToggle />
            <DropdownMenuItem
              className="flex items-center gap-2 text-destructive"
              disabled={signingOut}
              onSelect={async (e) => {
                e.preventDefault();
                setSigningOut(true);
                const supabase = createClient();
                try {
                  await supabase.auth.signOut();
                } catch {
                  // Session may have expired; clear local state instead
                  await supabase.auth
                    .signOut({ scope: "local" })
                    .catch(() => {});
                }
                window.location.href = "/login";
              }}
            >
              {signingOut ? (
                <Hugeicon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
              ) : (
                <Hugeicon icon={Logout01Icon} className="h-4 w-4" />
              )}
              {signingOut ? t("sidebar.signingOut") : t("sidebar.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

export function SidebarToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useAppLocale();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-transparent"
      aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
    >
      <Hugeicon
        icon={SidebarLeftIcon}
        className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")}
      />
    </Button>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <TourProvider>
      <div className="dashboard-shell flex h-screen overflow-hidden bg-background">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Header
              sidebarToggle={
                <SidebarToggle
                  collapsed={collapsed}
                  onToggle={() => setCollapsed(!collapsed)}
                />
              }
            />
            <main className="flex-1 overflow-y-auto p-6 code-scrollbar bg-background">
              <OrgRequireGate>{children}</OrgRequireGate>
            </main>
          </div>
        </div>
      <TourOverlay />
      <TourWelcome />
      <TourCelebration />
    </TourProvider>
  );
}
