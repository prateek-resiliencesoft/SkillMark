"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CompletionNotifyMember } from "@/lib/completion-notify";
import { normalizeNotifyPhone } from "@/lib/completion-notify";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";

export function CompletionNotifyPicker({
  organizationId,
  value,
  onChange,
  disabled,
  compact,
}: {
  organizationId: string;
  value: CompletionNotifyMember[];
  onChange: (next: CompletionNotifyMember[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const members = trpc.orgMember.list.useQuery(
    { organizationId },
    { enabled: !!organizationId, staleTime: 30_000 },
  );

  const selected = useMemo(() => new Map(value.map((m) => [m.userId, m])), [value]);

  const rows = members.data ?? [];

  const toggle = (userId: string, name: string | null | undefined) => {
    if (selected.has(userId)) {
      onChange(value.filter((m) => m.userId !== userId));
      return;
    }
    onChange([
      ...value,
      { userId, name: name?.trim() || undefined, phone: "" },
    ]);
  };

  const setPhone = (userId: string, phone: string) => {
    onChange(
      value.map((m) =>
        m.userId === userId
          ? { ...m, phone: phone.replace(/[^\d+]/g, "").slice(0, 20) }
          : m,
      ),
    );
  };

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="space-y-0.5">
          <Label className="text-sm font-semibold">Notify on completion</Label>
          <p className="text-xs text-muted-foreground">
            Pick org members who get a WhatsApp (ResilioHub) with a direct report link when a
            candidate finishes.
          </p>
        </div>
      )}

      {!organizationId && (
        <p className="text-xs text-destructive">Select an organization first.</p>
      )}

      {!!organizationId && members.isLoading && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading members…
        </p>
      )}

      {!!organizationId && members.isError && (
        <p className="text-xs text-destructive">Could not load members.</p>
      )}

      {!!organizationId && !members.isLoading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">No org members yet.</p>
      )}

      {rows.length > 0 && (
        <div
          className={cn(
            "space-y-1.5 rounded-xl border border-border/80 bg-card/60 p-3",
            compact ? "max-h-56 overflow-y-auto" : "max-h-72 overflow-y-auto",
          )}
        >
          {rows.map((m) => {
            const on = selected.get(m.userId);
            const phoneOk = on ? !!normalizeNotifyPhone(on.phone) : true;
            const label = m.profile?.name || m.profile?.email || m.userId.slice(0, 8);
            return (
              <div
                key={m.userId}
                className={cn(
                  "rounded-lg border px-2.5 py-2",
                  on ? "border-primary/40 bg-primary/5" : "border-transparent bg-muted/20",
                )}
              >
                <label className="flex cursor-pointer items-start gap-2">
                  <Checkbox
                    className="mt-0.5"
                    checked={!!on}
                    disabled={disabled}
                    onCheckedChange={() => toggle(m.userId, m.profile?.name ?? m.profile?.email)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    {m.profile?.email && m.profile?.name && (
                      <span className="block text-xs text-muted-foreground">{m.profile.email}</span>
                    )}
                  </span>
                </label>
                {on && (
                  <div className="mt-2 pl-6">
                    <Input
                      className="h-8 font-mono text-xs"
                      placeholder="+91…"
                      value={on.phone}
                      disabled={disabled}
                      onChange={(e) => setPhone(m.userId, e.target.value)}
                    />
                    {!phoneOk && (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                        WhatsApp needs country code (e.g. +91…)
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {value.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {value.filter((m) => normalizeNotifyPhone(m.phone)).length}/{value.length} ready
          (valid +phone)
        </p>
      )}
    </div>
  );
}

/** Drop entries without a usable WhatsApp phone before save. */
export function readyCompletionNotifyMembers(
  members: CompletionNotifyMember[],
): CompletionNotifyMember[] {
  const out: CompletionNotifyMember[] = [];
  for (const m of members) {
    const phone = normalizeNotifyPhone(m.phone);
    if (!phone) continue;
    const name = m.name?.trim();
    out.push({ userId: m.userId, phone, ...(name ? { name } : {}) });
  }
  return out;
}
