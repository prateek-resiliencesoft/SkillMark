"use client";

import { cn } from "@/lib/utils";
import { Activity, KeyRound, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  {
    href: "/settings/ai",
    label: "Providers",
    hint: "API keys & failover order",
    icon: KeyRound,
    exact: true,
  },
  {
    href: "/settings/ai/studio",
    label: "Studio",
    hint: "Models, costs & playground",
    icon: SlidersHorizontal,
    exact: false,
  },
  {
    href: "/settings/ai/usage",
    label: "Usage",
    hint: "Tokens, cost & which AI",
    icon: Activity,
    exact: false,
  },
] as const;

export default function AiSettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          One place for keys and which model each part of SkillMark uses.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-border pb-px">
        {TABS.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "group relative -mb-px flex items-center gap-2 rounded-t-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <tab.icon className="h-4 w-4 shrink-0" />
              <span>{tab.label}</span>
              <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
                · {tab.hint}
              </span>
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
