#!/usr/bin/env node
// Door sticker QR generator. Encodes <baseUrl>/d/<building-slug>, the visitor page.
//
//   node index.mjs <building-slug> <baseUrl> [--out <file-without-extension>]
//   node index.mjs demo-building http://192.168.1.10:5173
//   node index.mjs demo-building https://interphone.example --out stickers/front-door
//
// Writes <out>.png (print) and <out>.svg (scalable). Default out = ./<slug>.

import { writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import QRCode from "qrcode";

const SLUG_RE = /^[a-z0-9-]{3,40}$/; // same rule as buildings.slug in the schema

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error("usage: node index.mjs <building-slug> <baseUrl> [--out <file-without-extension>]");
  console.error("  e.g. node index.mjs demo-building http://192.168.1.10:5173");
  process.exit(1);
}

const args = process.argv.slice(2);
let out;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") out = args[++i];
  else if (args[i].startsWith("-")) usage(`unknown flag ${args[i]}`);
  else positional.push(args[i]);
}
const [slug, baseUrl] = positional;
if (!slug || !baseUrl) usage("slug and baseUrl are required");
if (!SLUG_RE.test(slug)) usage(`slug must match ${SLUG_RE} (lowercase letters, digits, dashes)`);
let base;
try {
  base = new URL(baseUrl);
} catch {
  usage(`baseUrl is not a valid URL: ${baseUrl}`);
}
if (!/^https?:$/.test(base.protocol)) usage("baseUrl must start with http:// or https://");

const url = `${base.origin}${base.pathname.replace(/\/$/, "")}/d/${slug}`;
const target = resolve(out ?? slug);
await mkdir(dirname(target), { recursive: true });

const opts = { errorCorrectionLevel: "M", margin: 2 };
await QRCode.toFile(`${target}.png`, url, { ...opts, width: 1024 });
await writeFile(`${target}.svg`, await QRCode.toString(url, { ...opts, type: "svg" }));

console.log(`QR encodes: ${url}`);
console.log(`wrote ${target}.png`);
console.log(`wrote ${target}.svg`);
