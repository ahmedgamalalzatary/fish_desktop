import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { cx } from "../lib/cx";
import { colorOptions, newDraft, repeatedSerials, storageOptions, type PhoneDraft } from "../lib/phones";
import type { Product } from "../lib/types";
import { Button, Input, Select } from "./ui";

/**
 * Rows of phones being added, one serial per row. With `products`, each row also picks its model
 * (a supplier invoice can mix models). Enter in a serial field starts the next row, so a barcode
 * scanner can read a whole box in a row.
 */
export function PhoneLines({
  drafts,
  onChange,
  products,
}: {
  drafts: PhoneDraft[];
  onChange: (drafts: PhoneDraft[]) => void;
  products?: Product[];
}) {
  const id = useId();
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const repeated = repeatedSerials(drafts);
  const grid = products
    ? "grid-cols-[minmax(10rem,1.3fr)_minmax(9rem,1.2fr)_6.5rem_6.5rem_4.5rem_7rem_7rem_2.25rem]"
    : "grid-cols-[minmax(10rem,1.4fr)_7rem_7rem_5rem_7.5rem_7.5rem_2.25rem]";

  const set = (key: number, patch: Partial<PhoneDraft>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const addAfterLast = () => {
    const next = newDraft(drafts[drafts.length - 1]);
    onChange([...drafts, next]);
    setFocusKey(next.key);
  };

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className={cx("grid gap-2 border-b border-line px-4 py-2.5 text-sm font-medium text-dim", grid)}>
        {products && <span>الموديل</span>}
        <span>الرقم التسلسلي</span>
        <span>السعة</span>
        <span>اللون</span>
        <span>البطارية %</span>
        <span>سعر الشراء</span>
        <span>سعر البيع</span>
        <span />
      </div>
      {drafts.map((d, i) => (
        <div key={d.key} className={cx("grid items-center gap-2 border-b border-line/70 px-4 py-2", grid)}>
          {products && (
            <Select
              value={d.productId}
              onChange={(e) => set(d.key, { productId: e.target.value })}
              aria-label="الموديل"
            >
              <option value="" disabled>
                اختر الموديل
              </option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
          <Input
            dir="ltr"
            value={d.serial}
            autoFocus={d.key === focusKey}
            onChange={(e) => set(d.key, { serial: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && i === drafts.length - 1 && d.serial.trim()) {
                e.preventDefault();
                addAfterLast();
              }
            }}
            placeholder="IMEI / S/N"
            aria-label="الرقم التسلسلي"
            className={cx("font-medium", repeated.has(d.serial.trim().toLowerCase()) && "border-alert")}
          />
          <Input
            dir="ltr"
            list={`${id}-storage`}
            value={d.storage}
            onChange={(e) => set(d.key, { storage: e.target.value })}
            aria-label="السعة"
          />
          <Input
            list={`${id}-color`}
            value={d.color}
            onChange={(e) => set(d.key, { color: e.target.value })}
            aria-label="اللون"
          />
          <Input
            dir="ltr"
            inputMode="numeric"
            value={d.battery}
            onChange={(e) => set(d.key, { battery: e.target.value })}
            placeholder="—"
            aria-label="البطارية %"
          />
          <Input
            dir="ltr"
            inputMode="decimal"
            value={d.cost}
            onChange={(e) => set(d.key, { cost: e.target.value })}
            aria-label="سعر الشراء"
          />
          <Input
            dir="ltr"
            inputMode="decimal"
            value={d.price}
            onChange={(e) => set(d.key, { price: e.target.value })}
            aria-label="سعر البيع"
          />
          <Button
            tone="ghost"
            size="icon"
            onClick={() => onChange(drafts.length > 1 ? drafts.filter((x) => x.key !== d.key) : [newDraft()])}
            aria-label="حذف الجهاز"
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <Button tone="ghost" size="sm" onClick={addAfterLast}>
          <Plus className="size-4" />
          جهاز آخر
        </Button>
        <span className="text-xs text-dim">
          {repeated.size > 0
            ? "رقم تسلسلي مكرر في القائمة"
            : "اضغط Enter بعد الرقم التسلسلي لإضافة جهاز بنفس البيانات"}
        </span>
      </div>
      <datalist id={`${id}-storage`}>
        {storageOptions.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id={`${id}-color`}>
        {colorOptions.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}
