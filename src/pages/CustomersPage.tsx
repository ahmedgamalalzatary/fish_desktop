import { shop } from "@shop";
import { HandCoins, Receipt as ReceiptIcon, Search } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import { ReceiptModal } from "../components/Checkout";
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Panel, Segmented } from "../components/ui";
import { api } from "../lib/api";
import { cx } from "../lib/cx";
import { formatAmount, formatDateTime, formatMoney, parseMoney, paymentLabels } from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import type { CustomerRow, PaymentMethod, Sale } from "../lib/types";
import { useResource } from "../lib/useResource";

// Customers who bought on credit (shops with `creditSales`): what each owes, on which invoices, and
// taking their later payments. Open to cashiers too, since payments are taken at the till.

const methods = Object.keys(paymentLabels) as PaymentMethod[];

export function CustomersPage() {
  const { settings } = useSession();
  const [customers, reloadCustomers] = useResource(useCallback(() => api.listCustomers(), []));
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"owing" | "all">("owing");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const term = search.trim().toLowerCase();
  const rows = (customers ?? []).filter(
    (c) =>
      (show === "all" || c.owed > 0) &&
      (!term || c.name.toLowerCase().includes(term) || c.phone.includes(term.replace(/\D/g, "") || term)),
  );
  const owedTotal = (customers ?? []).reduce((s, c) => s + c.owed, 0);
  const selected = customers?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="p-8">
      <PageHeader
        title="العملاء"
        actions={
          <span className="text-sm text-muted">
            المستحق على العملاء{" "}
            <span className="font-semibold text-ink">{formatMoney(owedTotal, settings.currency)}</span>
          </span>
        }
      />
      <div className="grid grid-cols-[360px_1fr] items-start gap-6">
        <Panel className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث بالاسم أو الهاتف"
                className="ps-9"
              />
            </div>
            <Segmented
              value={show}
              onChange={setShow}
              options={[
                { value: "owing", label: "عليهم مبالغ" },
                { value: "all", label: "كل العملاء" },
              ]}
            />
          </div>
          {!customers ? null : rows.length === 0 ? (
            <Empty title={customers.length ? "لا يوجد عملاء هنا" : "لا يوجد بيع آجل بعد"}>
              {!customers.length && "عند البيع الآجل من شاشة البيع يظهر العميل هنا بما عليه."}
            </Empty>
          ) : (
            <ul className="max-h-[calc(100vh-260px)] divide-y divide-line overflow-y-auto">
              {rows.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={cx(
                      "flex w-full items-center gap-3 px-4 py-3 text-start transition-colors",
                      c.id === selectedId ? "bg-ink/[0.06]" : "hover:bg-surface",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block text-xs text-muted" dir="ltr">
                        {c.phone}
                      </span>
                    </span>
                    {c.owed > 0 ? (
                      <span className="font-semibold">{formatAmount(c.owed)}</span>
                    ) : (
                      <Badge tone="success">مسدد</Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {selected ? (
          <CustomerDetail key={selected.id} customer={selected} onChange={reloadCustomers} />
        ) : (
          <Panel>
            <Empty title="اختر عميلاً">لترى فواتيره الآجلة وما دفعه وما تبقى عليه، وتسجّل دفعة جديدة.</Empty>
          </Panel>
        )}
      </div>
    </div>
  );
}

function CustomerDetail({ customer, onChange }: { customer: CustomerRow; onChange: () => void }) {
  const { settings } = useSession();
  const [sales, reload] = useResource(useCallback(() => api.customerSales(customer.id), [customer.id]));
  const [paying, setPaying] = useState<Sale | null>(null);
  const [receipt, setReceipt] = useState<{ sale: Sale; justPaid: boolean } | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-wrap items-center gap-6 p-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{customer.name}</h2>
          <div className="text-sm text-muted" dir="ltr">
            {customer.phone}
          </div>
          <div className="mt-2 text-sm text-muted">
            {customer.sales_count} فاتورة آجلة بـ {formatMoney(customer.total, settings.currency)} · دفع{" "}
            {formatMoney(customer.paid, settings.currency)}
          </div>
        </div>
        <shop.Readout
          size="md"
          label={customer.owed > 0 ? "المتبقي عليه" : "لا شيء عليه"}
          value={formatAmount(customer.owed)}
          unit={settings.currency}
        />
      </Panel>

      {sales?.map((sale) => (
        <CreditSaleCard
          key={sale.id}
          sale={sale}
          onPay={() => setPaying(sale)}
          onReceipt={() => setReceipt({ sale, justPaid: false })}
        />
      ))}

      {paying && (
        <CreditPaymentModal
          sale={paying}
          onClose={() => setPaying(null)}
          onDone={(sale) => {
            setPaying(null);
            setReceipt({ sale, justPaid: true });
            reload();
            onChange();
          }}
        />
      )}
      {receipt && (
        <ReceiptModal
          sale={receipt.sale}
          title={receipt.justPaid ? `سُجّلت الدفعة · فاتورة رقم ${receipt.sale.id}` : undefined}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}

function CreditSaleCard({ sale, onPay, onReceipt }: { sale: Sale; onPay: () => void; onReceipt: () => void }) {
  const credit = sale.credit!;
  const paidAtSale = sale.payments.reduce((s, p) => s + p.amount, 0);
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <span className="font-semibold">فاتورة #{sale.id}</span>
        <span className="text-sm text-muted" dir="ltr">
          {formatDateTime(sale.created_at)}
        </span>
        <span className="text-sm text-muted">بواسطة {sale.cashier_name}</span>
        <span className="ms-auto">
          {credit.remaining > 0 ? (
            <Badge tone="danger">متبقي {formatAmount(credit.remaining)}</Badge>
          ) : (
            <Badge tone="success">مسددة</Badge>
          )}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-6 px-5 py-4">
        <div className="text-sm">
          <shop.ReceiptItems items={sale.items} />
          {sale.extras.map((x, i) => (
            <div key={i} className="flex justify-between py-1">
              <span>
                {x.name} × {x.quantity}
              </span>
              <span className="font-semibold">{formatAmount(x.line_total)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-line pt-1">
            <span>الإجمالي{sale.discount > 0 && ` (بعد خصم ${formatAmount(sale.discount)})`}</span>
            <span className="font-semibold">{formatAmount(sale.total)}</span>
          </div>
        </div>
        <ol className="flex flex-col gap-2 text-sm">
          <PaymentLine
            title="عند البيع"
            when={sale.created_at}
            who={sale.cashier_name}
            parts={sale.payments.map((p) => paymentLabels[p.method])}
            amount={paidAtSale}
          />
          {credit.later.map((p) => (
            <PaymentLine
              key={p.id}
              title="دفعة"
              when={p.created_at}
              who={p.user_name}
              parts={p.payments.map((m) => `${paymentLabels[m.method]} ${formatAmount(m.amount)}`)}
              amount={p.paid - p.change_due}
            />
          ))}
          <li className="flex justify-between border-t border-line pt-2 font-semibold">
            <span>المتبقي</span>
            <span>{formatAmount(credit.remaining)}</span>
          </li>
        </ol>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button tone="outline" onClick={onReceipt}>
          <ReceiptIcon className="size-4" />
          الفاتورة
        </Button>
        {credit.remaining > 0 && (
          <Button onClick={onPay}>
            <HandCoins className="size-4" />
            تسجيل دفعة
          </Button>
        )}
      </div>
    </Panel>
  );
}

function PaymentLine({
  title,
  when,
  who,
  parts,
  amount,
}: {
  title: string;
  when: string;
  who: string;
  parts: string[];
  amount: number;
}) {
  return (
    <li className="flex items-start justify-between gap-3">
      <span>
        <span className="font-medium">{title}</span>{" "}
        <span className="text-muted" dir="ltr">
          {formatDateTime(when)}
        </span>
        <span className="block text-xs text-muted">
          {parts.length ? parts.join(" + ") : "لم يدفع شيئاً"} · {who}
        </span>
      </span>
      <span className="font-semibold">{formatAmount(amount)}</span>
    </li>
  );
}

/** A later payment on one invoice, with one method or several. Only cash can be over what is left. */
function CreditPaymentModal({
  sale,
  onClose,
  onDone,
}: {
  sale: Sale;
  onClose: () => void;
  onDone: (sale: Sale) => void;
}) {
  const { settings } = useSession();
  const toast = useToast();
  const left = sale.credit!.remaining;
  const [texts, setTexts] = useState<Record<PaymentMethod, string>>({ cash: "", card: "", wallet: "" });
  const [busy, setBusy] = useState(false);

  const amountOf = (m: PaymentMethod) => parseMoney(texts[m]) ?? 0;
  const bad = methods.some((m) => texts[m].trim() !== "" && parseMoney(texts[m]) === null);
  const given = methods.reduce((s, m) => s + amountOf(m), 0);
  const nonCash = amountOf("card") + amountOf("wallet");
  const tooMuchNonCash = nonCash > left;
  const canPay = given > 0 && !bad && !tooMuchNonCash && !busy;

  const status = tooMuchNonCash
    ? { label: "البطاقة والمحفظة أكثر من المتبقي", value: nonCash - left, warn: true }
    : given > left
      ? { label: "الباقي للعميل", value: given - left, warn: false }
      : given === left
        ? { label: "تُسدَّد الفاتورة بالكامل", value: 0, warn: false }
        : { label: "يتبقى بعد الدفعة", value: left - given, warn: false };

  const pay = async (e: FormEvent) => {
    e.preventDefault();
    if (!canPay) return;
    setBusy(true);
    try {
      onDone(
        await api.addCreditPayment(
          sale.id,
          methods.filter((m) => amountOf(m) > 0).map((m) => ({ method: m, amount: amountOf(m) })),
        ),
      );
    } catch (err) {
      toast(errorMessage(err), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`دفعة على فاتورة #${sale.id} · ${sale.credit!.customer_name}`}
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            رجوع
          </Button>
          <Button tone="pay" size="lg" onClick={pay} disabled={!canPay}>
            تسجيل الدفعة
          </Button>
        </>
      }
    >
      <form onSubmit={pay} className="flex flex-col gap-4">
        <shop.Readout
          size="md"
          label={`${status.label} · المتبقي ${formatAmount(left)}`}
          value={formatAmount(status.value)}
          unit={settings.currency}
          warn={status.warn}
        />
        <div className="grid grid-cols-3 gap-3">
          {methods.map((m) => (
            <Field key={m} label={paymentLabels[m]}>
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={texts[m]}
                  onChange={(e) => setTexts((t) => ({ ...t, [m]: e.target.value }))}
                  className="h-11 text-lg"
                />
              )}
            </Field>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            tone="outline"
            onClick={() => setTexts({ cash: String(left / 100), card: "", wallet: "" })}
          >
            المتبقي كله نقداً
          </Button>
        </div>
        <p className="text-sm text-muted">
          يمكن الدفع بأكثر من طريقة في نفس الدفعة. النقدي فقط يمكن أن يزيد عن المتبقي، ويُرد الفرق للعميل.
        </p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
