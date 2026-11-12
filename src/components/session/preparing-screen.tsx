import { Loader2 } from "lucide-react";
import { ProductLogo } from "@/components/ui/product-logo";

export function PreparingScreen() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-muted/30">
      <header className="sticky top-0 z-50 flex h-14 items-center border-b bg-card px-6">
        <div className="flex items-center gap-1">
          <ProductLogo size={28} className="shrink-0" />
          <span className="font-heading text-base font-bold tracking-[2px]">RESILIENCESOFT INTERVIEW AI</span>
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-lg font-medium">Preparing your interview...</p>
        <p className="text-sm text-muted-foreground">
          This will only take a moment.
        </p>
      </div>
    </div>
  );
}
