"use client";

import { cn } from "@/lib/utils";
import { Code2, FileText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { name: "Forms", href: "/integrations/forms", icon: FileText, exact: true },
  { name: "Connect (API, embed, MCP)", href: "/integrations/forms/connect", icon: Code2 },
];

export default function InterviewFormIntegrationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const hideTabs = /^\/integrations\/forms\/[^/]+/.test(pathname) && !pathname.startsWith("/integrations/forms/connect");

  return (
    <div className="space-y-6">
      {!hideTabs && (
        <nav className="flex flex-wrap gap-1 border-b pb-px">
          {tabs.map((tab) => {
            const active = tab.exact
              ? pathname === tab.href
              : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.name}
              </Link>
            );
          })}
        </nav>
      )}
      {children}
    </div>
  );
}
