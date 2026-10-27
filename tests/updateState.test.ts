import { describe, expect, test } from "vitest";
import {
  downloadPercent,
  initialUpdate,
  installsNow,
  updateReducer,
  updateStatus,
  type UpdateEvent,
} from "../src/lib/updateState";

const run = (...events: UpdateEvent[]) => events.reduce(updateReducer, initialUpdate);

describe("updateReducer", () => {
  test("a check that finds a newer version offers it", () => {
    expect(run({ type: "check" })).toEqual({ step: "checking" });
    expect(run({ type: "check" }, { type: "found", version: "0.3.1", notes: "إصلاحات" })).toEqual({
      step: "available",
      version: "0.3.1",
      notes: "إصلاحات",
    });
  });

  test("a check that finds nothing says the app is up to date", () => {
    expect(run({ type: "check" }, { type: "none" })).toEqual({ step: "latest" });
  });

  test("downloading counts the bytes, then installs", () => {
    const found: UpdateEvent[] = [{ type: "check" }, { type: "found", version: "0.3.1", notes: "" }];
    expect(run(...found, { type: "download" })).toEqual({
      step: "downloading",
      version: "0.3.1",
      done: 0,
      total: null,
    });
    const halfway = run(
      ...found,
      { type: "download" },
      { type: "started", total: 1000 },
      { type: "progress", chunk: 250 },
      { type: "progress", chunk: 250 },
    );
    expect(halfway).toEqual({ step: "downloading", version: "0.3.1", done: 500, total: 1000 });
    expect(updateReducer(halfway, { type: "finished" })).toEqual({ step: "installing", version: "0.3.1" });
  });

  test("a failure at any step is shown, and checking again starts over", () => {
    const failed = run({ type: "check" }, { type: "failed", message: "offline" });
    expect(failed).toEqual({ step: "failed", message: "offline" });
    expect(updateReducer(failed, { type: "check" })).toEqual({ step: "checking" });
  });

  test("download events outside a download are ignored", () => {
    expect(run({ type: "progress", chunk: 10 })).toEqual(initialUpdate);
    expect(run({ type: "check" }, { type: "none" }, { type: "download" })).toEqual({ step: "latest" });
  });
});

describe("downloadPercent", () => {
  test("is the share downloaded, whole and never over 100", () => {
    expect(downloadPercent({ step: "downloading", version: "1", done: 333, total: 1000 })).toBe(33);
    expect(downloadPercent({ step: "downloading", version: "1", done: 1200, total: 1000 })).toBe(100);
  });

  test("is unknown when the size is unknown", () => {
    expect(downloadPercent({ step: "downloading", version: "1", done: 333, total: null })).toBeNull();
    expect(downloadPercent({ step: "latest" })).toBeNull();
  });
});

describe("updateStatus", () => {
  test("shows the download's progress when its size is known", () => {
    expect(updateStatus({ step: "downloading", version: "0.3.1", done: 450, total: 1000 })).toBe(
      "جارٍ تنزيل الإصدار 0.3.1 45%",
    );
    expect(updateStatus({ step: "downloading", version: "0.3.1", done: 450, total: null })).toBe(
      "جارٍ تنزيل الإصدار 0.3.1…",
    );
  });

  test("names the new version, and shows a failure's message", () => {
    expect(updateStatus({ step: "available", version: "0.3.1", notes: "" })).toBe("يتوفر إصدار جديد 0.3.1.");
    expect(updateStatus({ step: "failed", message: "تعذّر" })).toBe("تعذّر");
  });
});

describe("installsNow", () => {
  const available = { step: "available", version: "0.3.1", notes: "" } as const;

  test("an update found before anyone signs in installs right away", () => {
    expect(installsNow(available, false)).toBe(true);
  });

  test("never while someone is working, and only once there is an update", () => {
    expect(installsNow(available, true)).toBe(false);
    expect(installsNow({ step: "latest" }, false)).toBe(false);
    expect(installsNow({ step: "failed", message: "x" }, false)).toBe(false);
  });
});
