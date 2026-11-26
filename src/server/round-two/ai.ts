import "server-only";

export { callJson, type JsonCallResult } from "@/lib/ai/json-call";

export function clip(text: string | null | undefined, max: number): string {
  const t = (text ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
