import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  latestRelease,
  listShops,
  relevantChanges,
  releaseProblems,
  resolveShop,
  taskCommands,
} from "../shops.ts";

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

describe("taskCommands", () => {
  const both = ["fish", "mobile"];

  test("typecheck runs the node project once, then each shop's project", () => {
    expect(taskCommands("typecheck", both)).toEqual([
      "tsc --noEmit -p tsconfig.node.json",
      "tsc --noEmit -p tsconfig.fish.json",
      "tsc --noEmit -p tsconfig.mobile.json",
    ]);
  });

  test("lint runs eslint once, then clippy per shop", () => {
    expect(taskCommands("lint", ["fish"])).toEqual([
      "eslint .",
      "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --features fish -- -D warnings",
    ]);
  });

  test("test runs vitest and cargo test for each shop in turn", () => {
    expect(taskCommands("test", both)).toEqual([
      "vitest run --mode fish",
      "cargo test --manifest-path src-tauri/Cargo.toml --features fish",
      "vitest run --mode mobile",
      "cargo test --manifest-path src-tauri/Cargo.toml --features mobile",
    ]);
  });

  test("check is typecheck, lint and test", () => {
    expect(taskCommands("check", both)).toEqual([
      ...taskCommands("typecheck", both),
      ...taskCommands("lint", both),
      ...taskCommands("test", both),
    ]);
  });

  test("dev, build and web run the one shop asked for", () => {
    expect(taskCommands("dev", ["fish"])).toEqual([
      "tauri dev --config src-tauri/shops/fish/tauri.conf.json --features fish",
    ]);
    expect(taskCommands("build", ["mobile"])).toEqual([
      "tauri build --config src-tauri/shops/mobile/tauri.conf.json --features mobile",
    ]);
    expect(taskCommands("web", ["fish"])).toEqual(["vite --mode fish"]);
  });

  test("dev, build and web refuse to guess between shops", () => {
    expect(() => taskCommands("dev", both)).toThrow(/one shop.*npm run dev fish/);
  });

  test("an unknown task names the tasks there are", () => {
    expect(() => taskCommands("deploy", both)).toThrow(
      /"deploy".*typecheck, lint, test, check, dev, build, web/,
    );
  });
});

describe("releaseProblems", () => {
  const endpoint = "https://github.com/o/r/releases/download/fish-updates/latest.json";
  const config = (endpoints?: string[]) => ({
    version: "0.3.0",
    plugins: endpoints ? { updater: { endpoints } } : undefined,
  });
  const problem =
    "src-tauri/shops/fish/tauri.conf.json must update from releases/download/fish-updates/latest.json";

  test("a shop updating from its own channel is fine", () => {
    expect(releaseProblems("fish", config([endpoint]), [])).toEqual([]);
  });

  test("a shop that would update from no channel, or another shop's, is a problem", () => {
    expect(releaseProblems("fish", config(), [])).toEqual([problem]);
    expect(releaseProblems("fish", config([endpoint.replace("fish-", "mobile-")]), [])).toEqual([problem]);
  });

  test("a version that was already released is a problem", () => {
    expect(releaseProblems("fish", config([endpoint]), ["fish-v0.2.0", "fish-v0.3.0"])).toEqual([
      "fish 0.3.0 is already released; raise version in src-tauri/shops/fish/tauri.conf.json",
    ]);
  });
});

describe("latestRelease", () => {
  test("is the shop's highest version, compared as numbers", () => {
    expect(latestRelease("fish", ["fish-v0.9.0", "mobile-v2.0.0", "fish-v0.10.0", "fish-v0.2.0"])).toBe(
      "fish-v0.10.0",
    );
  });

  test("is null before the shop's first release", () => {
    expect(latestRelease("bakery", ["fish-v0.3.0"])).toBeNull();
  });
});

describe("relevantChanges", () => {
  const shops = ["fish", "mobile"];

  test("shared code and the shop's own code count", () => {
    const files = ["src/lib/format.ts", "src-tauri/src/commands/sales.rs", "src/shops/fish/PosPage.tsx"];
    expect(relevantChanges("fish", shops, files)).toEqual(files);
    expect(
      relevantChanges("fish", shops, ["src-tauri/shops/fish/tauri.conf.json", "package.json"]),
    ).toHaveLength(2);
  });

  test("another shop's code does not count", () => {
    const files = [
      "src/shops/mobile/PosPage.tsx",
      "src-tauri/src/shops/mobile/sales.rs",
      "src-tauri/shops/mobile/tauri.conf.json",
      "tsconfig.mobile.json",
    ];
    expect(relevantChanges("fish", shops, files)).toEqual([]);
    expect(relevantChanges("mobile", shops, files)).toEqual(files);
  });

  test("docs, tests and workflows do not count, since they are not in the app", () => {
    expect(
      relevantChanges("fish", shops, [
        "docs/project-contract.md",
        "README.md",
        "tests/fish/format.test.ts",
        ".github/workflows/release.yml",
      ]),
    ).toEqual([]);
  });
});
