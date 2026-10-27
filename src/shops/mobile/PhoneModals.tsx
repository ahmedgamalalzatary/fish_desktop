import { LogOut, Pencil, Plus, Smartphone } from "lucide-react";
import { useState } from "react";
import { api } from "./api";
import { formatAmount, formatMoney } from "../../lib/format";
import { formatPhones, phoneDetails } from "./format";
import {
  colorOptions,
  draftFromPhone,
  isBlank,
  newDraft,
  readDraft,
  storageOptions,
  useReadDrafts,
  type PhoneDraft,
} from "./phones";
import { useSession } from "../../lib/session";
import { stockColumns, type StockRow } from "./stock";
import { errorMessage, useToast } from "../../lib/toast";
import type { Product } from "./types";
import { DataTable, type Column } from "../../components/DataTable";
import { PhoneLines } from "./PhoneLines";
import { Button, Empty, Field, Input, Modal, Select } from "../../components/ui";

/**
 * Every phone of one model in stock, with its specs, and what can be done with each. Opening a
 * phone's edit or take-out form replaces this window until it is closed, so Escape closes one at a time.
 */
export function ModelPhonesModal({
  product,
  onClose,
  onChanged,
}: {
  product: Product;
  onClose: () => void;
  /** Called after any change, so the caller reloads and passes the updated product back in. */
  onChanged: () => void;
}) {
  const { settings } = useSession();
  const [action, setAction] = useState<{ kind: "edit" | "remove"; row: StockRow } | { kind: "add" } | null>(
    null,
  );
  const rows: StockRow[] = product.phones.map((phone) => ({ product, phone }));
  const done = () => (setAction(null), onChanged());

  if (action?.kind === "add")
    return (
      <AddPhonesModal products={[product]} product={product} onClose={() => setAction(null)} onSaved={done} />
    );
  if (action?.kind === "edit")
    return <EditPhoneModal row={action.row} onClose={() => setAction(null)} onSaved={done} />;
  if (action?.kind === "remove")
    return <RemovePhoneModal row={action.row} onClose={() => setAction(null)} onSaved={done} />;

  const columns: Column<StockRow>[] = [
    // The model is the window's title, so its column is left out.
    ...stockColumns(rows).slice(1),
    {
      header: "",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            tone="ghost"
            size="icon"
            onClick={() => setAction({ kind: "edit", row: r })}
            aria-label="تعديل"
          >
            <Pencil className="size-4" />
          </Button>
          <Button tone="ghost" size="sm" onClick={() => setAction({ kind: "remove", row: r })}>
            <LogOut className="size-4 -scale-x-100" />
            إخراج
          </Button>
        </div>
      ),
    },
  ];
  const value = rows.reduce((s, r) => s + r.phone.price, 0);

  return (
    <Modal
      title={product.name}
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <>
          <span className="me-auto text-sm text-muted">
            {formatPhones(rows.length)} · بسعر البيع {formatMoney(value, settings.currency)}
          </span>
          {product.active && (
            <Button onClick={() => setAction({ kind: "add" })}>
              <Plus className="size-4" />
              إضافة أجهزة
            </Button>
          )}
        </>
      }
    >
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {rows.length ? (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.phone.id} />
        ) : (
          <Empty title="لا توجد أجهزة من هذا الموديل في المخزون">
            أضفها من «إضافة أجهزة» أو من فاتورة شراء.
          </Empty>
        )}
      </div>
    </Modal>
  );
}

