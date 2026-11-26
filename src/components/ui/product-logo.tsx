import Image from "next/image";
import { cn } from "@/lib/utils";

interface ProductLogoProps {
  size?: number;
  className?: string;
  priority?: boolean;
}

export function ProductLogo({ size = 32, className, priority }: ProductLogoProps) {
  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 overflow-hidden",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src="/images/brand/logo-mark.png"
        alt="ResilienceSoft Interview logo"
        width={size}
        height={size}
        className="h-full w-full object-contain"
        priority={priority}
      />
    </div>
  );
}

