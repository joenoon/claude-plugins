// One-command UI check: render a page in headless Chromium, optionally logged
// in, and screenshot it. Copied into a project's bin/browser/ by the
// liveview-browser-verify skill. See that skill's SKILL.md.
//
//   node bin/browser/shot.mjs <path> [--auth] [--mobile] [--name foo]
//
//   --auth     log in first via the dev-login backdoor (AUTH_PATH)
//   --mobile   390px viewport (else 1280px)
//   --name     screenshot basename (default: derived from path)
//
//   BASE        target origin (default http://127.0.0.1:8080)
//   AUTH_PATH   dev-login route prefix; the email is appended url-encoded
//               (default /dev/login?email=)
//   AUTH_EMAIL  who to log in as (required with --auth)
//   WAIT        ms to settle after load (default 1500)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS = join(import.meta.dirname, "shots");
mkdirSync(SHOTS, { recursive: true });

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--")) || "/";
const auth = args.includes("--auth");
const mobile = args.includes("--mobile");
const ni = args.indexOf("--name");
const name = ni >= 0 ? args[ni + 1] : path.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";

const BASE = process.env.BASE || "http://127.0.0.1:8080";
const AUTH_PATH = process.env.AUTH_PATH || "/dev/login?email=";
const EMAIL = process.env.AUTH_EMAIL || "";
const WAIT = Number(process.env.WAIT) || 1500;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
  });

  if (auth) {
    // Dev-only backdoor login — skips the email-code flow and its per-hour
    // rate limit. The redirect sets the session cookie. AUTH_PATH must point
    // at a route you compile-gate to dev (see SKILL.md "dev-login backdoor").
    await page.goto(`${BASE}${AUTH_PATH}${encodeURIComponent(EMAIL)}`, { waitUntil: "load" });
  }

  const resp = await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(WAIT);
  const lv = await page.evaluate(() => {
    try {
      // Swap this line for a non-LiveView app's hydration check — e.g. a React
      // root being mounted, or window.htmx being present.
      return !!(window.liveSocket && window.liveSocket.isConnected());
    } catch (_) {
      return false;
    }
  });
  const out = join(SHOTS, `${name}${mobile ? "-m" : ""}.png`);
  await page.screenshot({ path: out, fullPage: true });

  console.log(`url: ${page.url()}`);
  console.log(`status: ${resp ? resp.status() : "?"}`);
  console.log(`liveViewConnected: ${lv}`);
  console.log(`title: ${await page.title()}`);
  console.log(`text: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 200)}`);
  console.log(`shot: ${out}`);
} finally {
  await browser.close();
}
