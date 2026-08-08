#!/usr/bin/env node
/// Copies the prebuilt Stockfish "lite single-threaded" WASM engine files from
/// node_modules/stockfish/bin into public/engine/, so Vite serves them as static
/// assets that can be loaded by a Web Worker at runtime (see src/engine/stockfishWorker.ts).
///
/// Run manually after `npm install` if the engine files are missing:
///   npm run setup:engine

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "..", "node_modules", "stockfish", "bin");
const destDir = join(__dirname, "..", "public", "engine");

const files = ["stockfish-18-lite-single.js", "stockfish-18-lite-single.wasm"];

mkdirSync(destDir, { recursive: true });

for (const file of files) {
  const src = join(srcDir, file);
  const dest = join(destDir, file);
  if (!existsSync(src)) {
    console.error(
      `Missing ${src}. Run \`npm install\` first (the stockfish package ships these files prebuilt).`,
    );
    process.exit(1);
  }
  copyFileSync(src, dest);
  console.log(`Copied ${file} -> public/engine/${file}`);
}
