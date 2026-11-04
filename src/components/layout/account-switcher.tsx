"use client";

import { useAppLocale } from "@/components/app-locale-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Account = {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  active: boolean;
  expired: boolean;
};

function loginUrl(params: Record<string, string>) {
  return `/login?${new URLSearchParams({ add: "1", ...params }).toString()}`;
}

/** "Switch account" submenu for the sidebar user dropdown. */
export function AccountSwitcher() {
  const { t } = useAppLocale();
  const { toast } = useToast();
  const pathname = usePathname();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [max, setMax] = useState(3);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/accounts", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        setAccounts(json.accounts ?? []);
        if (json.max) setMax(json.max);
      })
      .catch(() => {});
  }, []);

  const others = accounts.filter((a) => !a.active);
  const canAdd = accounts.length < max;

  const switchTo = async (account: Account) => {
    setSwitchingTo(account.id);
    const res = await fetch("/api/auth/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: account.id }),
    }).catch(() => null);

    if (res?.ok) {
      window.location.href = "/dashboard";
      return;
    }
    const json = await res?.json().catch(() => ({}));
    if (json?.code === "SESSION_EXPIRED" || json?.code === "NOT_SIGNED_IN") {
      window.location.href = loginUrl({
        email: account.email,
        reason: "session_expired",
        next: "/dashboard",
      });
      return;
    }
    setSwitchingTo(null);
    toast({
      title: "Could not switch account",
      description: json?.error || "Check your connection and try again.",
      variant: "destructive",
    });
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="flex items-center gap-2">
        <Users className="h-4 w-4" />
        {t("sidebar.switchAccount")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        {others.map((a) => {
          const label = a.name || a.email.split("@")[0];
          return (
            <DropdownMenuItem
              key={a.id}
              disabled={!!switchingTo}
              onSelect={(e) => {
                e.preventDefault();
                switchTo(a);
              }}
              className="flex items-center gap-2.5"
            >
              <Avatar className="h-7 w-7 shrink-0 rounded-md">
                <AvatarImage src={a.avatar ?? undefined} />
                <AvatarFallback className="text-[10px] rounded-md">
                  {label.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{label}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {a.expired ? t("sidebar.sessionExpired") : a.email}
                </span>
              </div>
              {switchingTo === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </DropdownMenuItem>
          );
        })}
        {others.length > 0 && <DropdownMenuSeparator />}
        {canAdd ? (
          <DropdownMenuItem
            onSelect={() => {
              window.location.href = loginUrl({ next: pathname || "/dashboard" });
            }}
            className="flex items-center gap-2"
          >
            <UserPlus className="h-4 w-4" />
            {t("sidebar.addAccount")}
          </DropdownMenuItem>
        ) : (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
            {t("sidebar.accountLimit")}
          </p>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
