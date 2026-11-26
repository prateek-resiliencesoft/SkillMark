"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CompletionNotifyMember } from "@/lib/completion-notify";
import { normalizeNotifyPhone } from "@/lib/completion-notify";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Loader2, Pencil } from "lucide-react";
import { useMemo, useState } from "react";

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
  /** userIds where admin is editing/overriding the profile phone for this alert. */
  const [editing, setEditing] = useState<Set<string>>(() => new Set());

  const rows = members.data ?? [];

  const profilePhone = (userId: string): string => {
    const p = rows.find((r) => r.userId === userId)?.profile?.phone;
    if (!p?.trim()) return "";
    return normalizeNotifyPhone(p) ?? p.trim();
  };

  const toggle = (userId: string, name: string | null | undefined) => {
    if (selected.has(userId)) {
      setEditing((prev) => {
        if (!prev.has(userId)) return prev;
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      onChange(value.filter((m) => m.userId !== userId));
      return;
    }
    const fromProfile = profilePhone(userId);
    onChange([
      ...value,
      { userId, name: name?.trim() || undefined, phone: fromProfile },
    ]);
    // No profile number → open edit so they can type one.
    if (!normalizeNotifyPhone(fromProfile)) {
      setEditing((prev) => new Set(prev).add(userId));
    }
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

  const startEdit = (userId: string) => {
    setEditing((prev) => new Set(prev).add(userId));
  };

  const useProfileNumber = (userId: string) => {
    const fromProfile = profilePhone(userId);
    setPhone(userId, fromProfile);
    setEditing((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="space-y-0.5">
          <Label className="text-sm font-semibold">Notify on completion</Label>
          <p className="text-xs text-muted-foreground">
            Pick org members who get a WhatsApp (ResilioHub) with a direct report link when a
            candidate finishes. Uses each member&apos;s signup phone; edit to send elsewhere.
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
            const stored = profilePhone(m.userId);
            const isEditing = !!on && (editing.has(m.userId) || !normalizeNotifyPhone(on.phone));
            const usingProfile =
              !!on &&
              !!normalizeNotifyPhone(stored) &&
              normalizeNotifyPhone(on.phone) === normalizeNotifyPhone(stored);
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
                  <div className="mt-2 space-y-1.5 pl-6">
                    {!isEditing && phoneOk ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-foreground">
                          {normalizeNotifyPhone(on.phone)}
                        </span>
                        {usingProfile && (
                          <span className="text-[11px] text-muted-foreground">profile</span>
                        )}
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => startEdit(m.userId)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                      </div>
                    ) : (
                      <>
                        <Input
                          className="h-8 font-mono text-xs"
                          placeholder="+91…"
                          value={on.phone}
                          disabled={disabled}
                          onChange={(e) => setPhone(m.userId, e.target.value)}
                          autoFocus={editing.has(m.userId)}
                        />
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {!phoneOk && (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400">
                              {stored
                                ? "WhatsApp needs country code (e.g. +91…)"
                                : "No signup phone — enter a number with country code"}
                            </p>
                          )}
                          {!!normalizeNotifyPhone(stored) && !usingProfile && (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => useProfileNumber(m.userId)}
                              className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                            >
                              Use profile number
                            </button>
                          )}
                          {phoneOk && editing.has(m.userId) && (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() =>
                                setEditing((prev) => {
                                  const next = new Set(prev);
                                  next.delete(m.userId);
                                  return next;
                                })
                              }
                              className="text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                            >
                              Done
                            </button>
                          )}
                        </div>
                      </>
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
