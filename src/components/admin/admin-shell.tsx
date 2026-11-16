"use client";

/**
 * Superadmin Modern Ops Center Chrome
 * - High-density collapsible navigation sidebar
 * - Subsurface 1px border lighting & backdrop radiance
 * - Integrated live system pulse indicator
 * - Dynamic breadcrumb context & responsive ergonomics
 */
import { ProductLogo } from "@/components/ui/product-logo";
import { BrandWordmark } from "@/components/ui/brand-wordmark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Gauge,
  Building2,
  ChevronDown,
  HardDrive,
  HeartPulse,
  LayoutDashboard,
  PanelLeft,
  ScrollText,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

type NavItem = {
  href: string;
  label: string;
  exact?: boolean;
  icon: React.ElementType;
  badge?: string;
};

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Platform",
    items: [
      { href: "/admin", label: "Overview", exact: true, icon: LayoutDashboard },
      { href: "/admin/organizations", label: "Organizations", icon: Building2 },
      { href: "/admin/people", label: "People", icon: Users },
      { href: "/admin/storage", label: "Stored Files", icon: HardDrive },
    ],
  },
  {
    title: "Configuration",
    items: [
      { href: "/admin/config", label: "Config", icon: Settings2 },
      { href: "/admin/activity", label: "Audit Activity", icon: Activity },
    ],
  },
  {
    title: "Telemetry & Server",
    items: [
      { href: "/admin/server-health", label: "Server Health", icon: Gauge },
      { href: "/admin/status", label: "Status Checks", icon: HeartPulse },
      { href: "/admin/server-logs", label: "Server Logs", icon: ScrollText },
      { href: "/admin/server-activity", label: "Server Activity", icon: BarChart3 },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function navActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function AdminShell({
  children,
  operatorName,
}: {
  children: ReactNode;
  operatorName?: string | null;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  // Groups the operator closed by hand; the group holding the current page always stays open.
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const currentItem = ALL_ITEMS.find((item) => navActive(pathname, item.href, item.exact));
  const currentGroup = NAV_GROUPS.find((g) =>
    g.items.some((i) => navActive(pathname, i.href, i.exact)),
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground antialiased selection:bg-primary selection:text-white">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "sticky top-0 z-30 flex h-screen shrink-0 flex-col border-r border-border/70 bg-card/70 backdrop-blur-md transition-all duration-200",
          "dark:border-white/[0.08] dark:bg-zinc-950/80",
          collapsed ? "w-16" : "w-56",
        )}
      >
        {/* Brand / Logo Header */}
        <div className="flex h-14 items-center justify-between border-b border-border/50 px-3.5 dark:border-white/[0.06]">
          <Link
            href="/admin"
            className="flex items-center gap-2.5 transition-transform hover:opacity-90 active:scale-95"
          >
            {collapsed ? (
              <ProductLogo size={28} className="shrink-0" priority />
            ) : (
              <div className="flex items-center gap-2">
                <BrandWordmark height={32} priority />
                <span className="rounded border border-primary/20 bg-primary/10 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                  Admin
                </span>
              </div>
            )}
          </Link>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3.5 custom-scrollbar">
          {NAV_GROUPS.map((group) => {
            const hasActive = group.items.some((i) => navActive(pathname, i.href, i.exact));
            const open = collapsed || hasActive || !closed[group.title];
            return (
              <div key={group.title} className="space-y-1">
                {!collapsed ? (
                  <button
                    type="button"
                    onClick={() => setClosed((c) => ({ ...c, [group.title]: open }))}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 hover:text-foreground"
                  >
                    <span>{group.title}</span>
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 text-muted-foreground/60 transition-transform duration-200",
                        !open && "-rotate-90",
                      )}
                    />
                  </button>
                ) : (
                  <div className="mx-2 mb-2 border-t border-border/40 dark:border-white/[0.06] first:hidden" />
                )}

                {open ? (
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = navActive(pathname, item.href, item.exact);
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          title={collapsed ? item.label : undefined}
                          className={cn(
                            "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-150",
                            collapsed && "justify-center px-0",
                            active
                              ? "font-semibold text-primary dark:text-white"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground dark:hover:bg-zinc-900/60",
                          )}
                        >
                          {active ? (
                            <motion.span
                              layoutId="admin-sidebar-active"
                              className="pointer-events-none absolute inset-0 rounded-lg border-l-2 border-primary bg-primary/10 dark:bg-primary/[0.15]"
                              transition={{ type: "spring", stiffness: 450, damping: 35 }}
                            />
                          ) : null}
                          <Icon
                            className={cn(
                              "relative z-10 h-4 w-4 shrink-0 transition-colors",
                              active
                                ? "text-primary dark:text-white"
                                : "text-muted-foreground group-hover:text-foreground",
                            )}
                          />
                          {!collapsed ? (
                            <span className="relative z-10 flex-1 truncate">{item.label}</span>
                          ) : null}
                          {!collapsed && item.badge ? (
                            <span className="relative z-10 rounded-full border border-border/50 bg-muted px-1.5 py-0.2 text-[10px] font-medium text-muted-foreground">
                              {item.badge}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        {/* Footer / Operator Info & Collapse */}
        <div className="space-y-2 border-t border-border/50 px-2.5 py-3 dark:border-white/[0.06]">
          {!collapsed && operatorName ? (
            <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 p-2 dark:border-white/[0.05] dark:bg-zinc-900/50">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                {operatorName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{operatorName}</p>
                <div className="flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-emerald-500" />
                  <span className="text-[10px] text-muted-foreground">Superadmin</span>
                </div>
              </div>
            </div>
          ) : null}

          <Link
            href="/organizations"
            className={cn(
              "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground dark:hover:bg-zinc-900",
              collapsed && "justify-center px-0",
            )}
            title={collapsed ? "Back to app" : undefined}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            {!collapsed ? <span>Return to App</span> : null}
          </Link>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "w-full text-xs text-muted-foreground hover:text-foreground dark:hover:bg-zinc-900",
              collapsed ? "px-0" : "justify-start px-2.5",
            )}
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeft className="h-3.5 w-3.5" />
            {!collapsed ? <span className="ml-2">Collapse Sidebar</span> : null}
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Operational Bar */}
        <header className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-border/70 bg-card/60 px-6 backdrop-blur-md dark:border-white/[0.08] dark:bg-zinc-950/70 sm:flex">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-muted-foreground">
              {currentGroup?.title ?? "Platform"}
            </span>
            <span className="text-muted-foreground/40">/</span>
            <span className="font-semibold text-foreground">
              {currentItem?.label ?? "Overview"}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* Live System Pulse Indicator */}
            <div className="flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground dark:border-white/[0.06] dark:bg-zinc-900/60">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span>Systems Online</span>
            </div>

            <Link
              href="/admin/status"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Health Check
            </Link>
          </div>
        </header>

        {/* Mobile Horizontal Navigation */}
        <div className="flex gap-1.5 overflow-x-auto border-b border-border/70 bg-card/80 p-2 backdrop-blur-md dark:border-white/[0.08] dark:bg-zinc-950/80 lg:hidden custom-scrollbar">
          {ALL_ITEMS.map((item) => {
            const active = navActive(pathname, item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary dark:text-white"
                    : "border-border/60 text-muted-foreground hover:bg-muted dark:border-white/[0.06]",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Viewport Content */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
