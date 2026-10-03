import fs from "node:fs";
import path from "node:path";

// Seeds live in ./seeds (repo) or SEEDS_DIR (inside the Agent37 sandbox bundle).
// The repo path is written out statically so Next only traces the seeds folder.
function seedPath(rel: string): string {
  return process.env.SEEDS_DIR ? path.join(process.env.SEEDS_DIR, rel) : path.join(process.cwd(), "seeds", rel);
}

const cache = new Map<string, unknown>();

export function readSeed<T>(rel: string): T {
  const file = seedPath(rel);
  if (!cache.has(file)) cache.set(file, JSON.parse(fs.readFileSync(file, "utf8")));
  return cache.get(file) as T;
}

export function seedExists(rel: string): boolean {
  return fs.existsSync(seedPath(rel));
}
