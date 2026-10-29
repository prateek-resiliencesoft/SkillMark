import Image from "next/image";
import { cn } from "@/lib/utils";

interface AuralLogoProps {
  size?: number;
  className?: string;
  priority?: boolean;
}

export function AuralLogo({ size = 32, className, priority }: AuralLogoProps) {
  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 overflow-hidden",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src="/images/skillmark-logo.png"
        alt="Skillmark logo"
        width={size}
        height={size}
        className="h-full w-full object-contain"
        priority={priority}
      />
    </div>
  );
}

export { AuralLogo as SkillmarkLogo };
