// CSS variable references for theming
export const chartCssVars = {
  background: "var(--chart-background, hsl(var(--background)))",
  foreground: "var(--chart-foreground, hsl(var(--foreground)))",
  foregroundMuted: "var(--chart-foreground-muted, hsl(var(--muted-foreground)))",
  label: "var(--chart-label, hsl(var(--muted-foreground)))",
  linePrimary: "var(--chart-line-primary, var(--chart-1, #0ea5e9))",
  lineSecondary: "var(--chart-line-secondary, var(--chart-2, #a855f7))",
  crosshair: "var(--chart-crosshair, rgba(148, 163, 184, 0.4))",
  grid: "var(--chart-grid, rgba(148, 163, 184, 0.15))",
  indicatorColor: "var(--chart-indicator-color, var(--chart-1, #0ea5e9))",
  indicatorSecondaryColor: "var(--chart-indicator-secondary-color, var(--chart-2, #a855f7))",
  markerBackground: "var(--chart-marker-background, hsl(var(--card)))",
  markerBorder: "var(--chart-marker-border, hsl(var(--border)))",
  markerForeground: "var(--chart-marker-foreground, hsl(var(--foreground)))",
  badgeBackground: "var(--chart-marker-badge-background, hsl(var(--secondary)))",
  badgeForeground: "var(--chart-marker-badge-foreground, hsl(var(--secondary-foreground)))",
  segmentBackground: "var(--chart-segment-background, hsl(var(--muted)))",
  segmentLine: "var(--chart-segment-line, hsl(var(--border)))",
  brushBorder: "var(--chart-brush-border, hsl(var(--border)))",
  tooltipBackground: "var(--chart-tooltip-background, hsl(var(--popover)))",
};

/** Default scatter series colors from the chart palette (`--chart-1` … `--chart-5`). */
export const defaultScatterColors = [
  "var(--chart-1, #0ea5e9)",
  "var(--chart-2, #a855f7)",
  "var(--chart-3, #10b981)",
  "var(--chart-4, #f59e0b)",
  "var(--chart-5, #ec4899)",
] as const;
