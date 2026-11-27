import { redirect } from "next/navigation";

/** Old URL — Studio now lives under AI Settings. */
export default function AiStudioRedirectPage() {
  redirect("/settings/ai/studio");
}
