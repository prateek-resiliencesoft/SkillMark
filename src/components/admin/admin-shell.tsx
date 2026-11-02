"use client";

/**
 * Control-center chrome with a left sidebar (mirrors the product shell).
 * Separate from org context so operators do not confuse scopes.
 */
import { AuralLogo } from "@/components/ui/aural-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import {
  Activity,
  Building2,
  LayoutDashboard,
  PanelLeft,
  ScrollText,
  Settings2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

const NAV: {
  href: string;
  label: string;
  exact?: boolean;
  icon: React.ElementType;
}[] = [
  { href: "/admin", label: "Overview", exact: true, icon: LayoutDashboard },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/people", label: "People", icon: Users },
  { href: "/admin/config", label: "Config", icon: Settings2 },
  { href: "/admin/activity", label: "Activity", icon: Activity },
  { href: "/admin/server-logs", label: "Server Logs", icon: ScrollText },
];

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

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.55] dark:opacity-40"
        style={{
          background:
            "radial-gradient(900px 420px at 12% -10%, hsl(var(--primary) / 0.12), transparent 60%), radial-gradient(700px 360px at 90% 0%, hsl(var(--primary) / 0.06), transparent 55%)",
        }}
      />

      <aside
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col border-r bg-background/90 backdrop-blur-md transition-all duration-200",
          collapsed ? "w-16" : "w-56",
        )}
      >
        <div className="flex h-14 items-center border-b px-3">
          <Link href="/admin" className="flex min-w-0 items-center gap-2.5">
            <AuralLogo size={26} className="shrink-0" priority />
            {!collapsed ? (
              <div className="flex min-w-0 flex-col leading-none">
                <span className="font-heading text-sm font-bold tracking-[2px]">
                  SKILLMARK
                </span>
                <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                  Control center
                </span>
              </div>
            ) : null}
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-3">
          {NAV.map((item) => {
            const active = navActive(pathname, item.href, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="admin-sidebar-active"
                    className="absolute inset-0 -z-10 rounded-lg bg-muted"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                ) : null}
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed ? <span>{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-2 border-t px-2 py-3">
          {!collapsed && operatorName ? (
            <p className="truncate px-2 text-xs text-muted-foreground">
              {operatorName}
            </p>
          ) : null}
          <Link
            href="/organizations"
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
            title={collapsed ? "Back to app" : undefined}
          >
            {!collapsed ? "Back to app" : "←"}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("w-full", collapsed ? "px-0" : "justify-start")}
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeft className="h-4 w-4" />
            {!collapsed ? <span className="ml-2">Collapse</span> : null}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top strip */}
        <div className="flex gap-1 overflow-x-auto border-b px-3 py-2 lg:hidden">
          {NAV.map((item) => {
            const active = navActive(pathname, item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
