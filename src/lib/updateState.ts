// Where an app update stands: checked, found, downloading, installing. Kept apart from the updater plugin
// so it can be tested.

export type UpdateState =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "latest" }
  | { step: "available"; version: string; notes: string }
  | { step: "downloading"; version: string; done: number; total: number | null }
  | { step: "installing"; version: string }
  | { step: "failed"; message: string };

export type UpdateEvent =
  | { type: "check" }
  | { type: "found"; version: string; notes: string }
  | { type: "none" }
  | { type: "download" }
  | { type: "started"; total?: number }
  | { type: "progress"; chunk: number }
  | { type: "finished" }
  | { type: "failed"; message: string };

export const initialUpdate: UpdateState = { step: "idle" };

export function updateReducer(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case "check":
      return { step: "checking" };
    case "found":
      return { step: "available", version: event.version, notes: event.notes };
    case "none":
      return { step: "latest" };
    case "failed":
      return { step: "failed", message: event.message };
    case "download":
      return state.step === "available"
        ? { step: "downloading", version: state.version, done: 0, total: null }
        : state;
  }
  if (state.step !== "downloading") return state;
  switch (event.type) {
    case "started":
      return { ...state, total: event.total ?? null };
    case "progress":
      return { ...state, done: state.done + event.chunk };
    case "finished":
      return { step: "installing", version: state.version };
  }
}

/** How much of the update is downloaded, 0–100, or null while the size is unknown. */
export function downloadPercent(state: UpdateState): number | null {
  if (state.step !== "downloading" || !state.total) return null;
  return Math.min(100, Math.floor((state.done / state.total) * 100));
}

/** What the update is doing, in words. */
export function updateStatus(state: UpdateState): string {
  switch (state.step) {
    case "idle":
      return "";
    case "checking":
      return "جارٍ البحث عن تحديث…";
    case "latest":
      return "لديك أحدث إصدار.";
    case "available":
      return `يتوفر إصدار جديد ${state.version}.`;
    case "downloading": {
      const percent = downloadPercent(state);
      return `جارٍ تنزيل الإصدار ${state.version}${percent === null ? "…" : ` ${percent}%`}`;
    }
    case "installing":
      return "جارٍ التثبيت، سيُعاد تشغيل البرنامج.";
    case "failed":
      return state.message;
  }
}
