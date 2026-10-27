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

interface ShopConfig {
  version?: string;
  plugins?: { updater?: { endpoints?: string[] } };
}

/**
 * Why a shop's config can't be released now, given the repo's tags and the version the release was
 * started for (`asked`, shown in the run's title); empty when it can.
 */
export function releaseProblems(shop: string, config: ShopConfig, tags: string[], asked?: string): string[] {
  const file = `src-tauri/shops/${shop}/tauri.conf.json`;
  const channel = `releases/download/${shop}-updates/latest.json`;
  const problems: string[] = [];
  if (asked !== undefined && asked !== config.version) {
    problems.push(`the release is for ${asked} but ${file} is ${config.version}`);
  }
  if (!config.plugins?.updater?.endpoints?.some((url) => url.endsWith(`/${channel}`))) {
    problems.push(`${file} must update from ${channel}`);
  }
  if (tags.includes(`${shop}-v${config.version}`)) {
    problems.push(`${shop} ${config.version} is already released; raise version in ${file}`);
  }
  return problems;
}

const versionParts = (tag: string) =>
  tag
    .slice(tag.lastIndexOf("-v") + 2)
    .split(".")
    .map(Number);

/** The shop's newest release tag (`<shop>-v<version>`), or null before its first release. */
export function latestRelease(shop: string, tags: string[]): string | null {
  const own = tags.filter((t) => new RegExp(`^${shop}-v\\d+\\.\\d+\\.\\d+$`).test(t));
  own.sort((a, b) => {
    const [x, y] = [versionParts(a), versionParts(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  return own.at(-1) ?? null;
}

/** The changed files that go into `shop`'s app: not another shop's, and not docs, tests or workflows. */
export function relevantChanges(shop: string, shops: string[], files: string[]): string[] {
  const others = shops.filter((s) => s !== shop);
  const notInApp = (f: string) =>
    f.startsWith("docs/") || f.startsWith("tests/") || f.startsWith(".github/") || f.endsWith(".md");
  const otherShops = (f: string) =>
    others.some(
      (o) =>
        f.startsWith(`src/shops/${o}/`) ||
        f.startsWith(`src-tauri/src/shops/${o}/`) ||
        f.startsWith(`src-tauri/shops/${o}/`) ||
        f === `tsconfig.${o}.json`,
    );
  return files.filter((f) => !notInApp(f) && !otherShops(f));
}
