import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { listShops, resolveShop } from "../shops.ts";

function shopsRoot() {
  const root = mkdtempSync(join(tmpdir(), "shops-"));
  mkdirSync(join(root, "fish"));
  mkdirSync(join(root, "mobile"));
  writeFileSync(join(root, "README.md"), "");
  return root;
}

describe("resolveShop", () => {
  test("a shop folder resolves to its path", () => {
    const root = shopsRoot();
    expect(resolveShop("fish", root)).toBe(join(root, "fish"));
  });

  test("a mode that is not a shop stops the build and names the shops", () => {
    const root = shopsRoot();
    expect(() => resolveShop("production", root)).toThrow(/"production".*fish, mobile/);
  });

  test("a path is not accepted as a shop name, even when that folder exists", () => {
    const root = shopsRoot();
    mkdirSync(join(root, "fish", "nested"));
    expect(() => resolveShop("fish/nested", root)).toThrow(/not a shop/);
  });
});

describe("listShops", () => {
  test("lists only folders, sorted", () => {
    expect(listShops(shopsRoot())).toEqual(["fish", "mobile"]);
  });
});
