// Rasterize the code-owned SVG mark for installed PWAs and Apple Home Screen icons.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const svg = await readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:#245c48}svg{display:block;width:100%;height:100%}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url)) });
    await page.close();
  }
} finally { await browser.close(); }
