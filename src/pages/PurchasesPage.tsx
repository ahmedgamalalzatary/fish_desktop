import { Banknote, FileText, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { ExportButtons } from "../components/ExportButtons";
import { ReportDocument } from "../components/ReportDocument";
import {
  Badge,
  Button,
  ConfirmDialog,
  Empty,
  Field,
  Input,
  Screen,
  Modal,
  PageHeader,
  Panel,
  Segmented,
  Select,
  Toggle,
} from "../components/ui";
import { api } from "../lib/api";
import { section } from "../lib/document";
import {
  formatAmount,
  formatDateTime,
  formatMoney,
  isoDate,
  itemName,
  parseCount,
  parseMoney,
} from "../lib/format";
import { purchaseColumns } from "../lib/purchases";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import { stockRows, type StockRow } from "../lib/stock";
import type { Purchase, StatementRow, Supplier } from "../lib/types";
import { useResource } from "../lib/useResource";

type Tab = "invoices" | "suppliers";

const monthStart = () => {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
};

export function PurchasesPage() {
  const [tab, setTab] = useState<Tab>("invoices");
  const [creating, setCreating] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | "new" | null>(null);
  // Bumped after any change so both tabs reload.
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((v) => v + 1);

  return (
    <div className="p-8">
      <PageHeader
        title="المشتريات"
        actions={
          <>
            <Button tone="outline" onClick={() => setEditingSupplier("new")}>
              <Plus className="size-4" />
              مورد جديد
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              فاتورة شراء
            </Button>
          </>
        }
      />
      <div className="mb-4 w-80">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "invoices", label: "فواتير الشراء" },
            { value: "suppliers", label: "الموردون والحسابات" },
          ]}
        />
      </div>

      {tab === "invoices" ? (
        <InvoicesTab version={version} onChanged={changed} />
      ) : (
        <SuppliersTab version={version} onChanged={changed} onEdit={setEditingSupplier} />
      )}

      {creating && (
        <PurchaseFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            changed();
          }}
        />
      )}
      {editingSupplier && (
        <SupplierFormModal
          supplier={editingSupplier === "new" ? null : editingSupplier}
          onClose={() => setEditingSupplier(null)}
          onSaved={() => {
            setEditingSupplier(null);
            changed();
          }}
        />
      )}
    </div>
  );
}

