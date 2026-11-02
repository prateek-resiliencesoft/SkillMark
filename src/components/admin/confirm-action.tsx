"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";

type ConfirmActionProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Confirm button verb, e.g. "Pause organization". */
  confirmLabel: string;
  /** Optional typed confirmation — must match exactly. */
  confirmText?: string;
  confirmPlaceholder?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
};

/**
 * High-stakes admin confirm. Names the consequence; optional type-to-confirm
 * for irreversible removes (Supabase Studio / prfct.dev pattern).
 */
export function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmText,
  confirmPlaceholder,
  destructive = false,
  pending = false,
  onConfirm,
}: ConfirmActionProps) {
  const [typed, setTyped] = useState("");
  const needsMatch = Boolean(confirmText);
  const matched = !needsMatch || typed === confirmText;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {needsMatch ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Type <span className="font-medium text-foreground">{confirmText}</span>{" "}
              to confirm.
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmPlaceholder ?? confirmText}
              autoComplete="off"
              aria-label="Confirmation text"
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!matched || pending}
            className={cn(
              destructive &&
                buttonVariants({ variant: "destructive" }),
            )}
            onClick={(e) => {
              e.preventDefault();
              if (!matched || pending) return;
              onConfirm();
            }}
          >
            {pending ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
