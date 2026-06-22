#!/usr/bin/env node
/**
 * Phase 1.27.10 — copy the built frontend into the backend's public/ folder
 * so a single Express process can serve both the API and the UI.
 *
 * Why a Node script and not just `cp -r` or `xcopy`? Because dev machines run
 * Windows / macOS / Linux and we don't want to maintain three command-line
 * variants in package.json.
 *
 * Run from the repo root via `npm run build` (which chains build:frontend
 * + build:copy together).
 */
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const src = resolve(repoRoot, "frontend", "dist");
const dst = resolve(repoRoot, "backend", "public");

if (!existsSync(src)) {
  console.error(
    `[build:copy] frontend/dist not found at ${src}. Run "npm run build:frontend" first (or just "npm run build", which chains both).`
  );
  process.exit(1);
}

// Wipe the destination so removed files don't linger as stale assets.
if (existsSync(dst)) {
  rmSync(dst, { recursive: true, force: true });
}

cpSync(src, dst, { recursive: true });

const stats = statSync(resolve(dst, "index.html"));
console.log(
  `[build:copy] copied frontend/dist → backend/public (${formatBytes(
    folderSize(dst)
  )}, index.html mtime ${stats.mtime.toISOString()})`
);
console.log(`[build:copy] now run "npm start" from the repo root to launch the single-server bundle.`);

function folderSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of readdir(cur)) {
      const full = resolve(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else total += statSync(full).size;
    }
  }
  return total;
}
function readdir(dir) {
  return readdirSync(dir, { withFileTypes: true });
}
function formatBytes(n) {
  const k = 1024;
  if (n < k) return `${n} B`;
  if (n < k * k) return `${(n / k).toFixed(1)} KB`;
  return `${(n / (k * k)).toFixed(2)} MB`;
}
