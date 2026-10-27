import { shop } from "@shop";
import type { Cart } from "@shop/types";
import { Banknote, CreditCard, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ExtraLine } from "../lib/extras";
import { cx } from "../lib/cx";
import { section } from "../lib/document";
import {
  formatAmount,
  formatDateTime,
  formatMoney,
  isoDate,
  parseMoney,
  paymentLabels,
  paymentNames,
} from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import type { PaymentMethod, Sale, SaleSummary } from "../lib/types";
import { ExportButtons } from "./ExportButtons";
import { Receipt } from "./Receipt";
import { ReportDocument } from "./ReportDocument";
import { Button, Empty, Keypad, Modal, Segmented } from "./ui";

// Taking the money and showing receipts, the same in every shop. The shop's till builds the cart.

const paymentIcons = { cash: Banknote, card: CreditCard, wallet: Smartphone };
const methods = Object.keys(paymentLabels) as PaymentMethod[];

/** The payment method picked on the ticket, before checkout. */
export function PaymentPicker({
  value,
  onChange,
}: {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
}) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={methods.map((m) => {
        const Icon = paymentIcons[m];
        return {
          value: m,
          label: (
            <>
              <Icon className="size-4" />
              {m === "wallet" ? "محفظة" : paymentLabels[m]}
            </>
          ),
        };
      })}
    />
  );
}

/**
 * Takes the money, with one method or several. Each method is a row; the keypad types into the
 * selected one. The method chosen on the ticket covers whatever the others leave until the cashier
 * types into it, so with cash chosen, "15,000 by card and the rest cash" is: tap card, type 15000,
 * confirm. Only cash can be over the total, since change is given in cash.
 */
