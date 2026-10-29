"use client";

import React from "react";
import {
  HugeiconsIcon,
  type HugeiconsProps,
  type HugeiconsIconProps,
  type IconSvgElement,
} from "@hugeicons/react";
import { cn } from "@/lib/utils";

export interface HugeiconProps extends Omit<HugeiconsIconProps, "icon"> {
  icon: IconSvgElement;
  size?: number | string;
  strokeWidth?: number;
  className?: string;
}

export function Hugeicon({
  icon,
  size = 18,
  strokeWidth = 1.5,
  className,
  ...props
}: HugeiconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      className={cn("shrink-0 inline-block", className)}
      {...props}
    />
  );
}

/** Helper to wrap a Hugeicon icon definition into a React component matching React.ElementType */
export function createHugeicon(icon: IconSvgElement, defaultSize = 18) {
  return function WrappedHugeicon({
    size = defaultSize,
    strokeWidth = 1.5,
    className,
    ...props
  }: Omit<HugeiconProps, "icon">) {
    return (
      <HugeiconsIcon
        icon={icon}
        size={size}
        strokeWidth={strokeWidth}
        className={cn("shrink-0 inline-block", className)}
        {...props}
      />
    );
  };
}

export { HugeiconsIcon };
export type { HugeiconsProps, HugeiconsIconProps, IconSvgElement };
export * from "@hugeicons/core-free-icons";
