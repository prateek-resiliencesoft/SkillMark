"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Copy } from "lucide-react";

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const { toast } = useToast();
  return (
    <div className="overflow-hidden rounded-md border bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-400">
        <span>{label ?? ""}</span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white"
          onClick={async () => { await navigator.clipboard.writeText(code); toast({ title: "Copied" }); }}>
          <Copy className="mr-1 h-3 w-3" />Copy
        </Button>
      </div>
      <pre className="max-h-[420px] overflow-auto p-3 text-xs leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}
