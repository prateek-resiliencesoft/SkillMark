"use client";

import { cn } from "@/lib/utils";
import React, { useEffect, useRef } from "react";

export interface CursorDrivenParticleTypographyProps {
  /** Additional CSS classes */
  className?: string;
  /** Primary title text (e.g. "SKILLMARK") */
  text: string;
  /** Optional secondary subtitle text (e.g. "Measure what matters") */
  subtitle?: string;
  /** Font size in pixels for the main text */
  fontSize?: number;
  /** Font size in pixels for subtitle text */
  subtitleFontSize?: number;
  /** Font family (defaults to system UI font stack) */
  fontFamily?: string;
  /** Size of each particle radius */
  particleSize?: number;
  /** Density step in CSS pixels (lower number = more particles, e.g. 2 is crisp & dense) */
  particleDensity?: number;
  /** How strongly the cursor pushes particles away */
  dispersionStrength?: number;
  /** Speed at which particles return to origin */
  returnSpeed?: number;
  /** Custom color for primary particles. Defaults to theme foreground. */
  color?: string;
  /** Custom color for subtitle particles. Defaults to brand #5941F2. */
  subtitleColor?: string;
  /** Interaction radius in pixels */
  interactionRadius?: number;
  /** When true, particles start scattered from outside and magnetically assemble into text */
  gatherOnMount?: boolean;
  /** Numeric trigger that forces particles to scatter and re-gather when changed */
  triggerGather?: number;
  /** Callback fired after particles finish converging into place */
  onGatherComplete?: () => void;
}

class Particle {
  x: number;
  y: number;
  originX: number;
  originY: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  dispersion: number;
  returnSpd: number;
  interactionRadius: number;

