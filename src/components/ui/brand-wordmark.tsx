import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandWordmarkProps {
  /** Rendered height in px; width follows the 1830x570 aspect ratio. */
  height?: number;
  className?: string;
  priority?: boolean;
  /** "full" = R mark + text, "text" = text only. */
  variant?: "full" | "text";
}

/** Full ResilienceSoft Interview wordmark; swaps to the light variant in dark mode. */
export function BrandWordmark({ height = 32, className, priority, variant = "full" }: BrandWordmarkProps) {
  const [w, h, base] = variant === "text" ? [1279, 393, "logo-text"] : [1830, 570, "logo-full"];
  const width = Math.round((height * w) / h);
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ height, width }}>
      <Image src={`/images/brand/${base}.png`} alt="ResilienceSoft Interview" width={width} height={height} priority={priority} className="h-full w-full object-contain dark:hidden" />
      <Image src={`/images/brand/${base}-light.png`} alt="ResilienceSoft Interview" width={width} height={height} priority={priority} className="hidden h-full w-full object-contain dark:block" />
    </span>
  );
}
