// Which shop a build is for. Every shop is a folder under src/shops, picked with `vite --mode <shop>`.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const SHOPS_DIR = join(import.meta.dirname, "src", "shops");

export function listShops(root = SHOPS_DIR): string[] {
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort();
}

/** The folder of the shop named by `mode`. Throws for anything else, so a build never guesses a shop. */
export function resolveShop(mode: string, root = SHOPS_DIR): string {
  const dir = join(root, mode);
  if (!/^[a-z0-9-]+$/.test(mode) || !existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`"${mode}" is not a shop. Run with --mode <shop>, one of: ${listShops(root).join(", ")}`);
  }
  return dir;
}

const MANIFEST = "--manifest-path src-tauri/Cargo.toml";
const TAURI = (cmd: string, shop: string) =>
  `tauri ${cmd} --config src-tauri/shops/${shop}/tauri.conf.json --features ${shop}`;

/** Each task: commands run once for the whole repo, then commands run per shop. */
const TASKS: Record<string, { once?: string[]; perShop?: (shop: string) => string[]; oneShop?: boolean }> = {
  typecheck: {
    once: ["tsc --noEmit -p tsconfig.node.json"],
    perShop: (s) => [`tsc --noEmit -p tsconfig.${s}.json`],
  },
  lint: {
    once: ["eslint ."],
    perShop: (s) => [`cargo clippy ${MANIFEST} --all-targets --features ${s} -- -D warnings`],
  },
  test: { perShop: (s) => [`vitest run --mode ${s}`, `cargo test ${MANIFEST} --features ${s}`] },
  dev: { oneShop: true, perShop: (s) => [TAURI("dev", s)] },
  build: { oneShop: true, perShop: (s) => [TAURI("build", s)] },
  web: { oneShop: true, perShop: (s) => [`vite --mode ${s}`] },
};
const TASK_NAMES = ["typecheck", "lint", "test", "check", "dev", "build", "web"];

/** The shell commands `npm run <task> [shop]` runs, in order, for the given shops. */
export function taskCommands(task: string, shops: string[]): string[] {
  if (task === "check") return ["typecheck", "lint", "test"].flatMap((t) => taskCommands(t, shops));
  const t = TASKS[task];
  if (!t) throw new Error(`"${task}" is not a task. Tasks: ${TASK_NAMES.join(", ")}`);
  if (t.oneShop && shops.length !== 1) {
    throw new Error(`"${task}" runs one shop. Name it, e.g. npm run ${task} ${shops[0]}`);
  }
  return [...(t.once ?? []), ...shops.flatMap((s) => t.perShop?.(s) ?? [])];
}

/** A release tag is `<shop>-v<major>.<minor>.<patch>`, e.g. `fish-v0.3.0`. */
export function parseReleaseTag(tag: string): { shop: string; version: string } {
  const m = /^(?:refs\/tags\/)?([a-z0-9-]+?)-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!m) throw new Error(`"${tag}" is not a release tag. Use <shop>-v<version>, e.g. fish-v0.3.0`);
  return { shop: m[1], version: m[2] };
}