  constructor(
    x: number,
    y: number,
    size: number,
    color: string,
    dispersion: number,
    returnSpd: number,
    interactionRadius: number = 80,
    scatter: boolean = false,
  ) {
    if (scatter) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 180 + Math.random() * 320;
      this.x = x + Math.cos(angle) * dist;
      this.y = y + Math.sin(angle) * dist;
      this.vx = (Math.random() - 0.5) * 6;
      this.vy = (Math.random() - 0.5) * 6;
    } else {
      this.x = x + (Math.random() - 0.5) * 6;
      this.y = y + (Math.random() - 0.5) * 6;
      this.vx = (Math.random() - 0.5) * 2;
      this.vy = (Math.random() - 0.5) * 2;
    }
    this.originX = x;
    this.originY = y;
    this.size = size;
    this.color = color;
    this.dispersion = dispersion;
    this.returnSpd = returnSpd;
    this.interactionRadius = interactionRadius;
  }

  scatter() {
    const angle = Math.random() * Math.PI * 2;
    const dist = 180 + Math.random() * 320;
    this.x = this.originX + Math.cos(angle) * dist;
    this.y = this.originY + Math.sin(angle) * dist;
    this.vx = (Math.random() - 0.5) * 6;
    this.vy = (Math.random() - 0.5) * 6;
  }

  update(mouseX: number, mouseY: number) {
    const dx = mouseX - this.x;
    const dy = mouseY - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (
      distance < this.interactionRadius &&
      mouseX !== -1000 &&
      mouseY !== -1000
    ) {
      const forceDirectionX = dx / (distance || 1);
      const forceDirectionY = dy / (distance || 1);
      const force = (this.interactionRadius - distance) / this.interactionRadius;

      const repulsionX = forceDirectionX * force * this.dispersion;
      const repulsionY = forceDirectionY * force * this.dispersion;

      this.vx -= repulsionX;
      this.vy -= repulsionY;
    }

    // Return to origin (spring physics)
    this.vx += (this.originX - this.x) * this.returnSpd;
    this.vy += (this.originY - this.y) * this.returnSpd;

    // Friction
    this.vx *= 0.84;
    this.vy *= 0.84;

    // Micro-jitter near rest for dynamic shimmer
    const distToOrigin = Math.sqrt(
      Math.pow(this.x - this.originX, 2) + Math.pow(this.y - this.originY, 2),
    );
    if (distToOrigin < 0.8 && Math.random() > 0.94) {
      this.vx += (Math.random() - 0.5) * 0.15;
      this.vy += (Math.random() - 0.5) * 0.15;
    }

    this.x += this.vx;
    this.y += this.vy;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function CursorDrivenParticleTypography({
  className,
  text,
  subtitle,
  fontSize = 54,
  subtitleFontSize = 14,
  fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  particleSize = 0.7,
  particleDensity = 1.1,
  dispersionStrength = 13,
  returnSpeed = 0.08,
  color,
  subtitleColor = "#5941F2",
  interactionRadius = 75,
  gatherOnMount = false,
  triggerGather,
  onGatherComplete,
}: CursorDrivenParticleTypographyProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const onGatherCompleteRef = useRef(onGatherComplete);
  onGatherCompleteRef.current = onGatherComplete;

  // Handle triggerGather updates
  useEffect(() => {
    if (triggerGather === undefined || triggerGather <= 0) return;
    if (particlesRef.current.length > 0) {
      for (const p of particlesRef.current) {
        p.scatter();
      }
      const timer = setTimeout(() => {
        onGatherCompleteRef.current?.();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [triggerGather]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let animationFrameId: number;

    let mouseX = -1000;
    let mouseY = -1000;

    let containerWidth = 0;
    let containerHeight = 0;

    const init = () => {
      const container = containerRef.current;
      if (!container) return;

      containerWidth = container.clientWidth || 360;
      containerHeight = container.clientHeight || 120;

      const dpr = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);
      canvas.width = Math.round(containerWidth * dpr);
      canvas.height = Math.round(containerHeight * dpr);
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${containerHeight}px`;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      // Determine text color based on active theme
      const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
      const titleColor = color || (isDark ? "#FFFFFF" : "#0F172A");
      const subColor = subtitleColor || "#5941F2";

      ctx.clearRect(0, 0, containerWidth, containerHeight);

      // Responsive font sizes to always fit container width
      const effectiveTitleSize = Math.min(
        fontSize,
        Math.max(34, containerWidth * 0.12),
      );
      const effectiveSubSize = Math.min(
        subtitleFontSize,
        Math.max(12, containerWidth * 0.038),
      );

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const hasSubtitle = Boolean(subtitle && subtitle.trim().length > 0);
      const titleY = hasSubtitle
        ? Math.round(containerHeight * 0.36)
        : Math.round(containerHeight * 0.5);
      const subY = Math.round(titleY + effectiveTitleSize * 0.5 + effectiveSubSize * 0.9 + 10);

      // 1. Draw Title
      ctx.fillStyle = titleColor;
      ctx.font = `800 ${effectiveTitleSize}px ${fontFamily}`;
      if ("letterSpacing" in ctx) {
        ctx.letterSpacing = "4px";
      }
      ctx.fillText(text, containerWidth / 2, titleY);

      // 2. Draw Subtitle if present
      if (hasSubtitle && subtitle) {
        ctx.fillStyle = subColor;
        ctx.font = `700 ${effectiveSubSize}px ${fontFamily}`;
        if ("letterSpacing" in ctx) {
          ctx.letterSpacing = "3px";
        }
        ctx.fillText(subtitle.toUpperCase(), containerWidth / 2, subY);
      }

      // 3. Scan pixels and create particles
      const textCoordinates = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const newParticles: Particle[] = [];

      // Step in device pixels based on density
      const step = Math.max(1, Math.round(particleDensity * dpr));

      for (let y = 0; y < textCoordinates.height; y += step) {
        for (let x = 0; x < textCoordinates.width; x += step) {
          const index = (y * textCoordinates.width + x) * 4;
          const alpha = textCoordinates.data[index + 3] || 0;

          if (alpha > 55) {
            const r = textCoordinates.data[index];
            const g = textCoordinates.data[index + 1];
            const b = textCoordinates.data[index + 2];
            const pColor = `rgba(${r}, ${g}, ${b}, ${(alpha / 255).toFixed(2)})`;

            newParticles.push(
              new Particle(
                x / dpr,
                y / dpr,
                particleSize,
                pColor,
                dispersionStrength,
                returnSpeed,
                interactionRadius,
                gatherOnMount,
              ),
            );
          }
        }
      }

      particlesRef.current = newParticles;

      if (gatherOnMount) {
        setTimeout(() => {
          onGatherCompleteRef.current?.();
        }, 1100);
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, containerWidth, containerHeight);

      const particles = particlesRef.current;
      const len = particles.length;
      for (let i = 0; i < len; i++) {
        const p = particles[i];
        p.update(mouseX, mouseY);
        p.draw(ctx);
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
    };

    const handleMouseLeave = () => {
      mouseX = -1000;
      mouseY = -1000;
    };

    const handleResize = () => {
      init();
    };

    let isCancelled = false;
    const start = () => {
      if (isCancelled) return;
      init();
      animate();
    };

    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(start);
    } else {
      setTimeout(start, 50);
    }

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    const themeObserver = new MutationObserver(() => {
      init();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    const handleTouchStart = (e: TouchEvent) => {
      if (!e.touches[0]) return;
      const rect = canvas.getBoundingClientRect();
      mouseX = e.touches[0].clientX - rect.left;
      mouseY = e.touches[0].clientY - rect.top;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!e.touches[0]) return;
      const rect = canvas.getBoundingClientRect();
      mouseX = e.touches[0].clientX - rect.left;
      mouseY = e.touches[0].clientY - rect.top;
    };

    canvas.addEventListener("touchstart", handleTouchStart, { passive: true });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: true });
    canvas.addEventListener("touchend", handleMouseLeave, { passive: true });

    return () => {
      isCancelled = true;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, [
    text,
    subtitle,
    fontSize,
    subtitleFontSize,
    fontFamily,
    particleSize,
    particleDensity,
    dispersionStrength,
    returnSpeed,
    color,
    subtitleColor,
    interactionRadius,
    gatherOnMount,
  ]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex w-full items-center justify-center select-none touch-none",
        className,
      )}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
      <div className="sr-only">
        <h1>{text}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}
