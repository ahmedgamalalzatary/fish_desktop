import { useCallback, useState } from "react";
import type { Column } from "../../components/DataTable";
import { Empty } from "../../components/ui";
import { formatAmount, parseMoney } from "../../lib/format";
import type { PurchaseForm } from "../../lib/shop";
import type { Purchase } from "../../lib/types";
import { useResource } from "../../lib/useResource";
import { api } from "./api";
import { formatPhones, phoneDetails } from "./format";
import { PhoneLines } from "./PhoneLines";
import { isBlank, newDraft, readDraft, repeatedSerials, type PhoneDraft } from "./phones";
import type { PurchaseItem, PurchaseLines } from "./types";

/** The invoice's phones, one row per serial, each picking its model. */
export function usePurchaseLines(): PurchaseForm {
  const [products] = useResource(useCallback(() => api.listProducts(), []));
  const [drafts, setDrafts] = useState<PhoneDraft[]>(() => [newDraft()]);
  const filled = drafts.filter((d) => !isBlank(d));

  const read = () => {
    if (filled.length === 0) return { error: "أضف جهازاً واحداً على الأقل" };
    if (repeatedSerials(filled).size > 0) return { error: "رقم تسلسلي مكرر في الفاتورة" };
    const items: PurchaseLines = [];
    for (const d of filled) {
      if (!d.productId) return { error: `اختر الموديل للجهاز ${d.serial || "الفارغ"}` };
      const draft = readDraft(d);
      if ("error" in draft) return { error: draft.error };
      items.push({ product_id: Number(d.productId), ...draft.input });
    }
    return { items };
  };

  return {
    editor:
      products && products.length === 0 ? (
        <Empty title="لا توجد موديلات بعد">أضف الموديلات من صفحة المنتجات، ثم سجّل أجهزتها هنا.</Empty>
      ) : (
        <PhoneLines drafts={drafts} onChange={setDrafts} products={products ?? []} />
      ),
    total: filled.reduce((s, d) => s + (parseMoney(d.cost) ?? 0), 0),
    count: formatPhones(filled.length),
    read,
  };
}

const statusLabels = { in_stock: "في المخزون", sold: "بِيع", removed: "خرج من المخزون" };

export function purchaseItemColumns(p: Purchase): Column<PurchaseItem>[] {
  return [
    { header: "الموديل", cell: (i) => i.product_name },
    { header: "الرقم التسلسلي", cell: (i) => <span dir="ltr">{i.serial}</span> },
    { header: "التفاصيل", cell: (i) => phoneDetails(i) || "—" },
    { header: "الحالة", cell: (i) => statusLabels[i.status] },
    {
      header: "سعر الشراء",
      numeric: true,
      cell: (i) => formatAmount(i.cost),
      total: formatAmount(p.total),
    },
  ];
}
