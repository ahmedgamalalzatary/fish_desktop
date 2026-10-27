import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { listShops, parseReleaseTag, releaseProblems, resolveShop, taskCommands } from "../shops.ts";

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

describe("parseReleaseTag", () => {
  test("a release tag is the shop, a v and its version", () => {
    expect(parseReleaseTag("fish-v0.3.0")).toEqual({ shop: "fish", version: "0.3.0" });
    expect(parseReleaseTag("refs/tags/mobile-v0.5.12")).toEqual({ shop: "mobile", version: "0.5.12" });
  });

  test("anything else is refused", () => {
    expect(() => parseReleaseTag("v0.3.0")).toThrow(/release tag/);
    expect(() => parseReleaseTag("fish-0.3.0")).toThrow(/release tag/);
    expect(() => parseReleaseTag("fish-v0.3")).toThrow(/release tag/);
  });
});

describe("releaseProblems", () => {
  const endpoint = "https://github.com/o/r/releases/download/fish-updates/latest.json";
  const config = (version: string, endpoints?: string[]) => ({
    version,
    plugins: endpoints ? { updater: { endpoints } } : undefined,
  });

  test("a shop config at the tag's version, updating from its own channel, is fine", () => {
    expect(releaseProblems("fish", "0.3.0", config("0.3.0", [endpoint]))).toEqual([]);
  });

  test("a version that differs from the tag is a problem", () => {
    expect(releaseProblems("fish", "0.3.0", config("0.2.0", [endpoint]))).toEqual([
      "the tag is 0.3.0 but src-tauri/shops/fish/tauri.conf.json is 0.2.0",
    ]);
  });

  test("a shop that would update from no channel, or another shop's, is a problem", () => {
    const problem =
      "src-tauri/shops/fish/tauri.conf.json must update from releases/download/fish-updates/latest.json";
    expect(releaseProblems("fish", "0.3.0", config("0.3.0"))).toEqual([problem]);
    expect(
      releaseProblems("fish", "0.3.0", config("0.3.0", [endpoint.replace("fish-updates", "mobile-updates")])),
    ).toEqual([problem]);
  });
});
