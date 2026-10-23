import {
  Banknote,
  CreditCard,
  Minus,
  Plus,
  Receipt as ReceiptIcon,
  Search,
  Smartphone,
  Trash2,
} from "lucide-react";
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
  formatPieces,
  isoDate,
  parseMoney,
  paymentLabels,
} from "../lib/format";
import { useSession } from "../lib/session";
import { errorMessage, useToast } from "../lib/toast";
import type { PaymentMethod, Product, Sale, SaleSummary, Variant } from "../lib/types";

interface CartLine {
  product: Product;
  variant: Variant;
  quantity: number;
}

const lineTotal = (l: CartLine) => l.variant.price * l.quantity;

const paymentIcons = { cash: Banknote, card: CreditCard, wallet: Smartphone };

/** A product sold without options has one variant with no label. */
const hasOptions = (p: Product) => p.variants.length > 1 || p.variants[0]?.label !== "";

export function PosPage() {
  const { settings } = useSession();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [topCategory, setTopCategory] = useState<number | null>(null);
  const [subCategory, setSubCategory] = useState<number | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [picking, setPicking] = useState<Product | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [showToday, setShowToday] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const [data, load] = useResource(
    useCallback(() => Promise.all([api.listProducts(), api.listCategories()]), []),
  );
  const [products, categories] = useMemo(() => data ?? [[], []], [data]);

  const allowNegative = settings.allow_negative_stock === "1";
  const topCategories = categories.filter((c) => c.parent_id === null);
  const subCategories = categories.filter((c) => c.parent_id !== null && c.parent_id === topCategory);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !p.variants.some((v) => v.label.toLowerCase().includes(q))
      )
        return false;
      if (subCategory !== null) return p.category_id === subCategory;
      if (topCategory !== null) return p.category_id === topCategory || p.parent_category_id === topCategory;
      return true;
    });
  }, [products, query, topCategory, subCategory]);

  // Pieces already in the cart, so the stock shown stays honest.
  const inCart = useMemo(() => new Map(cart.map((l) => [l.variant.id, l.quantity])), [cart]);
  const available = useCallback((v: Variant) => v.stock - (inCart.get(v.id) ?? 0), [inCart]);

  const total = cart.reduce((sum, l) => sum + lineTotal(l), 0);
  const pieces = cart.reduce((sum, l) => sum + l.quantity, 0);

  const addLine = (product: Product, variant: Variant, quantity: number) => {
    if (!allowNegative && available(variant) < quantity) {
      toast(`لا يوجد مخزون كافٍ من «${product.name}${variant.label ? ` ${variant.label}` : ""}»`, "error");
      return;
    }
    setCart((c) => {
      const existing = c.find((l) => l.variant.id === variant.id);
      if (existing) return c.map((l) => (l === existing ? { ...l, quantity: l.quantity + quantity } : l));
      return [...c, { product, variant, quantity }];
    });
    setPicking(null);
    searchRef.current?.focus();
  };

  const pick = (p: Product) => (hasOptions(p) ? setPicking(p) : addLine(p, p.variants[0], 1));

  const changeQuantity = (line: CartLine, delta: number) => {
    if (delta > 0 && !allowNegative && available(line.variant) < delta) {
      toast("هذا كل المتوفر في المخزون", "error");
      return;
    }
    setCart((c) =>
      c.flatMap((l) =>
        l !== line ? [l] : l.quantity + delta <= 0 ? [] : [{ ...l, quantity: l.quantity + delta }],
      ),
    );
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
              <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-dim" />
              <input
                ref={searchRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث بالموديل أو السعة أو اللون"
                className="h-12 w-full rounded-xl border border-line bg-alu ps-11 pe-4 text-base select-text placeholder:text-dim/70 focus:border-ink-3 focus:bg-white focus:ring-2 focus:ring-ink-3/15 focus:outline-none"
              />
            </div>
            <Button tone="outline" size="md" className="h-12" onClick={() => setShowToday(true)}>
              <ReceiptIcon className="size-5" />
              فواتير اليوم
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip active={topCategory === null} onClick={() => (setTopCategory(null), setSubCategory(null))}>
              الكل
            </Chip>
            {topCategories.map((c) => (
              <Chip
                key={c.id}
                active={topCategory === c.id}
                onClick={() => (setTopCategory(c.id), setSubCategory(null))}
              >
                {c.name}
              </Chip>
            ))}
          </div>
          {subCategories.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-dashed border-line pt-3">
              <Chip small active={subCategory === null} onClick={() => setSubCategory(null)}>
                كل الماركات
              </Chip>
              {subCategories.map((c) => (
                <Chip key={c.id} small active={subCategory === c.id} onClick={() => setSubCategory(c.id)}>
                  {c.name}
                </Chip>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {visible.length === 0 ? (
            <Empty title={products.length === 0 ? "لا توجد منتجات بعد" : "لا توجد نتائج"}>
              {products.length === 0
                ? "يضيف المدير المنتجات من صفحة المنتجات، ثم تظهر هنا للبيع."
                : "جرّب اسماً آخر أو اختر تصنيفاً مختلفاً."}
            </Empty>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {visible.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  available={available}
                  allowNegative={allowNegative}
                  currency={settings.currency}
                  onPick={() => pick(p)}
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
            <p className="py-16 text-center text-sm leading-7 text-dim">
              اختر منتجاً من القائمة
              <br />
              ليُضاف إلى الفاتورة.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {cart.map((l) => (
                <li key={l.variant.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    {/* dir="auto" keeps English model names cut at their end, not their start. */}
                    <div dir="auto" className="truncate text-right font-medium">
                      {l.product.name}
                    </div>
                    <div className="truncate text-sm text-dim">
                      {[l.variant.label, l.quantity > 1 && `${formatAmount(l.variant.price)} للقطعة`]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg bg-alu p-0.5">
                    <Button
                      tone="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => changeQuantity(l, 1)}
                      aria-label="زيادة"
                    >
                      <Plus className="size-4" />
                    </Button>
                    <span className="w-6 text-center font-medium">{l.quantity}</span>
                    <Button
                      tone="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => changeQuantity(l, -1)}
                      aria-label={l.quantity === 1 ? "حذف" : "نقص"}
                    >
                      {l.quantity === 1 ? (
                        <Trash2 className="size-4 text-alert" />
                      ) : (
                        <Minus className="size-4" />
                      )}
                    </Button>
                  </div>
                  <div className="w-24 text-end font-semibold">{formatAmount(lineTotal(l))}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex flex-col gap-3 border-t border-line p-5">
          <Screen
            label={`الإجمالي · ${formatPieces(pieces)}`}
            value={formatAmount(total)}
            unit={settings.currency}
            size="xl"
          />
          <Segmented
            value={payment}
            onChange={setPayment}
            options={(Object.keys(paymentLabels) as PaymentMethod[]).map((m) => {
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
        <PickVariantModal
          product={picking}
          available={available}
          allowNegative={allowNegative}
          currency={settings.currency}
          onAdd={addLine}
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
  small,
  onClick,
  children,
}: {
  active: boolean;
  small?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "rounded-full border font-medium transition-colors",
        small ? "h-8 px-3 text-sm" : "h-10 px-4",
        active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:border-ink-3/40",
      )}
    >
      {children}
    </button>
  );
}

/** Stock as signal bars: full when well stocked, one bar when low, none when out. */
function StockBars({ level }: { level: 0 | 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-end gap-[2px]" aria-hidden>
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={cx(
            "w-[3px] rounded-[1px]",
            ["h-1.5", "h-2.5", "h-3.5"][bar - 1],
            bar <= level ? (level === 1 ? "bg-alert" : "bg-ink-2") : "bg-line",
          )}
        />
      ))}
    </span>
  );
}

/** A model on the display shelf: name, its options, a price and how many are left. */
function ProductCard({
  product: p,
  available,
  allowNegative,
  currency,
  onPick,
}: {
  product: Product;
  available: (v: Variant) => number;
  allowNegative: boolean;
  currency: string;
  onPick: () => void;
}) {
  const left = p.variants.reduce((s, v) => s + Math.max(available(v), 0), 0);
  const out = left <= 0;
  const low = !out && p.variants.every((v) => available(v) <= 0 || available(v) <= v.low_stock);
  const prices = p.variants.map((v) => v.price);
  const fromPrice = Math.min(...prices);
  const options = hasOptions(p) ? p.variants : [];

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={out && !allowNegative}
      className="group flex min-h-40 flex-col rounded-2xl border border-line bg-white p-4 text-start transition-colors hover:border-ink-3/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-3 disabled:opacity-50"
    >
      <div className="text-xs text-dim">{p.category_name}</div>
      <div className="mt-0.5 text-lg leading-7 font-semibold">{p.name}</div>
      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {options.slice(0, 3).map((v) => (
            <span
              key={v.id}
              className={cx(
                "rounded-md border border-line px-1.5 py-0.5 text-[11px] leading-4 text-ink-2",
                available(v) <= 0 && "text-dim line-through",
              )}
            >
              {v.label}
            </span>
          ))}
          {options.length > 3 && (
            <span className="rounded-md bg-alu px-1.5 py-0.5 text-[11px] leading-4 text-ink-2">
              +{options.length - 3}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-end justify-between gap-2 pt-4">
        <div
          className={cx(
            "flex items-center gap-1.5 text-xs",
            out || low ? "font-medium text-alert" : "text-dim",
          )}
        >
          <StockBars level={out ? 0 : low ? 1 : left > 5 ? 3 : 2} />
          {out ? "نفد المخزون" : formatPieces(left)}
        </div>
        <div className="text-end leading-tight">
          {new Set(prices).size > 1 && <span className="block text-[11px] text-dim">يبدأ من</span>}
          <span className="font-display text-xl font-normal">{formatAmount(fromPrice)}</span>
          <span className="ms-1 text-[11px] text-dim">{currency}</span>
        </div>
      </div>
    </button>
  );
}

function PickVariantModal({
  product,
  available,
  allowNegative,
  currency,
  onAdd,
  onClose,
}: {
  product: Product;
  available: (v: Variant) => number;
  allowNegative: boolean;
  currency: string;
  onAdd: (product: Product, variant: Variant, quantity: number) => void;
  onClose: () => void;
}) {
  const [variant, setVariant] = useState<Variant>(
    () => product.variants.find((v) => allowNegative || available(v) > 0) ?? product.variants[0],
  );
  const [quantity, setQuantity] = useState(1);
  const left = available(variant);
  const overStock = !allowNegative && quantity > left;

  const submit = () => !overStock && onAdd(product, variant, quantity);

  return (
    <Modal
      title={product.name}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <span className={cx("me-auto text-sm", overStock ? "font-medium text-alert" : "text-dim")}>
            {overStock ? "الكمية أكبر من المتوفر: " : "المتوفر: "}
            {formatPieces(left)}
          </span>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={overStock}>
            إضافة إلى الفاتورة
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-5"
      >
        <div className="grid grid-cols-3 gap-3">
          {product.variants.map((v) => {
            const n = available(v);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => (setVariant(v), setQuantity(1))}
                disabled={n <= 0 && !allowNegative}
                aria-pressed={variant.id === v.id}
                className={cx(
                  "flex flex-col items-start gap-1 rounded-xl border-2 bg-white p-3 text-start transition-colors disabled:opacity-45",
                  variant.id === v.id ? "border-ink" : "border-transparent hover:border-line",
                )}
              >
                <span className="font-semibold">{v.label}</span>
                <span className="font-display text-lg">{formatAmount(v.price)}</span>
                <span className={cx("text-xs", n <= 0 ? "text-alert" : "text-dim")}>
                  {n <= 0 ? "نفد" : `متوفر ${formatPieces(n)}`}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-ink-2">العدد</span>
          <div className="flex items-center gap-2 rounded-xl bg-white p-1">
            <Button
              tone="ghost"
              size="icon"
              className="size-11"
              onClick={() => setQuantity((q) => q + 1)}
              aria-label="زيادة"
            >
              <Plus className="size-5" />
            </Button>
            <span className="w-10 text-center font-display text-2xl font-light">{quantity}</span>
            <Button
              tone="ghost"
              size="icon"
              className="size-11"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="نقص"
            >
              <Minus className="size-5" />
            </Button>
          </div>
          <Screen
            className="flex-1"
            size="md"
            label="السعر"
            value={formatAmount(variant.price * quantity)}
            unit={currency}
          />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

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
  const [paidText, setPaidText] = useState("");
  const [busy, setBusy] = useState(false);
  const cash = payment === "cash";
  const paid = cash ? (paidText === "" ? total : (parseMoney(paidText) ?? 0)) : total;
  const change = paid - total;

  // Common notes the customer is likely to hand over.
  const suggestions = [
    ...new Set([50, 100, 200, 500, 1000].map((n) => Math.ceil(total / (n * 100)) * n * 100)),
  ]
    .filter((v) => v > total)
    .slice(0, 3);

  const confirm = async () => {
    if (change < 0 || busy) return;
    setBusy(true);
    try {
      const sale = await api.createSale(
        cart.map((l) => ({ variant_id: l.variant.id, quantity: l.quantity })),
        payment,
        paid,
      );
      onDone(sale);
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`الدفع · ${paymentLabels[payment]}`}
      onClose={onClose}
      width={cash ? "max-w-2xl" : "max-w-md"}
      footer={
        <>
          <Button tone="outline" onClick={onClose}>
            رجوع
          </Button>
          <Button tone="pay" size="lg" onClick={confirm} disabled={change < 0 || busy} data-autofocus>
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
        className={cx("grid gap-5", cash && "grid-cols-2")}
      >
        <div className="flex flex-col gap-3">
          <Screen label="المطلوب" value={formatAmount(total)} unit={settings.currency} />
          {cash && (
            <>
              <Screen
                label="المدفوع"
                value={paidText === "" ? formatAmount(total) : paidText}
                unit={settings.currency}
                size="md"
              />
              <Screen
                label={change < 0 ? "المبلغ ناقص" : "الباقي للعميل"}
                value={formatAmount(Math.abs(change))}
                unit={settings.currency}
                warn={change < 0}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button tone="outline" className="justify-center" onClick={() => setPaidText("")}>
                  المبلغ بالضبط
                </Button>
                {suggestions.map((s) => (
                  <Button
                    key={s}
                    tone="outline"
                    className="justify-center"
                    onClick={() => setPaidText(String(s / 100))}
                  >
                    {s / 100}
                  </Button>
                ))}
              </div>
            </>
          )}
          {!cash && <p className="text-sm text-dim">تأكد من نجاح العملية على جهاز الدفع قبل التأكيد.</p>}
        </div>
        {cash && <Keypad value={paidText} onChange={setPaidText} maxDecimals={2} />}
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
                    { header: "الدفع", cell: (s) => paymentLabels[s.payment_method] },
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
                  className="flex w-full items-center gap-4 px-4 py-3 text-start hover:bg-glass"
                >
                  <span className="w-16 font-medium">#{s.id}</span>
                  <span className="text-sm text-dim" dir="ltr">
                    {formatDateTime(s.created_at).split(" ")[1]}
                  </span>
                  <span className="text-sm text-dim">{paymentLabels[s.payment_method]}</span>
                  <span className="text-sm text-dim">{s.cashier_name}</span>
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
