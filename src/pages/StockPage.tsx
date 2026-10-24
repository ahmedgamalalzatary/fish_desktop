import { LogOut, PackagePlus, Pencil, Plus, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { ExportButtons } from "../components/ExportButtons";
import { ReportDocument } from "../components/ReportDocument";
import { Button, Empty, Field, Input, Modal, PageHeader, Panel, Select } from "../components/ui";
import { api } from "../lib/api";
import { section } from "../lib/document";
import { formatAmount, formatMoney, formatPhones, isoDate, phoneDetails } from "../lib/format";
import { colorOptions, draftFromPhone, readDraft, storageOptions, type PhoneDraft } from "../lib/phones";
import { useSession } from "../lib/session";
import { stockColumns, stockRows, type StockRow } from "../lib/stock";
import { errorMessage, useToast } from "../lib/toast";
import { useResource } from "../lib/useResource";
import { AddPhonesModal } from "./ProductsPage";
import { PurchaseFormModal } from "./PurchasesPage";

const matches = (r: StockRow, q: string) =>
  [r.product.name, r.phone.serial, r.phone.storage, r.phone.color].some((s) => s.toLowerCase().includes(q));

export function StockPage() {
  const { settings } = useSession();
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState("");
  const [action, setAction] = useState<
    { kind: "add" } | { kind: "purchase" } | { kind: "edit" | "remove"; row: StockRow } | null
  >(null);

  const [data, load] = useResource(useCallback(() => api.listProducts(), []));
  const products = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => stockRows(products), [products]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (!productId || String(r.product.id) === productId) && (!q || matches(r, q)));
  }, [rows, query, productId]);
  const costValue = visible.reduce((s, r) => s + r.phone.cost, 0);
  const priceValue = visible.reduce((s, r) => s + r.phone.price, 0);

  const columns: Column<StockRow>[] = [
    ...stockColumns(visible),
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

  const figures = [
    { label: "الأجهزة في المخزون", value: formatPhones(visible.length) },
    { label: "قيمتها بسعر الشراء", value: formatMoney(costValue, settings.currency) },
    { label: "قيمتها بسعر البيع", value: formatMoney(priceValue, settings.currency) },
    { label: "الربح المتوقع", value: formatMoney(priceValue - costValue, settings.currency) },
  ];
  const done = () => (setAction(null), load());
  const active = products.filter((p) => p.active);

  return (
    <div className="p-8">
      <PageHeader
        title="المخزون"
        actions={
          <>
            <ExportButtons
              disabled={visible.length === 0}
              fileName={`المخزون-${isoDate(new Date())}`}
              document={() => (
                <ReportDocument
                  settings={settings}
                  title="تقرير المخزون"
                  figures={figures}
                  sections={[section({ columns: stockColumns(visible), rows: visible })]}
                />
              )}
            />
            <Button tone="outline" onClick={() => setAction({ kind: "purchase" })}>
              <PackagePlus className="size-4" />
              فاتورة شراء
            </Button>
            <Button onClick={() => setAction({ kind: "add" })} disabled={active.length === 0}>
              <Plus className="size-4" />
              إضافة أجهزة
            </Button>
          </>
        }
      />

      <Panel className="mb-6 grid grid-cols-4 divide-x divide-x-reverse divide-line">
        {figures.map((f) => (
          <div key={f.label} className="px-5 py-4">
            <div className="text-sm text-dim">{f.label}</div>
            <div className="mt-1 text-lg font-semibold">{f.value}</div>
          </div>
        ))}
      </Panel>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-80">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-dim" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالرقم التسلسلي أو الموديل أو اللون"
            className="ps-9"
          />
        </div>
        <Select
          className="w-64"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          aria-label="الموديل"
        >
          <option value="">كل الموديلات</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.phones.length})
            </option>
          ))}
        </Select>
      </div>

      <Panel className="overflow-hidden">
        {visible.length === 0 ? (
          <Empty title={rows.length === 0 ? "المخزون فارغ" : "لا يوجد جهاز بهذا البحث"}>
            {rows.length === 0 && "أضف الأجهزة من «إضافة أجهزة» أو من «فاتورة شراء»، برقم تسلسلي لكل جهاز."}
          </Empty>
        ) : (
          <DataTable columns={columns} rows={visible} rowKey={(r) => r.phone.id} />
        )}
      </Panel>

      {action?.kind === "add" && (
        <AddPhonesModal products={active} onClose={() => setAction(null)} onSaved={done} />
      )}
      {action?.kind === "purchase" && <PurchaseFormModal onClose={() => setAction(null)} onSaved={done} />}
      {action?.kind === "edit" && (
        <EditPhoneModal row={action.row} onClose={() => setAction(null)} onSaved={done} />
      )}
      {action?.kind === "remove" && (
        <RemovePhoneModal row={action.row} onClose={() => setAction(null)} onSaved={done} />
      )}
    </div>
  );
}

function EditPhoneModal({
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

function RemovePhoneModal({
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
          <div className="text-sm text-dim">
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
              className="h-7 rounded-full border border-line px-3 text-xs text-ink-2 transition-colors hover:border-ink-3/40 hover:bg-glass"
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
