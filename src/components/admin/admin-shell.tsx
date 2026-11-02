"use client";

/**
 * Slim control-center chrome. Separate from the product sidebar so platform
 * operators never confuse org context with instance-wide tools.
 */
import { AuralLogo } from "@/components/ui/aural-logo";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV: { href: string; label: string; exact?: boolean }[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/organizations", label: "Organizations" },
  { href: "/admin/people", label: "People" },
  { href: "/admin/activity", label: "Activity" },
  { href: "/admin/server-logs", label: "Server Logs" },
];

export function AdminShell({
  children,
  operatorName,
}: {
  children: ReactNode;
  operatorName?: string | null;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.55] dark:opacity-40"
        style={{
          background:
            "radial-gradient(900px 420px at 12% -10%, hsl(var(--primary) / 0.12), transparent 60%), radial-gradient(700px 360px at 90% 0%, hsl(var(--primary) / 0.06), transparent 55%)",
        }}
      />

      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/admin" className="flex items-center gap-2.5">
            <AuralLogo size={26} className="shrink-0" priority />
            <div className="flex flex-col leading-none">
              <span className="font-heading text-sm font-bold tracking-[2px]">
                SKILLMARK
              </span>
              <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                Control center
              </span>
            </div>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href ||
                  pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="admin-nav-active"
                      className="absolute inset-0 -z-10 rounded-md bg-muted"
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 32,
                      }}
                    />
                  )}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {operatorName ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {operatorName}
              </span>
            ) : null}
            <Link
              href="/organizations"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Back to app
            </Link>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="flex gap-1 overflow-x-auto border-t px-3 py-2 md:hidden">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/");
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
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
