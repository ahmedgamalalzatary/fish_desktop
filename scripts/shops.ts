// Runs a task for every shop, or for one: `npm run check`, `npm run check fish`, `npm run dev mobile`.
//   node scripts/shops.ts list             the shops, as JSON (the CI matrix)
//   node scripts/shops.ts release <tag>    the shop a release tag builds; fails if its version is off
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { listShops, parseReleaseTag, resolveShop, taskCommands } from "../shops.ts";

const ROOT = join(import.meta.dirname, "..");
const [task, arg] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

try {
  if (task === "list") {
    console.log(JSON.stringify(listShops()));
  } else if (task === "release") {
    const { shop, version } = parseReleaseTag(arg ?? "");
    resolveShop(shop);
    const config = JSON.parse(
      readFileSync(join(ROOT, "src-tauri", "shops", shop, "tauri.conf.json"), "utf8"),
    );
    if (config.version !== version) {
      fail(
        `Tag ${arg} is version ${version}, but src-tauri/shops/${shop}/tauri.conf.json is ${config.version}`,
      );
    }
    console.log(`shop=${shop}\nversion=${version}\nname=${config.productName}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `shop=${shop}\nversion=${version}\nname=${config.productName}\n`,
      );
    }
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
