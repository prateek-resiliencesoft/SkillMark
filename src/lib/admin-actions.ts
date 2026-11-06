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
  "user.pause": "Paused an account",
  "user.resume": "Resumed an account",
  "user.delete": "Deleted an account",
  "org.update": "Updated organization details",
  "org.set_flags": "Updated organization features",
  "config.instance": "Updated instance settings",
  "config.plan_limits": "Updated plan limits",
  "config.feature_flags": "Updated default features",
};

export function adminActionLabel(action: string): string {
  return LABELS[action] ?? action.replace(/\./g, " ");
}
