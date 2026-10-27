import { Banknote, CreditCard, Receipt as ReceiptIcon, Search, Smartphone, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExportButtons } from "../components/ExportButtons";
import { Receipt } from "../components/Receipt";
import { ReportDocument } from "../components/ReportDocument";
import { cx } from "../lib/cx";
import { section } from "../lib/document";
import { useResource } from "../lib/useResource";
import { Button, Empty, Keypad, Modal, Screen, Segmented } from "../components/ui";
import { api } from "../lib/api";
import {
  formatAmount,
  formatDateTime,
  formatMoney,
  formatPhones,
  isoDate,
  parseMoney,
  paymentLabels,
  paymentNames,
  phoneDetails,
} from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import type { PaymentMethod, Phone, Product, Sale, SaleSummary } from "../lib/types";

interface CartLine {
  product: Product;
  phone: Phone;
}

const paymentIcons = { cash: Banknote, card: CreditCard, wallet: Smartphone };
const methods = Object.keys(paymentLabels) as PaymentMethod[];

/** The brand is the first word of a model's name: "Samsung Galaxy S24" → "Samsung". */
const brandOf = (p: Product) => p.name.trim().split(/\s+/)[0];

export function PosPage() {
  const { settings } = useSession();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [picking, setPicking] = useState<Product | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [showToday, setShowToday] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const [data, load] = useResource(useCallback(() => api.listProducts(), []));
  const products = useMemo(() => data ?? [], [data]);

  // Phones already in the cart are no longer offered.
  const inCart = useMemo(() => new Set(cart.map((l) => l.phone.id)), [cart]);
  const available = useCallback((p: Product) => p.phones.filter((x) => !inCart.has(x.id)), [inCart]);

  const brands = useMemo(() => [...new Set(products.map(brandOf))].sort(), [products]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter(
        (p) =>
          (brand === null || brandOf(p) === brand) &&
          (!q ||
            p.name.toLowerCase().includes(q) ||
            p.phones.some((x) => [x.serial, x.storage, x.color].some((s) => s.toLowerCase().includes(q)))),
      )
      .sort((a, b) => Number(b.phones.length > 0) - Number(a.phones.length > 0));
  }, [products, query, brand]);

  const total = cart.reduce((sum, l) => sum + l.phone.price, 0);

  const add = (product: Product, phone: Phone) => {
    if (!inCart.has(phone.id)) setCart((c) => [...c, { product, phone }]);
    setPicking(null);
    searchRef.current?.focus();
  };

  /** Enter in the search box: a scanned serial goes straight to the cart, a single model opens its phones. */
  const searchEnter = () => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    for (const p of products) {
      const phone = p.phones.find((x) => x.serial.toLowerCase() === q);
      if (phone) {
        if (inCart.has(phone.id)) toast("هذا الجهاز في الفاتورة بالفعل", "error");
        else add(p, phone);
        setQuery("");
        return;
      }
    }
    if (visible.length === 1 && available(visible[0]).length) setPicking(visible[0]);
  };

  const finishSale = (sale: Sale) => {
    setCheckingOut(false);
    setCart([]);
    setLastSale(sale);
    load();
  };

  return (
    <div className="flex h-full">
      {/* Catalogue */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-3 border-b border-line bg-white px-6 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
              <input
                ref={searchRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), searchEnter())}
                placeholder="امسح الرقم التسلسلي أو ابحث بالموديل أو السعة أو اللون"
                className="h-12 w-full rounded-xl border border-line bg-page ps-11 pe-4 text-base select-text placeholder:text-muted/70 focus:border-ink-3 focus:bg-white focus:ring-2 focus:ring-ink-3/15 focus:outline-none"
              />
            </div>
            <Button tone="outline" size="md" className="h-12" onClick={() => setShowToday(true)}>
              <ReceiptIcon className="size-5" />
              فواتير اليوم
            </Button>
          </div>
          {brands.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <Chip active={brand === null} onClick={() => setBrand(null)}>
                الكل
              </Chip>
              {brands.map((b) => (
                <Chip key={b} active={brand === b} onClick={() => setBrand(b)}>
                  <span dir="auto">{b}</span>
                </Chip>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {visible.length === 0 ? (
            <Empty title={products.length === 0 ? "لا توجد موديلات بعد" : "لا توجد نتائج"}>
              {products.length === 0
                ? "يضيف المدير الموديلات وأجهزتها من صفحة المنتجات، ثم تظهر هنا للبيع."
                : "جرّب اسماً آخر أو امسح الرقم التسلسلي مرة أخرى."}
            </Empty>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {visible.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  phones={available(p)}
                  currency={settings.currency}
                  onPick={() => setPicking(p)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Ticket */}
      <aside className="flex w-[380px] shrink-0 flex-col border-s border-line bg-white">
        <header className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold">الفاتورة الحالية</h2>
          {cart.length > 0 && (
            <Button tone="danger-ghost" size="sm" onClick={() => setCart([])}>
              <Trash2 className="size-4" />
              تفريغ
            </Button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-5">
          {cart.length === 0 ? (
            <p className="py-16 text-center text-sm leading-7 text-muted">
              امسح الرقم التسلسلي للجهاز
              <br />
              أو اختر الموديل من القائمة.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {cart.map((l) => (
                <li key={l.phone.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    {/* dir="auto" keeps English model names cut at their end, not their start. */}
                    <div dir="auto" className="truncate text-right font-medium">
                      {l.product.name}
                    </div>
                    <div className="truncate text-sm text-muted">{phoneDetails(l.phone) || "—"}</div>
                    <div dir="ltr" className="truncate text-right text-xs text-muted">
                      {l.phone.serial}
                    </div>
                  </div>
                  <div className="w-24 text-end font-semibold">{formatAmount(l.phone.price)}</div>
                  <Button
                    tone="danger-ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => setCart((c) => c.filter((x) => x !== l))}
                    aria-label="حذف من الفاتورة"
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex flex-col gap-3 border-t border-line p-5">
          <Screen
            label={`الإجمالي · ${formatPhones(cart.length)}`}
            value={formatAmount(total)}
            unit={settings.currency}
            size="xl"
          />
          <Segmented
            value={payment}
            onChange={setPayment}
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
          <Button
            tone="pay"
            size="lg"
            className="w-full justify-center text-xl"
            disabled={cart.length === 0}
            onClick={() => setCheckingOut(true)}
          >
            دفع {cart.length > 0 && formatMoney(total, settings.currency)}
          </Button>
        </footer>
      </aside>

      {picking && (
        <PickPhoneModal
          product={picking}
          phones={available(picking)}
          currency={settings.currency}
          onAdd={(phone) => add(picking, phone)}
          onClose={() => setPicking(null)}
        />
      )}
      {checkingOut && (
        <CheckoutModal
          cart={cart}
          total={total}
          payment={payment}
          onDone={finishSale}
          onClose={() => setCheckingOut(false)}
        />
      )}
      {lastSale && (
        <ReceiptModal
          sale={lastSale}
          autoPrompt
          onClose={() => (setLastSale(null), searchRef.current?.focus())}
        />
      )}
      {showToday && <TodaySalesModal onClose={() => setShowToday(false)} />}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "h-10 rounded-full border px-4 font-medium transition-colors",
        active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:border-ink-3/40",
      )}
    >
      {children}
    </button>
  );
}

/** Stock as signal bars: full when well stocked, one bar when it is the last phone, none when out. */
function StockBars({ level }: { level: 0 | 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-end gap-[2px]" aria-hidden>
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={cx(
            "w-[3px] rounded-[1px]",
            ["h-1.5", "h-2.5", "h-3.5"][bar - 1],
            bar <= level ? (level === 1 ? "bg-danger" : "bg-ink-2") : "bg-line",
          )}
        />
      ))}
    </span>
  );
}

/** A model on the display shelf: its name, the storages on hand, a starting price and how many are left. */
function ProductCard({
  product: p,
  phones,
  currency,
  onPick,
}: {
  product: Product;
  /** Its phones in stock that are not already in the cart. */
  phones: Phone[];
  currency: string;
  onPick: () => void;
}) {
  const left = phones.length;
  const storages = [...new Set(phones.map((x) => x.storage).filter(Boolean))];
  const prices = phones.map((x) => x.price);

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={left === 0}
      className="group flex min-h-40 flex-col rounded-2xl border border-line bg-white p-4 text-start transition-colors hover:border-ink-3/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-3 disabled:opacity-50"
    >
      <div dir="auto" className="text-lg leading-7 font-semibold">
        {p.name}
      </div>
      {storages.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {storages.slice(0, 3).map((s) => (
            <span
              key={s}
              className="rounded-md border border-line px-1.5 py-0.5 text-[11px] leading-4 text-ink-2"
            >
              {s}
            </span>
          ))}
          {storages.length > 3 && (
            <span className="rounded-md bg-page px-1.5 py-0.5 text-[11px] leading-4 text-ink-2">
              +{storages.length - 3}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-end justify-between gap-2 pt-4">
        <div
          className={cx(
            "flex items-center gap-1.5 text-xs",
            left <= 1 ? "font-medium text-danger" : "text-muted",
          )}
        >
          <StockBars level={left === 0 ? 0 : left === 1 ? 1 : left > 4 ? 3 : 2} />
          {left === 0 ? "نفد المخزون" : formatPhones(left)}
        </div>
        {left > 0 && (
          <div className="text-end leading-tight">
            {new Set(prices).size > 1 && <span className="block text-[11px] text-muted">يبدأ من</span>}
            <span className="font-display text-xl font-normal">{formatAmount(Math.min(...prices))}</span>
            <span className="ms-1 text-[11px] text-muted">{currency}</span>
          </div>
        )}
      </div>
    </button>
  );
}

/** The phones of one model on hand: tapping one adds it to the ticket. */
function PickPhoneModal({
  product,
  phones,
  currency,
  onAdd,
  onClose,
}: {
  product: Product;
  phones: Phone[];
  currency: string;
  onAdd: (phone: Phone) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={product.name} onClose={onClose} width="max-w-3xl">
      <p className="mb-3 text-sm text-muted">اختر الجهاز الذي يأخذه العميل، وطابق رقمه التسلسلي مع العلبة.</p>
      <div className="grid grid-cols-3 gap-3">
        {phones.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => onAdd(x)}
            className="flex flex-col items-start gap-1 rounded-xl border-2 border-transparent bg-white p-3 text-start transition-colors hover:border-ink focus-visible:border-ink focus-visible:outline-none"
          >
            <span className="font-semibold">{[x.storage, x.color].filter(Boolean).join(" · ") || "—"}</span>
            {x.battery !== null && (
              <span className={cx("text-xs", x.battery < 80 ? "text-danger" : "text-muted")}>
                البطارية {x.battery}%
              </span>
            )}
            <span dir="ltr" className="text-xs text-muted">
              {x.serial}
            </span>
            <span className="mt-1 font-display text-lg">
              {formatAmount(x.price)} <span className="font-sans text-[11px] text-muted">{currency}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Takes the money, with one method or several. Each method is a row; the keypad types into the
 * selected one. The method chosen on the ticket covers whatever the others leave until the cashier
 * types into it, so with cash chosen, "15,000 by card and the rest cash" is: tap card, type 15000,
 * confirm. Only cash can be over the total, since change is given in cash.
 */
function CheckoutModal({
  cart,
  total,
  payment,
  onDone,
  onClose,
}: {
  cart: CartLine[];
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
        cart.map((l) => l.phone.id),
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
          <Screen
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

function TodaySalesModal({ onClose }: { onClose: () => void }) {
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
          <Screen
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
