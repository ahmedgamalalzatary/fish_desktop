import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useReducer, useRef } from "react";
import { initialUpdate, updateReducer } from "./updateState";

/** Checks for a newer version of the app and installs it, then restarts. */
export function useUpdater() {
  const [state, dispatch] = useReducer(updateReducer, initialUpdate);
  const update = useRef<Update | null>(null);

  const find = useCallback(async () => {
    dispatch({ type: "check" });
    try {
      update.current = await check();
      dispatch(
        update.current
          ? { type: "found", version: update.current.version, notes: update.current.body ?? "" }
          : { type: "none" },
      );
    } catch (e) {
      console.error("update check failed", e);
      dispatch({ type: "failed", message: "تعذّر البحث عن تحديث. تأكد من اتصال الإنترنت ثم حاول مرة أخرى." });
    }
  }, []);

  const install = useCallback(async () => {
    if (!update.current) return;
    dispatch({ type: "download" });
    try {
      await update.current.downloadAndInstall((e) => {
        if (e.event === "Started") dispatch({ type: "started", total: e.data.contentLength });
        else if (e.event === "Progress") dispatch({ type: "progress", chunk: e.data.chunkLength });
        else dispatch({ type: "finished" });
      });
      await relaunch();
    } catch (e) {
      console.error("update install failed", e);
      dispatch({ type: "failed", message: "تعذّر تنزيل التحديث. حاول مرة أخرى." });
    }
  }, []);

  return { state, find, install };
}
