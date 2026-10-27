// Runs a task for every shop, or for one: `npm run check`, `npm run check fish`, `npm run dev mobile`.
//   node scripts/shops.ts list              the shops, as JSON
//   node scripts/shops.ts release <shop>    whether to release the shop now (see release.yml)
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  latestRelease,
  listShops,
  relevantChanges,
  releaseProblems,
  resolveShop,
  taskCommands,
} from "../shops.ts";

const ROOT = join(import.meta.dirname, "..");
const [task, arg] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const git = (...args: string[]) =>
  spawnSync("git", args, { cwd: ROOT, encoding: "utf8" })
    .stdout.split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Tells GitHub what to do: build=true with the version, or build=false when nothing changed. */
function output(values: Record<string, string>, summary: string) {
  const lines = Object.entries(values)
    .map(([k, v]) => `${k}=${v}\n`)
    .join("");
  console.log(lines + summary);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}

/** Releases the shop only when its app changed since its last release, at a version not yet released. */
function release(shop: string) {
  resolveShop(shop);
  const config = JSON.parse(readFileSync(join(ROOT, "src-tauri", "shops", shop, "tauri.conf.json"), "utf8"));
  const tags = git("tag", "--list", `${shop}-v*`);
  const last = latestRelease(shop, tags);
  if (last) {
    const changed = relevantChanges(shop, listShops(), git("diff", "--name-only", last, "HEAD"));
    if (changed.length === 0) {
      return output(
        { build: "false" },
        `Nothing in ${config.productName} changed since ${last}; not rebuilt.`,
      );
    }
  }
  const problems = releaseProblems(shop, config, tags);
  if (problems.length) fail(`Can't release ${shop}:\n- ${problems.join("\n- ")}`);
  output(
    {
      build: "true",
      shop,
      version: config.version,
      tag: `${shop}-v${config.version}`,
      name: config.productName,
    },
    `Releasing ${config.productName} ${config.version}${last ? ` (last release ${last})` : ""}.`,
  );
}

try {
  if (task === "list") {
    console.log(JSON.stringify(listShops()));
  } else if (task === "release") {
    release(arg ?? "");
  } else {
    const shops = arg ? [arg] : listShops();
    if (arg) resolveShop(arg);
    for (const command of taskCommands(task ?? "", shops)) {
      console.log(`\n> ${command}`);
      const { status } = spawnSync(command, { cwd: ROOT, shell: true, stdio: "inherit" });
      if (status !== 0) process.exit(status ?? 1);
    }
  }
} catch (e) {
  fail((e as Error).message);
}
