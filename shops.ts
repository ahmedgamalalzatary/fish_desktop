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
