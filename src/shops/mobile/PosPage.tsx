import { Receipt as ReceiptIcon, Search, Trash2, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { CheckoutModal, PaymentPicker, ReceiptModal, TodaySalesModal } from "../../components/Checkout";
import { Button, Empty, Modal } from "../../components/ui";
import { cx } from "../../lib/cx";
import { formatAmount, formatMoney } from "../../lib/format";
import { useSession } from "../../lib/session";
import { useToast } from "../../lib/toast";
import type { PaymentMethod, Sale } from "../../lib/types";
import { useResource } from "../../lib/useResource";
import { api } from "./api";
import { formatPhones, phoneDetails } from "./format";
import { Readout } from "./Readout";
import type { Phone, Product } from "./types";

interface CartLine {
  product: Product;
  phone: Phone;
}

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
          <Readout
            label={`الإجمالي · ${formatPhones(cart.length)}`}
            value={formatAmount(total)}
            unit={settings.currency}
            size="xl"
          />
          <PaymentPicker value={payment} onChange={setPayment} />
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
          items={cart.map((l) => l.phone.id)}
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
