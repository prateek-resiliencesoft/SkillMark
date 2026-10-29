import { chromium } from "playwright";
import { mkdirSync, unlinkSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const docs = join(root, "public/images/docs");
const marketing = join(root, "public/images/marketing");
mkdirSync(docs, { recursive: true });
mkdirSync(marketing, { recursive: true });

const BASE = process.env.APP_URL || "http://127.0.0.1:3000";
const EMAIL = process.env.SHOT_EMAIL || "user@user.com";
const PASS = process.env.SHOT_PASS || "Skillmark123!";

function toWebp(pngPath, webpPath, width = 1600) {
  execFileSync("magick", [pngPath, "-resize", `${width}x>`, "-quality", "88", webpPath]);
  if (existsSync(pngPath)) unlinkSync(pngPath);
}

async function shot(page, route, outWebp, opts = {}) {
  const { wait = 2500, fullPage = false, width = 1600, ready } = opts;
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 90000 });
  if (ready) await ready(page);
  await page.waitForTimeout(wait);
  const png = outWebp.replace(/\.webp$/, ".tmp.png");
  await page.screenshot({ path: png, fullPage });
  toWebp(png, outWebp, width);
  console.log("ok", route, "->", outWebp.replace(root + "/", ""));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
});

const loginRes = await context.request.post(`${BASE}/api/auth/login`, {
  data: { email: EMAIL, password: PASS },
});
if (!loginRes.ok()) {
  console.error("login failed", loginRes.status(), await loginRes.text());
  process.exit(1);
}
console.log("logged in via API");

const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem(
    "aural_onboarding_tour",
    JSON.stringify({ currentStep: 0, completed: true, dismissed: true }),
  );
});

await shot(page, "/login", join(docs, "register.webp"), {
  wait: 2000,
  ready: async (p) => {
    await p.waitForSelector("text=Sign in", { timeout: 15000 }).catch(() => {});
  },
});

const sidebarReady = async (p) => {
  await p.waitForSelector("text=Integrations", { timeout: 20000 }).catch(() => {});
  // Dismiss tour if still visible
  const remind = p.getByText("Remind me next time");
  if (await remind.isVisible().catch(() => false)) await remind.click();
  await p.waitForTimeout(400);
};

const shots = [
  ["/dashboard", "dashboard.webp"],
  ["/interviews", "interviews-list.webp"],
  ["/interviews/new", "interview-new-ai.webp"],
  ["/interviews/new", "interview-new-manual.webp"],
  ["/integrations", "integrations.webp"],
  ["/integrations/forms", "interview-forms.webp"],
  ["/settings", "account-settings.webp"],
  ["/settings/ai", "ai-settings.webp"],
  ["/settings/api-keys", "api-keys.webp"],
  ["/usage", "usage.webp"],
  ["/questions", "question-library.webp"],
  ["/organizations", "org-members.webp"],
];

for (const [route, file] of shots) {
  try {
    await shot(page, route, join(docs, file), { ready: sidebarReady, wait: 2200 });
  } catch (e) {
    console.warn("fail", route, e.message);
  }
}

try {
  await page.goto(`${BASE}/interviews`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const link = page.locator('a[href*="/interviews/"]').filter({ hasNotText: "new" }).first();
  const href = await link.getAttribute("href");
  if (href && href.includes("/interviews/") && !href.endsWith("/new")) {
    const id = href.split("/interviews/")[1]?.split(/[/?#]/)[0];
    if (id) {
      await shot(page, `/interviews/${id}/edit`, join(docs, "interview-edit-content.webp"), { ready: sidebarReady });
      await shot(page, `/interviews/${id}/edit/settings`, join(docs, "interview-edit-settings.webp"), { ready: sidebarReady });
      await shot(page, `/interviews/${id}/edit/sessions`, join(docs, "interview-edit-sessions.webp"), {
        ready: sidebarReady,
      });
      await shot(page, `/interviews/${id}/edit/sessions`, join(docs, "sessions-add-dropdown.webp"), {
        ready: sidebarReady,
      });
    }
  }
} catch (e) {
  console.warn("interview edit shots skipped", e.message);
}

try {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await sidebarReady(page);
  await page.waitForTimeout(1500);
  const a = join(marketing, "_hero-a.png");
  await page.screenshot({ path: a });
  await page.goto(`${BASE}/integrations`, { waitUntil: "networkidle" });
  await sidebarReady(page);
  await page.waitForTimeout(1500);
  const b = join(marketing, "_hero-b.png");
  await page.screenshot({ path: b });
  await page.goto(`${BASE}/settings/ai`, { waitUntil: "networkidle" });
  await sidebarReady(page);
  await page.waitForTimeout(1500);
  const c = join(marketing, "_hero-c.png");
  await page.screenshot({ path: c });

  const heroPng = join(marketing, "_hero.png");
  execFileSync("magick", [a, b, c, "+append", "-resize", "1920x", heroPng]);
  toWebp(heroPng, join(marketing, "hero-screenshots.webp"), 1920);
  execFileSync("magick", [
    join(marketing, "hero-screenshots.webp"),
    "-resize",
    "820x",
    join(marketing, "hero-screenshots-sm.webp"),
  ]);
  for (const f of [a, b, c]) if (existsSync(f)) unlinkSync(f);
  console.log("ok hero");
} catch (e) {
  console.warn("hero fail", e.message);
}

await browser.close();
console.log("done");
