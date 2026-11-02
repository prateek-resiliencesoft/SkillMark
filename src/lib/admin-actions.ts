/** Plain labels for platform audit actions shown in the control center. */

const LABELS: Record<string, string> = {
  "org.pause": "Paused an organization",
  "org.resume": "Resumed an organization",
  "org.set_plan": "Changed a plan",
  "org.set_limits": "Updated usage limits",
  "org.delete": "Removed an organization",
  "org.restore": "Restored an organization",
  "org.member.set_role": "Changed a member role",
  "org.member.remove": "Removed a member",
  "user.set_platform_role": "Changed platform access",
};

export function adminActionLabel(action: string): string {
  return LABELS[action] ?? action.replace(/\./g, " ");
}