/** Adds phones of one model without a supplier invoice. Without `product`, the model is picked here. */
export function AddPhonesModal({
  products,
  product,
  onClose,
  onSaved,
}: {
  products: Product[];
  product?: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const readDrafts = useReadDrafts();
  const [productId, setProductId] = useState(product ? String(product.id) : "");
  const [drafts, setDrafts] = useState<PhoneDraft[]>(() => {
    // Start from the model's latest phone, so its storage, color and prices are already filled in.
    const last = product?.phones[product.phones.length - 1];
    if (!last) return [newDraft()];
    return [{ ...draftFromPhone(last), serial: "", battery: "" }];
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!productId) return toast("اختر الموديل", "error");
    const phones = readDrafts(drafts);
    if (!phones) return;
    if (phones.length === 0) return toast("أضف جهازاً واحداً على الأقل", "error");
    setBusy(true);
    try {
      await api.addPhones(Number(productId), phones);
      toast(`أُضيف ${formatPhones(phones.length)} إلى المخزون`);
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={product ? `إضافة أجهزة · ${product.name}` : "إضافة أجهزة"}
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <>
          <span className="me-auto text-sm text-muted">
            <Smartphone className="me-1 inline size-4" />
            {formatPhones(drafts.filter((d) => !isBlank(d)).length)}
          </span>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={busy}>
            إضافة إلى المخزون
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {!product && (
          <Field label="الموديل" className="max-w-md">
            {(id) => (
              <Select id={id} value={productId} onChange={(e) => setProductId(e.target.value)}>
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
          </Field>
        )}
        <PhoneLines drafts={drafts} onChange={setDrafts} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function EditPhoneModal({
  row,
  onClose,
  onSaved,
}: {
  row: StockRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<PhoneDraft>(() => draftFromPhone(row.phone));
  const fromInvoice = row.phone.purchase_id !== null;
  const set = (patch: Partial<PhoneDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    const read = readDraft(draft);
    if ("error" in read) return toast(read.error, "error");
    try {
      await api.updatePhone(row.phone.id, read.input);
      toast("حُفظ الجهاز");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Modal
      title={`تعديل جهاز · ${row.product.name}`}
      onClose={onClose}
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save}>حفظ</Button>
        </>
      }
    >
      <form
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="الرقم التسلسلي" className="col-span-2">
          {(id) => (
            <Input id={id} dir="ltr" value={draft.serial} onChange={(e) => set({ serial: e.target.value })} />
          )}
        </Field>
        <Field label="السعة">
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              list="edit-storage"
              value={draft.storage}
              onChange={(e) => set({ storage: e.target.value })}
            />
          )}
        </Field>
        <Field label="اللون">
          {(id) => (
            <Input
              id={id}
              list="edit-color"
              value={draft.color}
              onChange={(e) => set({ color: e.target.value })}
            />
          )}
        </Field>
        <Field label="البطارية %" hint="اتركها فارغة للجهاز الجديد.">
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              inputMode="numeric"
              value={draft.battery}
              onChange={(e) => set({ battery: e.target.value })}
            />
          )}
        </Field>
        <div />
        <Field
          label="سعر الشراء"
          hint={fromInvoice ? `من فاتورة الشراء #${row.phone.purchase_id}` : undefined}
        >
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              inputMode="decimal"
              value={draft.cost}
              disabled={fromInvoice}
              onChange={(e) => set({ cost: e.target.value })}
            />
          )}
        </Field>
        <Field label="سعر البيع">
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              inputMode="decimal"
              value={draft.price}
              onChange={(e) => set({ price: e.target.value })}
            />
          )}
        </Field>
        <datalist id="edit-storage">
          {storageOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <datalist id="edit-color">
          {colorOptions.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

const removeReasons = ["أُضيف بالخطأ", "مرتجع للمورد", "تالف", "مفقود"];

export function RemovePhoneModal({
  row,
  onClose,
  onSaved,
}: {
  row: StockRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");

  const save = async () => {
    try {
      await api.removePhone(row.phone.id, note);
      toast(`خرج الجهاز ${row.phone.serial} من المخزون`);
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Modal
      title="إخراج جهاز من المخزون"
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            تراجع
          </Button>
          <Button tone="danger" onClick={save} disabled={!note.trim()}>
            إخراج من المخزون
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="rounded-xl border border-line bg-white px-4 py-3">
          <div className="font-medium">{row.product.name}</div>
          <div className="text-sm text-muted">
            <span dir="ltr">{row.phone.serial}</span>
            {phoneDetails(row.phone) && ` · ${phoneDetails(row.phone)}`} · {formatAmount(row.phone.price)}
          </div>
        </div>
        <p className="text-sm leading-6 text-ink-2">
          للأجهزة التي تخرج بغير بيع. يبقى الجهاز في حركة المخزون بالسبب الذي تكتبه.
        </p>
        <Field label="السبب">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap gap-2">
          {removeReasons.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setNote(r)}
              className="h-7 rounded-full border border-line px-3 text-xs text-ink-2 transition-colors hover:border-ink-3/40 hover:bg-surface"
            >
              {r}
            </button>
          ))}
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
