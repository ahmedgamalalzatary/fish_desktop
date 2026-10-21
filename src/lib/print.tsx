import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

export type PageKind = "a4" | "receipt";

const pageCss: Record<PageKind, string> = {
  a4: "@page { size: A4; margin: 12mm; }",
  receipt: "@page { size: 80mm auto; margin: 0; }",
};

/**
 * Mounts `node` into #print-root (the only element visible in print media),
 * runs `action`, then cleans up.
 */
async function withPrintRoot<T>(
  node: ReactNode,
  kind: PageKind,
  action: (host: HTMLElement) => Promise<T> | T,
) {
  const host = document.getElementById("print-root")!;
  const style = document.createElement("style");
  style.textContent = pageCss[kind];
  document.head.appendChild(style);
  const root = createRoot(host);
  flushSync(() => root.render(node));
  try {
    await document.fonts.ready;
    return await action(host);
  } finally {
    root.unmount();
    style.remove();
  }
}

/** Opens the system print dialog for `node`. */
export function printDocument(node: ReactNode, kind: PageKind) {
  return withPrintRoot(node, kind, () => window.print());
}

const MM_PER_INCH = 25.4;

/** Asks where to save, then writes `node` as a PDF. Returns false when the user cancels. */
export async function exportPdf(node: ReactNode, kind: PageKind, fileName: string): Promise<boolean> {
  const path = await save({
    defaultPath: `${fileName}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return false;

  await withPrintRoot(node, kind, async (host) => {
    let size = { width: 210 / MM_PER_INCH, height: 297 / MM_PER_INCH, margin: 12 / MM_PER_INCH };
    if (kind === "receipt") {
      // A receipt is one continuous strip: measure its height off-screen.
      host.style.cssText = "display:block;position:fixed;top:0;left:-10000px;width:80mm";
      const heightIn = host.scrollHeight / 96;
      host.style.cssText = "";
      size = { width: 80 / MM_PER_INCH, height: Math.max(heightIn + 0.1, 2), margin: 0 };
    }
    await invoke("export_pdf", { path, ...size });
  });
  return true;
}
