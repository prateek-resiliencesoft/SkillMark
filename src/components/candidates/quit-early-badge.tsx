import { Badge } from "@/components/ui/badge";
import { isQuitEarly, QUIT_EARLY_LABEL } from "@/lib/session-link";

/** Reviewer tag for a COMPLETED session the candidate quit on purpose. Renders nothing otherwise. */
export function QuitEarlyBadge({
  session,
  label = QUIT_EARLY_LABEL,
  className,
}: {
  session: { status?: string | null; endReason?: string | null } | null | undefined;
  label?: string;
  className?: string;
}) {
  if (!isQuitEarly(session)) return null;
  return (
    <Badge
      variant="outline"
      title="The candidate ended the interview before it finished"
      className={`whitespace-nowrap border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400 ${className ?? ""}`}
    >
      {label}
    </Badge>
  );
}