function InvoicesTab({ version, onChanged }: { version: number; onChanged: () => void }) {
  const { settings } = useSession();
  const [range, setRange] = useState({
    from: monthStart(),
    to: isoDate(new Date()),
  });
  const [supplierId, setSupplierId] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const [suppliers] = useResource(useCallback(() => api.listSuppliers(), []));
  const [data] = useResource(
    useCallback(
      () => api.listPurchases(range, supplierId ? Number(supplierId) : null),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` forces a reload
      [range, supplierId, version],
    ),
  );
  const rows = data ?? [];
  const columns = purchaseColumns(rows);
  const supplierName = suppliers?.find((s) => String(s.id) === supplierId)?.name;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="date"
          className="w-40"
          value={range.from}
          max={range.to}
          onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
          aria-label="من"
        />
        <span className="text-dim">إلى</span>
        <Input
          type="date"
          className="w-40"
          value={range.to}
          min={range.from}
          onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
          aria-label="إلى"
        />
        <Select
          className="ms-2 w-56"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          aria-label="المورد"
        >
          <option value="">كل الموردين</option>
          {suppliers?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <div className="ms-auto flex gap-2">
          <ExportButtons
            disabled={rows.length === 0}
            fileName={`فواتير-الشراء-${range.from}_${range.to}`}
            document={() => (
              <ReportDocument
                settings={settings}
                title={supplierName ? `فواتير الشراء · ${supplierName}` : "فواتير الشراء"}
                from={range.from}
                to={range.to}
                sections={[section({ columns, rows })]}
              />
            )}
          />
        </div>
      </div>
      <Panel className="overflow-hidden">
        {rows.length === 0 ? (
          <Empty title="لا توجد فواتير شراء في هذه الفترة">
            سجّل البضاعة المستلمة من «فاتورة شراء» لتُضاف إلى المخزون وحساب المورد.
          </Empty>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} />
        )}
      </Panel>
      {openId !== null && (
        <PurchaseDetailModal
          id={openId}
          onClose={() => setOpenId(null)}
          onDeleted={() => {
            setOpenId(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function SuppliersTab({
  version,
  onChanged,
  onEdit,
}: {
  version: number;
  onChanged: () => void;
  onEdit: (s: Supplier) => void;
}) {
  const { settings } = useSession();
  const toast = useToast();
  const [paying, setPaying] = useState<Supplier | null>(null);
  const [statement, setStatement] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` forces a reload
  const [data] = useResource(useCallback(() => api.listSuppliers(), [version]));
  const suppliers = data ?? [];
  const owed = suppliers.reduce((s, x) => s + x.balance, 0);

  const remove = async (s: Supplier) => {
    setDeleting(null);
    try {
      const result = await api.deleteSupplier(s.id);
      toast(
        result === "deactivated" ? `أُوقف «${s.name}» لأن له فواتير أو دفعات مسجّلة` : `حُذف «${s.name}»`,
      );
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const balanceColumn: Column<Supplier> = {
    header: `المستحق (${settings.currency})`,
    numeric: true,
    cell: (s) => <Balance amount={s.balance} />,
    total: formatAmount(owed),
  };
  const columns: Column<Supplier>[] = [
    {
      header: "المورد",
      cell: (s) => (
        <div>
          <span className="font-medium">{s.name}</span>
          {!s.active && (
            <span className="ms-2">
              <Badge tone="danger">موقوف</Badge>
            </span>
          )}
          {s.phone && (
            <div dir="ltr" className="text-end text-xs text-dim">
              {s.phone}
            </div>
          )}
        </div>
      ),
    },
    { header: "الفواتير", numeric: true, cell: (s) => s.purchases_count },
    {
      header: "إجمالي المشتريات",
      numeric: true,
      cell: (s) => formatAmount(s.purchases_total),
    },
    {
      header: "إجمالي المدفوع",
      numeric: true,
      cell: (s) => formatAmount(s.paid_total),
    },
    balanceColumn,
    {
      header: "آخر فاتورة",
      cell: (s) => (
        <span className="text-dim">
          {s.last_purchase ? formatDateTime(s.last_purchase).split(" ")[0] : "—"}
        </span>
      ),
    },
    {
      header: "",
      cell: (s) => (
        <div className="flex justify-end gap-1">
          <Button tone="outline" size="sm" onClick={() => setPaying(s)} disabled={!s.active}>
            <Banknote className="size-4" />
            دفعة
          </Button>
          <Button tone="ghost" size="sm" onClick={() => setStatement(s)}>
            <FileText className="size-4" />
            كشف حساب
          </Button>
          <Button tone="ghost" size="icon" onClick={() => onEdit(s)} aria-label="تعديل">
            <Pencil className="size-4" />
          </Button>
          <Button tone="danger-ghost" size="icon" onClick={() => setDeleting(s)} aria-label="حذف">
            <Trash2 className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Panel className="overflow-hidden">
        {suppliers.length === 0 ? (
          <Empty title="لا يوجد موردون بعد">أضف المورد مرة واحدة، ثم اختره في كل فاتورة شراء.</Empty>
        ) : (
          <DataTable columns={columns} rows={suppliers} rowKey={(s) => s.id} />
        )}
      </Panel>

      {paying && (
        <PaymentModal
          supplier={paying}
          onClose={() => setPaying(null)}
          onSaved={() => {
            setPaying(null);
            onChanged();
          }}
        />
      )}
      {statement && (
        <StatementModal supplier={statement} onClose={() => setStatement(null)} onChanged={onChanged} />
      )}
      {deleting && (
        <ConfirmDialog
          title="حذف المورد"
          message={`هل تريد حذف «${deleting.name}»؟ إن كانت له فواتير أو دفعات فسيُوقف فقط حتى يبقى حسابه في التقارير.`}
          confirmLabel="حذف"
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** Money the shop owes in red; a supplier in credit (overpaid) in green. */
function Balance({ amount }: { amount: number }) {
  if (amount === 0) return <span className="text-dim">0.00</span>;
  return (
    <span className={amount > 0 ? "font-semibold text-alert" : "font-semibold text-ok"}>
      {formatAmount(Math.abs(amount))}
      {amount < 0 && <span className="ms-1 text-xs font-normal">له رصيد</span>}
    </span>
  );
}

// ---- Purchase invoice form ----

interface Line {
  key: number;
  variantId: string;
  qty: string;
  unitCost: string;
}

let lineKey = 0;
const newLine = (variantId = ""): Line => ({
  key: ++lineKey,
  variantId,
  qty: "1",
  unitCost: "",
});

const costText = (cents: number) => (cents ? String(cents / 100) : "");

/** Records goods received from a supplier. `variantId` pre-fills the first line (from the stock page). */
export function PurchaseFormModal({
  variantId,
  onClose,
  onSaved,
}: {
  variantId?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { settings } = useSession();
  const toast = useToast();
  const [products] = useResource(useCallback(() => api.listProducts(), []));
  const [suppliers, reloadSuppliers] = useResource(useCallback(() => api.listSuppliers(), []));

  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [newLine(variantId ? String(variantId) : "")]);
  const [payInFull, setPayInFull] = useState(true);
  const [paidText, setPaidText] = useState("");
  const [updateCost, setUpdateCost] = useState(true);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(
    () => new Map(stockRows(products ?? []).map((r) => [String(r.variant.id), r])),
    [products],
  );
  const groups = useMemo(() => {
    const map = new Map<string, StockRow[]>();
    for (const r of stockRows(products ?? [])) {
      const p = r.product;
      const group = p.parent_category_name
        ? `${p.parent_category_name} / ${p.category_name}`
        : p.category_name;
      map.set(group, [...(map.get(group) ?? []), r]);
    }
    return [...map.entries()];
  }, [products]);
  const activeSuppliers = (suppliers ?? []).filter((s) => s.active);

  // An empty buy price means the item's current one, which the field shows as its placeholder.
  const parsed = lines.map((l) => ({
    qty: parseCount(l.qty),
    unitCost: l.unitCost ? parseMoney(l.unitCost) : (byId.get(l.variantId)?.variant.cost ?? 0),
  }));
  const total = parsed.reduce((s, l) => s + (l.qty ?? 0) * (l.unitCost ?? 0), 0);
  const paid = payInFull ? total : parseMoney(paidText || "0");
  const remaining = paid === null ? null : total - paid;
  const supplier = activeSuppliers.find((s) => String(s.id) === supplierId);

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!supplierId || (supplierId === "new" && !newSupplier.trim())) return toast("اختر المورد", "error");
    const filled = lines.map((l, i) => ({ l, ...parsed[i] })).filter(({ l }) => l.variantId || l.unitCost);
    if (filled.length === 0) return toast("أضف صنفاً واحداً على الأقل", "error");
    if (filled.some(({ l, qty, unitCost }) => !l.variantId || !qty || unitCost === null))
      return toast("أكمل الصنف والعدد وسعر الشراء لكل سطر", "error");
    if (paid === null || paid > total)
      return toast("المبلغ المدفوع يجب ألا يزيد عن إجمالي الفاتورة", "error");

    setBusy(true);
    try {
      let id = Number(supplierId);
      if (supplierId === "new") {
        id = await api.createSupplier({
          name: newSupplier,
          phone: "",
          note: "",
          opening_balance: 0,
          active: true,
        });
        // If saving the invoice fails below, retrying uses this supplier instead of creating it twice.
        setSupplierId(String(id));
        setNewSupplier("");
        reloadSuppliers();
      }
      const purchaseId = await api.createPurchase({
        supplier_id: id,
        invoice_no: invoiceNo,
        note,
        paid,
        update_cost: updateCost,
        items: filled.map(({ l, qty, unitCost }) => ({
          variant_id: Number(l.variantId),
          quantity: qty!,
          unit_cost: unitCost!,
        })),
      });
      toast(`حُفظت فاتورة الشراء #${purchaseId} وأُضيفت الكميات إلى المخزون`);
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="فاتورة شراء"
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={busy}>
            حفظ وإضافة للمخزون
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-[1.4fr_1fr] gap-4">
          <Field
            label="المورد"
            hint={
              supplier && supplier.balance !== 0
                ? `المستحق له حالياً: ${formatMoney(supplier.balance, settings.currency)}`
                : undefined
            }
          >
            {(id) => (
              <div className="flex gap-2">
                <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="" disabled>
                    اختر المورد
                  </option>
                  {activeSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value="new">+ مورد جديد</option>
                </Select>
                {supplierId === "new" && (
                  <Input
                    value={newSupplier}
                    onChange={(e) => setNewSupplier(e.target.value)}
                    placeholder="اسم المورد الجديد"
                    autoFocus
                  />
                )}
              </div>
            )}
          </Field>
          <Field label="رقم فاتورة المورد" hint="اختياري، للرجوع إلى ورقة المورد.">
            {(id) => (
              <Input id={id} dir="ltr" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            )}
          </Field>
        </div>

        <div className="rounded-xl border border-line bg-white">
          <div className="grid grid-cols-[1fr_6rem_9rem_8rem_2.25rem] gap-3 border-b border-line px-4 py-2.5 text-sm font-medium text-dim">
            <span>الصنف</span>
            <span>العدد</span>
            <span>سعر شراء القطعة</span>
            <span className="text-end">الإجمالي</span>
            <span />
          </div>
          {lines.map((l, i) => {
            const { qty, unitCost } = parsed[i];
            const row = byId.get(l.variantId);
            return (
              <div
                key={l.key}
                className="grid grid-cols-[1fr_6rem_9rem_8rem_2.25rem] items-center gap-3 border-b border-line/70 px-4 py-2.5"
              >
                <Select
                  value={l.variantId}
                  onChange={(e) => setLine(l.key, { variantId: e.target.value })}
                  aria-label="الصنف"
                >
                  <option value="" disabled>
                    اختر الصنف
                  </option>
                  {groups.map(([group, items]) => (
                    <optgroup key={group} label={group}>
                      {items.map((r) => (
                        <option key={r.variant.id} value={r.variant.id}>
                          {itemName(r.product.name, r.variant.label)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  value={l.qty}
                  onChange={(e) => setLine(l.key, { qty: e.target.value })}
                  aria-label="العدد"
                  className={l.qty && !qty ? "border-alert" : undefined}
                />
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  value={l.unitCost}
                  onChange={(e) => setLine(l.key, { unitCost: e.target.value })}
                  placeholder={row ? costText(row.variant.cost) : undefined}
                  aria-label="سعر شراء القطعة"
                  className={l.unitCost && unitCost === null ? "border-alert" : undefined}
                />
                <div className="text-end text-sm leading-5">
                  <div className="font-medium">
                    {qty && unitCost !== null ? formatAmount(qty * unitCost) : "—"}
                  </div>
                  {row && (
                    <div className="text-xs text-dim" title="سعر الشراء المسجّل حالياً">
                      الحالي {formatAmount(row.variant.cost)}
                    </div>
                  )}
                </div>
                <Button
                  tone="ghost"
                  size="icon"
                  onClick={() =>
                    setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))
                  }
                  aria-label="حذف الصنف"
                >
                  <X className="size-4" />
                </Button>
              </div>
            );
          })}
          <div className="px-4 py-2.5">
            <Button tone="ghost" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
              <Plus className="size-4" />
              إضافة صنف
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_17rem] items-start gap-6">
          <div className="flex flex-col gap-4">
            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink-2">الدفع للمورد</span>
              <div className="flex items-center gap-3">
                <div className="w-72">
                  <Segmented
                    value={payInFull ? "full" : "partial"}
                    onChange={(v) => setPayInFull(v === "full")}
                    options={[
                      { value: "full", label: "دُفع بالكامل" },
                      { value: "partial", label: "جزئي أو آجل" },
                    ]}
                  />
                </div>
                {!payInFull && (
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    className="w-36"
                    value={paidText}
                    onChange={(e) => setPaidText(e.target.value)}
                    placeholder="0"
                    aria-label="المدفوع الآن"
                    autoFocus
                  />
                )}
              </div>
              {!payInFull && (
                <p className="mt-1 text-xs text-dim">
                  اكتب ما دُفع الآن، أو اتركه فارغاً إن كانت الفاتورة كلها آجلة.
                </p>
              )}
            </div>
            <Toggle
              checked={updateCost}
              onChange={setUpdateCost}
              label="تحديث سعر الشراء للأصناف"
              description="يصبح سعر شراء كل صنف هو سعره في هذه الفاتورة، فيُحسب الربح بالسعر الجديد."
            />
            <Field label="ملاحظة">
              {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <Screen label="إجمالي الفاتورة" value={formatAmount(total)} unit={settings.currency} size="md" />
            <div className="flex items-center justify-between rounded-lg border border-line bg-white px-4 py-2.5 text-sm">
              <span className="text-dim">يُضاف لحساب المورد</span>
              <span
                className={
                  remaining === null
                    ? "font-semibold text-alert"
                    : remaining > 0
                      ? "font-semibold text-alert"
                      : "font-semibold"
                }
              >
                {remaining === null
                  ? "مبلغ غير صحيح"
                  : remaining < 0
                    ? "أكبر من الفاتورة"
                    : formatAmount(remaining)}
              </span>
            </div>
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---- One invoice: view, print, delete ----

function purchaseDocument(p: Purchase, settings: ReturnType<typeof useSession>["settings"]) {
  return (
    <ReportDocument
      settings={settings}
      title={`فاتورة شراء #${p.id}`}
      figures={[
        { label: "المورد", value: p.supplier_name },
        { label: "رقم فاتورة المورد", value: p.invoice_no || "—" },
        { label: "التاريخ", value: formatDateTime(p.created_at) },
        { label: "سجّلها", value: p.user_name },
        { label: "الإجمالي", value: formatMoney(p.total, settings.currency) },
        {
          label: "دُفع عند الاستلام",
          value: formatMoney(p.paid, settings.currency),
        },
        {
          label: "أُضيف لحساب المورد",
          value: formatMoney(p.total - p.paid, settings.currency),
        },
        { label: "ملاحظة", value: p.note || "—" },
      ]}
      sections={[
        section({
          columns: itemColumns(p),
          rows: p.items,
        }),
      ]}
    />
  );
}

function itemColumns(p: Purchase): Column<Purchase["items"][number]>[] {
  return [
    { header: "الصنف", cell: (i) => itemName(i.product_name, i.variant_label) },
    {
      header: "العدد",
      numeric: true,
      cell: (i) => i.quantity,
      total: p.pieces,
    },
    {
      header: "سعر القطعة",
      numeric: true,
      cell: (i) => formatAmount(Math.round(i.cost_total / i.quantity)),
    },
    {
      header: "الإجمالي",
      numeric: true,
      cell: (i) => formatAmount(i.cost_total),
      total: formatAmount(p.total),
    },
  ];
}

export function PurchaseDetailModal({
  id,
  onClose,
  onDeleted,
}: {
  id: number;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { settings } = useSession();
  const toast = useToast();
  const [purchase] = useResource(useCallback(() => api.getPurchase(id), [id]));
  const [confirming, setConfirming] = useState(false);

  if (!purchase) return null;
  if (confirming) {
    return (
      <ConfirmDialog
        title="حذف فاتورة الشراء"
        message={`ستُخصم كميات الفاتورة #${purchase.id} من المخزون ويُلغى ما دُفع عند استلامها. استخدم هذا فقط إن سُجّلت الفاتورة بالخطأ.`}
        confirmLabel="حذف الفاتورة"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          try {
            await api.deletePurchase(purchase.id);
            toast(`حُذفت فاتورة الشراء #${purchase.id}`);
            onDeleted?.();
          } catch (e) {
            toast(errorMessage(e), "error");
            setConfirming(false);
          }
        }}
      />
    );
  }

  return (
    <Modal
      title={`فاتورة شراء #${purchase.id} · ${purchase.supplier_name}`}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          {onDeleted && (
            <Button tone="danger-ghost" className="me-auto" onClick={() => setConfirming(true)}>
              <Trash2 className="size-4" />
              حذف
            </Button>
          )}
          <ExportButtons
            fileName={`فاتورة-شراء-${purchase.id}`}
            document={() => purchaseDocument(purchase, settings)}
          />
        </>
      }
    >
      <dl className="mb-4 grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <Detail label="التاريخ" value={formatDateTime(purchase.created_at)} />
        <Detail label="رقم فاتورة المورد" value={purchase.invoice_no || "—"} />
        <Detail label="سجّلها" value={purchase.user_name} />
        <Detail label="الإجمالي" value={formatMoney(purchase.total, settings.currency)} />
        <Detail label="دُفع عند الاستلام" value={formatMoney(purchase.paid, settings.currency)} />
        <Detail
          label="أُضيف لحساب المورد"
          value={formatMoney(purchase.total - purchase.paid, settings.currency)}
        />
      </dl>
      {purchase.note && <p className="mb-4 text-sm text-ink-2">{purchase.note}</p>}
      <Panel className="overflow-hidden">
        <DataTable
          columns={itemColumns(purchase)}
          rows={purchase.items}
          rowKey={(i) => itemName(i.product_name, i.variant_label)}
        />
      </Panel>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-dim">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

// ---- Suppliers ----

function SupplierFormModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { settings } = useSession();
  const toast = useToast();
  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [note, setNote] = useState(supplier?.note ?? "");
  const [opening, setOpening] = useState(
    supplier ? formatAmount(supplier.opening_balance).replace(/,/g, "") : "",
  );
  const [active, setActive] = useState(supplier?.active ?? true);

  const save = async () => {
    const openingBalance = parseMoney(opening || "0");
    if (openingBalance === null) return toast("الرصيد السابق غير صحيح", "error");
    const input = {
      name,
      phone,
      note,
      opening_balance: openingBalance,
      active,
    };
    try {
      if (supplier) await api.updateSupplier(supplier.id, input);
      else await api.createSupplier(input);
      toast(supplier ? "حُفظت بيانات المورد" : "أُضيف المورد");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Modal
      title={supplier ? `تعديل «${supplier.name}»` : "مورد جديد"}
      onClose={onClose}
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save}>{supplier ? "حفظ" : "إضافة المورد"}</Button>
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
        <Field label="الاسم">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="الهاتف">
            {(id) => <Input id={id} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </Field>
          <Field label={`رصيد سابق (${settings.currency})`} hint="ما كان مستحقاً له قبل استخدام البرنامج.">
            {(id) => (
              <Input
                id={id}
                dir="ltr"
                inputMode="decimal"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                placeholder="0"
              />
            )}
          </Field>
        </div>
        <Field label="ملاحظة">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {supplier && (
          <Toggle
            checked={active}
            onChange={setActive}
            label="المورد نشط"
            description="المورد الموقوف لا يظهر عند تسجيل فاتورة شراء جديدة."
          />
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function PaymentModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { settings } = useSession();
  const toast = useToast();
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const amount = parseMoney(amountText);

  const save = async () => {
    if (!amount) return toast("أدخل المبلغ المدفوع", "error");
    try {
      await api.addSupplierPayment(supplier.id, amount, note);
      toast(`سُجّلت دفعة ${formatMoney(amount, settings.currency)} لـ«${supplier.name}»`);
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const after = supplier.balance - (amount ?? 0);
  return (
    <Modal
      title={`دفعة للمورد · ${supplier.name}`}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save}>تسجيل الدفعة</Button>
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
        <Screen
          label="المستحق له حالياً"
          value={formatAmount(supplier.balance)}
          unit={settings.currency}
          size="md"
        />
        <Field
          label={`المبلغ المدفوع (${settings.currency})`}
          hint={amount ? `يصبح المستحق بعدها ${formatMoney(after, settings.currency)}` : undefined}
        >
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                dir="ltr"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
              {supplier.balance > 0 && (
                <Button
                  tone="outline"
                  onClick={() => setAmountText(formatAmount(supplier.balance).replace(/,/g, ""))}
                >
                  كامل المستحق
                </Button>
              )}
            </div>
          )}
        </Field>
        <Field label="ملاحظة">
          {(id) => (
            <Input
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: تحويل بنكي"
            />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

interface LedgerRow extends StatementRow {
  balance: number;
}

/** A supplier's account: every invoice and payment with the running balance. */
function StatementModal({
  supplier,
  onClose,
  onChanged,
}: {
  supplier: Supplier;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { settings } = useSession();
  const toast = useToast();
  const [data, reload] = useResource(useCallback(() => api.supplierStatement(supplier.id), [supplier.id]));
  const [openPurchase, setOpenPurchase] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<StatementRow | null>(null);

  const rows = useMemo(
    () =>
      (data ?? []).reduce<LedgerRow[]>((out, r) => {
        const before = out.length ? out[out.length - 1].balance : supplier.opening_balance;
        out.push({ ...r, balance: before + (r.kind === "purchase" ? r.amount : -r.amount) });
        return out;
      }, []),
    [data, supplier.opening_balance],
  );
  const purchased = rows.filter((r) => r.kind === "purchase").reduce((s, r) => s + r.amount, 0);
  const paid = rows.filter((r) => r.kind === "payment").reduce((s, r) => s + r.amount, 0);
  const balance = supplier.opening_balance + purchased - paid;

  const describe = (r: StatementRow) =>
    r.kind === "purchase"
      ? `فاتورة شراء #${r.id}${r.reference ? ` (فاتورة المورد ${r.reference})` : ""}`
      : r.purchase_id
        ? `دفعة عند استلام الفاتورة #${r.purchase_id}`
        : `دفعة${r.reference ? ` · ${r.reference}` : ""}`;

  const columns = (screen: boolean): Column<LedgerRow>[] => [
    { header: "التاريخ", cell: (r) => formatDateTime(r.created_at) },
    {
      header: "البيان",
      cell: (r) =>
        screen && r.kind === "purchase" ? (
          <button
            type="button"
            className="text-chart underline-offset-2 hover:underline"
            onClick={() => setOpenPurchase(r.id)}
          >
            {describe(r)}
          </button>
        ) : (
          describe(r)
        ),
    },
    {
      header: "مشتريات",
      numeric: true,
      cell: (r) => (r.kind === "purchase" ? formatAmount(r.amount) : ""),
      total: formatAmount(purchased),
    },
    {
      header: "مدفوع",
      numeric: true,
      cell: (r) => (r.kind === "payment" ? formatAmount(r.amount) : ""),
      total: formatAmount(paid),
    },
    {
      header: "الرصيد",
      numeric: true,
      cell: (r) => formatAmount(r.balance),
      total: formatAmount(balance),
    },
    ...(screen
      ? [
          {
            header: "",
            cell: (r: LedgerRow) =>
              r.kind === "payment" &&
              !r.purchase_id && (
                <Button
                  tone="danger-ghost"
                  size="icon"
                  onClick={() => setDeleting(r)}
                  aria-label="حذف الدفعة"
                >
                  <Trash2 className="size-4" />
                </Button>
              ),
          },
        ]
      : []),
  ];

  if (openPurchase !== null)
    return <PurchaseDetailModal id={openPurchase} onClose={() => setOpenPurchase(null)} />;
  if (deleting) {
    return (
      <ConfirmDialog
        title="حذف الدفعة"
        message={`هل تريد حذف دفعة ${formatMoney(deleting.amount, settings.currency)}؟ سيعود المبلغ إلى المستحق للمورد.`}
        confirmLabel="حذف الدفعة"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          setDeleting(null);
          try {
            await api.deleteSupplierPayment(deleting.id);
            toast("حُذفت الدفعة");
            reload();
            onChanged();
          } catch (e) {
            toast(errorMessage(e), "error");
          }
        }}
      />
    );
  }

  const figures = [
    {
      label: "رصيد سابق",
      value: formatMoney(supplier.opening_balance, settings.currency),
    },
    {
      label: "إجمالي المشتريات",
      value: formatMoney(purchased, settings.currency),
    },
    { label: "إجمالي المدفوع", value: formatMoney(paid, settings.currency) },
    { label: "المستحق حالياً", value: formatMoney(balance, settings.currency) },
  ];

  return (
    <Modal
      title={`كشف حساب · ${supplier.name}`}
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <ExportButtons
          fileName={`كشف-حساب-${supplier.name}-${isoDate(new Date())}`}
          document={() => (
            <ReportDocument
              settings={settings}
              title={`كشف حساب المورد · ${supplier.name}`}
              figures={figures}
              sections={[section({ columns: columns(false), rows })]}
            />
          )}
        />
      }
    >
      <div className="mb-4 grid grid-cols-4 divide-x divide-x-reverse divide-line rounded-xl border border-line bg-white">
        {figures.map((f, i) => (
          <div key={f.label} className="px-4 py-3">
            <div className="text-sm text-dim">{f.label}</div>
            <div
              className={
                i === 3 && balance > 0
                  ? "mt-0.5 text-lg font-semibold text-alert"
                  : "mt-0.5 text-lg font-semibold"
              }
            >
              {f.value}
            </div>
          </div>
        ))}
      </div>
      <Panel className="overflow-hidden">
        {rows.length === 0 ? (
          <Empty title="لا توجد فواتير أو دفعات لهذا المورد بعد" />
        ) : (
          <DataTable columns={columns(true)} rows={rows} rowKey={(r) => `${r.kind}-${r.id}`} />
        )}
      </Panel>
    </Modal>
  );
}