export function CheckoutModal({
  items,
  extras,
  total,
  payment,
  onDone,
  onClose,
}: {
  /** The shop's cart, sent as-is; the backend prices it again. */
  items: Cart;
  /** Add-ons or accessories on the same sale. */
  extras: ExtraLine[];
  /** Everything on the ticket: the shop's lines and the extras. */
  total: number;
  payment: PaymentMethod;
  onDone: (sale: Sale) => void;
  onClose: () => void;
}) {
  const { settings } = useSession();
  const toast = useToast();
  const [texts, setTexts] = useState<Record<PaymentMethod, string>>({ cash: "", card: "", wallet: "" });
  // The method that covers the rest; null once the cashier has typed into it.
  const [auto, setAuto] = useState<PaymentMethod | null>(payment);
  const [active, setActive] = useState<PaymentMethod>(payment);
  // A value that was filled in for the cashier is replaced, not appended to, by the next key.
  const [fresh, setFresh] = useState(true);
  const [busy, setBusy] = useState(false);

  const typed = (m: PaymentMethod) => (m === auto ? 0 : (parseMoney(texts[m]) ?? 0));
  const othersTotal = methods.reduce((s, m) => s + typed(m), 0);
  const amountOf = (m: PaymentMethod) => (m === auto ? Math.max(total - othersTotal, 0) : typed(m));
  const shown = (m: PaymentMethod) =>
    m === auto ? (amountOf(m) ? String(amountOf(m) / 100) : "") : texts[m];
  const given = methods.reduce((s, m) => s + amountOf(m), 0);
  const nonCash = amountOf("card") + amountOf("wallet");
  const remaining = total - given;
  const tooMuchNonCash = nonCash > total;
  const canConfirm = remaining <= 0 && !tooMuchNonCash && !busy;
  const cashDue = Math.max(total - nonCash, 0);

  const select = (m: PaymentMethod) => {
    setActive(m);
    setFresh(true);
    if (m !== auto && texts[m] === "" && remaining > 0)
      setTexts((t) => ({ ...t, [m]: String(remaining / 100) }));
  };
  const setText = (m: PaymentMethod, text: string) => {
    setTexts((t) => ({ ...t, [m]: text }));
    if (m === auto) setAuto(null);
    setFresh(false);
  };

  // Common notes the customer is likely to hand over for the cash part.
  const suggestions = [
    ...new Set([50, 100, 200, 500, 1000].map((n) => Math.ceil(cashDue / (n * 100)) * n * 100)),
  ]
    .filter((v) => v > cashDue)
    .slice(0, 3);

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      const sale = await api.createSale(
        items,
        extras,
        methods.filter((m) => amountOf(m) > 0).map((m) => ({ method: m, amount: amountOf(m) })),
      );
      onDone(sale);
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  };

  const status = tooMuchNonCash
    ? { label: "البطاقة والمحفظة أكثر من المطلوب", value: nonCash - total, warn: true }
    : remaining > 0
      ? { label: "المتبقي", value: remaining, warn: false }
      : {
          label: remaining < 0 ? "الباقي للعميل" : "تم سداد المبلغ",
          value: Math.abs(remaining),
          warn: false,
        };

  return (
    <Modal
      title="الدفع"
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <span className="me-auto text-sm text-muted">
            {given > 0 &&
              `المدفوع ${formatMoney(given, settings.currency)} من ${formatMoney(total, settings.currency)}`}
          </span>
          <Button tone="outline" onClick={onClose}>
            رجوع
          </Button>
          <Button tone="pay" size="lg" onClick={confirm} disabled={!canConfirm} data-autofocus>
            تأكيد الدفع
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
        className="grid grid-cols-[1.1fr_1fr] gap-6"
      >
        <div className="flex flex-col gap-3">
          <shop.Readout
            label={`${status.label} · المطلوب ${formatAmount(total)}`}
            value={formatAmount(status.value)}
            unit={settings.currency}
            warn={status.warn}
          />
          <div role="radiogroup" aria-label="طرق الدفع" className="flex flex-col gap-2">
            {methods.map((m) => {
              const Icon = paymentIcons[m];
              const selected = active === m;
              const text = shown(m);
              return (
                <div
                  key={m}
                  className={cx(
                    "flex items-center gap-1 rounded-2xl border-2 bg-white pe-1 transition-colors",
                    selected ? "border-ink" : "border-transparent",
                  )}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => select(m)}
                    className="flex h-16 flex-1 items-center gap-3 ps-4 text-start"
                  >
                    <Icon className={cx("size-5", selected ? "text-ink" : "text-muted")} />
                    <span className="font-medium">{paymentLabels[m]}</span>
                    {m === auto && <span className="text-xs text-muted">الباقي تلقائياً</span>}
                    <span
                      dir="ltr"
                      className={cx(
                        "ms-auto font-display text-2xl font-light",
                        text === "" && "text-line",
                        selected && fresh && text !== "" && "rounded bg-ink/[0.07] px-1",
                      )}
                    >
                      {text === "" ? "0" : text}
                      {selected && !fresh && <span className="ms-0.5 animate-pulse text-muted">|</span>}
                    </span>
                  </button>
                  {text !== "" && (
                    <Button
                      tone="ghost"
                      size="icon"
                      onClick={() => (setText(m, ""), setActive(m))}
                      aria-label={`مسح ${paymentLabels[m]}`}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-sm text-muted">
            {active === "cash"
              ? "اكتب المبلغ الذي سلّمه العميل نقداً، ويُحسب الباقي تلقائياً."
              : "تأكد من نجاح العملية على جهاز الدفع قبل التأكيد."}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Keypad value={fresh ? "" : texts[active]} onChange={(v) => setText(active, v)} maxDecimals={2} />
          {active === "cash" && cashDue > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                tone="outline"
                className="justify-center"
                onClick={() => setText("cash", String(cashDue / 100))}
              >
                المبلغ بالضبط
              </Button>
              {suggestions.map((s) => (
                <Button
                  key={s}
                  tone="outline"
                  className="justify-center"
                  onClick={() => setText("cash", String(s / 100))}
                >
                  {s / 100}
                </Button>
              ))}
            </div>
          )}
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function ReceiptModal({
  sale,
  autoPrompt = false,
  onClose,
}: {
  sale: Sale;
  autoPrompt?: boolean;
  onClose: () => void;
}) {
  const { settings } = useSession();
  return (
    <Modal
      title={autoPrompt ? `تم البيع · فاتورة رقم ${sale.id}` : `فاتورة رقم ${sale.id}`}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            {autoPrompt ? "فاتورة جديدة" : "إغلاق"}
          </Button>
          <ExportButtons
            primary
            kind="receipt"
            fileName={`فاتورة-${sale.id}`}
            document={() => <Receipt sale={sale} settings={settings} />}
          />
        </>
      }
    >
      <div className="rounded-lg border border-line shadow-sm">
        <Receipt sale={sale} settings={settings} />
      </div>
    </Modal>
  );
}

export function TodaySalesModal({ onClose }: { onClose: () => void }) {
  const { settings } = useSession();
  const toast = useToast();
  const [sales, setSales] = useState<SaleSummary[] | null>(null);
  const [open, setOpen] = useState<Sale | null>(null);

  const today = isoDate(new Date());

  useEffect(() => {
    // The backend limits cashiers to their own sales today regardless of the range sent.
    api
      .listSales({ from: today, to: today })
      .then(setSales)
      .catch((e) => toast(errorMessage(e), "error"));
  }, [toast, today]);

  if (open) return <ReceiptModal sale={open} onClose={() => setOpen(null)} />;

  const sum = sales?.reduce((s, x) => s + x.total, 0) ?? 0;
  return (
    <Modal
      title="فواتير اليوم"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <ExportButtons
          disabled={!sales?.length}
          fileName={`فواتير-${today}`}
          document={() => (
            <ReportDocument
              settings={settings}
              title="فواتير اليوم"
              from={today}
              to={today}
              figures={[
                { label: "عدد الفواتير", value: sales?.length ?? 0 },
                { label: "الإجمالي", value: formatMoney(sum, settings.currency) },
              ]}
              sections={[
                section<SaleSummary>({
                  columns: [
                    { header: "رقم الفاتورة", cell: (s) => s.id },
                    { header: "الوقت", cell: (s) => formatDateTime(s.created_at).split(" ")[1] },
                    { header: "الكاشير", cell: (s) => s.cashier_name },
                    { header: "الدفع", cell: (s) => paymentNames(s.methods) },
                    { header: "الإجمالي", numeric: true, cell: (s) => formatAmount(s.total) },
                  ],
                  rows: sales ?? [],
                }),
              ]}
            />
          )}
        />
      }
    >
      {!sales ? null : sales.length === 0 ? (
        <Empty title="لا توجد فواتير اليوم بعد" />
      ) : (
        <>
          <shop.Readout
            className="mb-4"
            size="md"
            label={`${sales.length} فاتورة`}
            value={formatAmount(sum)}
            unit={settings.currency}
          />
          <ul className="divide-y divide-line rounded-xl border border-line bg-white">
            {sales.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => api.getSale(s.id).then(setOpen, (e) => toast(errorMessage(e), "error"))}
                  className="flex w-full items-center gap-4 px-4 py-3 text-start hover:bg-surface"
                >
                  <span className="w-16 font-medium">#{s.id}</span>
                  <span className="text-sm text-muted" dir="ltr">
                    {formatDateTime(s.created_at).split(" ")[1]}
                  </span>
                  <span className="text-sm text-muted">{paymentNames(s.methods)}</span>
                  <span className="text-sm text-muted">{s.cashier_name}</span>
                  <span className="ms-auto font-semibold">{formatAmount(s.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
