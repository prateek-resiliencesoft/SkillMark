import { redirect } from "next/navigation";

/** Fallback if middleware does not run; middleware owns `/` auth routing. */
export default function RootPage() {
  redirect("/login");
}
