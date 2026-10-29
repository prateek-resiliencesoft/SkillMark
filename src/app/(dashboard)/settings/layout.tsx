"use client";

import { useAppLocale } from "@/components/app-locale-provider";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowUpRight, Building2, KeyRound, Plug, Settings, Users } from "lucide-react";
import { motion } from "motion/react";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale } = useAppLocale();
  const isZh = locale === "zh";
  const settingsNav: {
    name: string;
    href: string;
    icon: typeof Settings;
    exact?: boolean;
    external?: boolean;
  }[] = [
    {
      name: isZh ? "通用" : "General",
      href: "/settings",
      icon: Settings,
      exact: true,
    },
    {
      name: isZh ? "成员" : "Members",
      href: "/settings/members",
      icon: Users,
    },
    {
      name: isZh ? "API 密钥" : "API Keys",
      href: "/settings/api-keys",
      icon: KeyRound,
    },
    {
      name: isZh ? "集成" : "Integrations",
      href: "/settings/integrations",
      icon: Plug,
    },
    {
      name: isZh ? "组织" : "Organizations",
      href: "/organizations",
      icon: Building2,
      external: true,
    },
  ];

  useEffect(() => {
    const routes = ["/settings", "/settings/members", "/settings/api-keys", "/settings/integrations", "/organizations"];
    routes.forEach((route) => {
      try {
        router.prefetch(route);
      } catch {}
    });
  }, [router]);

  return (
    <div className="flex gap-8">
      <nav className="w-48 shrink-0 space-y-1">
        {settingsNav.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              onMouseEnter={() => {
                try {
                  router.prefetch(item.href);
                } catch {}
              }}
              className={cn(
                "group relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none",
                isActive
                  ? "text-primary dark:text-white font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              {!item.external && isActive && (
                <motion.div
                  layoutId="settings-nav-active-indicator"
                  className="pointer-events-none absolute inset-0 rounded-lg border-l-2 border-primary bg-primary/10 dark:bg-primary/20 dark:border-primary"
                  transition={{
                    type: "spring",
                    stiffness: 450,
                    damping: 35,
                  }}
                />
              )}
              <item.icon
                className={cn(
                  "relative z-10 h-4 w-4 shrink-0 transition-colors",
                  isActive ? "text-primary dark:text-white" : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              <span className="relative z-10 flex-1">{item.name}</span>
              {item.external && (
                <ArrowUpRight className="relative z-10 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
            </Link>
          );
        })}
      </nav>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
