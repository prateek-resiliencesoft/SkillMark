import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Bklit dashboard components exist and follow design specifications", () => {
  const statCard = fs.readFileSync("src/components/dashboard/bklit-stat-card.tsx", "utf8");
  assert.match(statCard, /BklitStatCard/);
  assert.match(statCard, /AreaSparkline/);
  assert.match(statCard, /createSparklinePath/);
  assert.match(statCard, /linearGradient/);

  const sparkline = fs.readFileSync("src/components/ui/charts/sparkline.tsx", "utf8");
  assert.match(sparkline, /export const LineSparkline/);
  assert.match(sparkline, /export const AreaSparkline/);
  assert.match(sparkline, /export const BarSparkline/);

  const areaChart = fs.readFileSync("src/components/dashboard/bklit-area-chart.tsx", "utf8");
  assert.match(areaChart, /BklitAreaChart/);
  assert.match(areaChart, /bklitAreaGradient/);

  const radialGauge = fs.readFileSync("src/components/dashboard/bklit-radial-gauge.tsx", "utf8");
  assert.match(radialGauge, /BklitRadialGauge/);
  assert.match(radialGauge, /Candidate Performance Index/);
  assert.match(radialGauge, /Completion Rate/);
  assert.match(radialGauge, /Gauge/);

  const gauge = fs.readFileSync("src/components/ui/charts/gauge.tsx", "utf8");
  assert.match(gauge, /export function Gauge/);
  assert.match(gauge, /orientation/);

  const funnel = fs.readFileSync("src/components/dashboard/bklit-funnel.tsx", "utf8");
  assert.match(funnel, /BklitFunnel/);
  assert.match(funnel, /Candidate Interview Funnel/);

  const pieChart = fs.readFileSync("src/components/ui/charts/pie-chart.tsx", "utf8");
  assert.match(pieChart, /export function PieChart/);

  const pieSlice = fs.readFileSync("src/components/ui/charts/pie-slice.tsx", "utf8");
  assert.match(pieSlice, /export const PieSlice/);

  const pieCenter = fs.readFileSync("src/components/ui/charts/pie-center.tsx", "utf8");
  assert.match(pieCenter, /export function PieCenter/);
});

test("Dashboard page uses bklit components and fast prefetching", () => {
  const dashContent = fs.readFileSync("src/app/(dashboard)/dashboard/page.tsx", "utf8");
  assert.match(dashContent, /BklitStatCard/);
  assert.match(dashContent, /BklitAreaChart/);
  assert.match(dashContent, /BklitRadialGauge/);
  assert.match(dashContent, /BklitFunnel/);
  assert.match(dashContent, /@bklitui\/ui\/charts/);
  assert.match(dashContent, /<PieChart/);
  assert.match(dashContent, /<PieSlice/);
  assert.match(dashContent, /<PieCenter/);
  assert.doesNotMatch(dashContent, /from "recharts"/);

  const sidebar = fs.readFileSync("src/components/layout/sidebar.tsx", "utf8");
  // SidebarLink must not intercept click with preventDefault or render Loader2
  assert.doesNotMatch(sidebar, /e\.preventDefault\(\);\s*startTransition/);
});
