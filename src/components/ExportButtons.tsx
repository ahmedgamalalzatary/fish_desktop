import { FileDown, Printer } from "lucide-react";
import { useState, type ReactNode } from "react";
import { exportPdf, printDocument, type PageKind } from "../lib/print";
import { errorMessage, useToast } from "../lib/toast";
import { Button } from "./ui";

/** "Print" and "Save as PDF" for a document built on demand. */
export function ExportButtons({
  document,
  kind = "a4",
  fileName,
  disabled,
  primary,
}: {
  document: () => ReactNode;
  kind?: PageKind;
  fileName: string;
  disabled?: boolean;
  /** Make "Print" the main action, e.g. right after a sale. */
  primary?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        tone={primary ? "primary" : "outline"}
        disabled={disabled || busy}
        onClick={() => run(() => printDocument(document(), kind))}
        data-autofocus={primary || undefined}
      >
        <Printer className="size-4" />
        طباعة
      </Button>
      <Button
        tone="outline"
        disabled={disabled || busy}
        onClick={() =>
          run(async () => {
            if (await exportPdf(document(), kind, fileName)) toast("تم حفظ ملف PDF");
          })
        }
      >
        <FileDown className="size-4" />
        حفظ PDF
      </Button>
    </>
  );
}
