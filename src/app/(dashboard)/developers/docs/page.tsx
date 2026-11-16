"use client";

import { ApiReference } from "@/components/developers/api-reference";
import Link from "next/link";

export default function ApiDocsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/developers" className="text-xs text-muted-foreground hover:text-foreground">
          ← API
        </Link>
        <h1 className="mt-1 font-heading text-3xl font-bold tracking-tight text-foreground">API reference</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Every endpoint with examples. Paste a key to send real requests from this page.
        </p>
      </div>
      <ApiReference />
    </div>
  );
}
