import { Minus, Plus, Receipt as ReceiptIcon, Search, Trash2, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { CheckoutModal, PaymentPicker, ReceiptModal, TodaySalesModal } from "../../components/Checkout";
import { Button, Empty, Keypad, Modal, Segmented } from "../../components/ui";
import { cx } from "../../lib/cx";
import { formatAmount, formatMoney } from "../../lib/format";
import { useSession } from "../../lib/session";
import type { PaymentMethod, Sale } from "../../lib/types";
import { useResource } from "../../lib/useResource";
import { api } from "./api";
import { formatWeight, parseKg, priceForGrams } from "./format";
import { Readout } from "./Readout";
import type { Cart, Product, Variant } from "./types";

interface CartLine {
  key: string;
  product: Product;
  variant: Variant | null;
  quantity: number;
  grams: number;
}

/** What the backend is sent: it prices every line again. */
const toCart = (cart: CartLine[]): Cart =>
  cart.map((l) => ({
    product_id: l.product.id,
    variant_id: l.variant?.id ?? null,
    quantity: l.quantity,
    weight_grams: l.variant ? null : l.grams,
  }));

const lineTotal = (l: CartLine) =>
  l.variant ? l.variant.price * l.quantity : priceForGrams(l.product.price_per_kg, l.grams);

export function PosPage() {
  const { settings } = useSession();
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
    const q = query.trim();
    return products.filter((p) => {
      if (q && !p.name.includes(q)) return false;
      if (subCategory !== null) return p.category_id === subCategory;
      if (topCategory !== null) return p.category_id === topCategory || p.parent_category_id === topCategory;
      return true;
    });
  }, [products, query, topCategory, subCategory]);

  // Weight already in the cart per product, so the stock shown on tiles stays honest.
  const reserved = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of cart) {
      const g = l.variant ? l.variant.weight_grams * l.quantity : l.grams;
      m.set(l.product.id, (m.get(l.product.id) ?? 0) + g);
    }
    return m;
  }, [cart]);

  const total = cart.reduce((sum, l) => sum + lineTotal(l), 0);

  const addLine = (product: Product, variant: Variant | null, quantity: number, grams: number) => {
    setCart((c) => {
      if (variant) {
        const key = `${product.id}:${variant.id}`;
        const existing = c.find((l) => l.key === key);
        if (existing) return c.map((l) => (l === existing ? { ...l, quantity: l.quantity + quantity } : l));
        return [...c, { key, product, variant, quantity, grams: 0 }];
      }
      return [...c, { key: `${product.id}:w:${Date.now()}`, product, variant: null, quantity: 1, grams }];
    });
    setPicking(null);
    searchRef.current?.focus();
  };

  const changeQuantity = (key: string, delta: number) =>
    setCart((c) =>
      c.flatMap((l) =>
        l.key !== key ? [l] : l.quantity + delta <= 0 ? [] : [{ ...l, quantity: l.quantity + delta }],
      ),
    );

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
                placeholder="ابحث باسم المنتج"
                className="h-12 w-full rounded-xl border border-line bg-page ps-11 pe-4 text-base select-text placeholder:text-muted/70 focus:border-ink-3 focus:bg-white focus:ring-2 focus:ring-ink-3/15 focus:outline-none"
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
                كل الأنواع
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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
              {visible.map((p) => (
                <ProductTag
                  key={p.id}
                  product={p}
                  available={p.stock_grams - (reserved.get(p.id) ?? 0)}
                  allowNegative={allowNegative}
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
              اختر منتجاً من القائمة
              <br />
              ليُضاف إلى الفاتورة.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {cart.map((l) => (
                <li key={l.key} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{l.product.name}</div>
                    <div className="text-sm text-muted">
                      {l.variant
                        ? `${l.variant.label} · ${formatAmount(l.variant.price)}`
                        : `${formatWeight(l.grams)} × ${formatAmount(l.product.price_per_kg)}/كجم`}
                    </div>
                  </div>
                  {l.variant ? (
                    <div className="flex items-center gap-1 rounded-lg bg-page p-0.5">
                      <Button
                        tone="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => changeQuantity(l.key, 1)}
                        aria-label="زيادة"
                      >
                        <Plus className="size-4" />
                      </Button>
                      <span className="w-6 text-center font-medium">{l.quantity}</span>
                      <Button
                        tone="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => changeQuantity(l.key, -1)}
                        aria-label="نقص"
                      >
                        <Minus className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      tone="ghost"
                      size="icon"
                      className="size-7 text-muted"
                      onClick={() => changeQuantity(l.key, -1)}
                      aria-label="حذف"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                  <div className="w-20 text-end font-semibold">{formatAmount(lineTotal(l))}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex flex-col gap-3 border-t border-line p-5">
          <Readout
            label={`الإجمالي (${cart.length} صنف)`}
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
        <AddItemModal
          product={picking}
          available={picking.stock_grams - (reserved.get(picking.id) ?? 0)}
          allowNegative={allowNegative}
          currency={settings.currency}
          onAdd={addLine}
          onClose={() => setPicking(null)}
        />
      )}
      {checkingOut && (
        <CheckoutModal
          items={toCart(cart)}
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

/** A product tile styled after the price tags stuck into the ice on a fish counter. */
function ProductTag({
  product: p,
  available,
  allowNegative,
  currency,
  onPick,
}: {
  product: Product;
  available: number;
  allowNegative: boolean;
  currency: string;
  onPick: () => void;
}) {
  const out = available <= 0;
  const low = !out && p.low_stock_grams > 0 && available <= p.low_stock_grams;
  const fromPrice = p.variants.length ? Math.min(...p.variants.map((v) => v.price)) : 0;

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={out && !allowNegative}
      className="group relative flex min-h-36 flex-col rounded-xl border border-line bg-white p-4 text-start transition-colors hover:border-ink-3/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-3 disabled:opacity-50"
    >
      <div className="text-xs text-muted">{p.category_name}</div>
      <div className="mt-0.5 text-lg leading-7 font-semibold">{p.name}</div>

      <div className="mt-auto flex items-end justify-between gap-2 pt-4">
        <div className={cx("text-xs leading-5", out || low ? "font-medium text-danger" : "text-muted")}>
          {out ? (
            "نفد المخزون"
          ) : (
            <>
              {low && <div>منخفض</div>}
              {formatWeight(available)}
            </>
          )}
        </div>

        <div className="relative -me-1 rounded-md bg-tag px-2.5 py-1.5 text-ink shadow-[0_1px_0_var(--color-tag-deep)]">
          <span
            className="absolute start-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-white/80"
            aria-hidden
          />
          <div className="ps-2.5 text-end leading-tight">
            {p.sell_by_weight ? (
              <>
                <span className="text-lg font-bold">{formatAmount(p.price_per_kg)}</span>
                <span className="block text-[11px]">{currency} / كجم</span>
              </>
            ) : (
              <>
                <span className="block text-[11px]">يبدأ من</span>
                <span className="text-lg font-bold">{formatAmount(fromPrice)}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function AddItemModal({
  product,
  available,
  allowNegative,
  currency,
  onAdd,
  onClose,
}: {
  product: Product;
  available: number;
  allowNegative: boolean;
  currency: string;
  onAdd: (product: Product, variant: Variant | null, quantity: number, grams: number) => void;
  onClose: () => void;
}) {
  const hasVariants = product.variants.length > 0;
  const [mode, setMode] = useState<"variant" | "weight">(hasVariants ? "variant" : "weight");
  const [variant, setVariant] = useState<Variant | null>(product.variants[0] ?? null);
  const [quantity, setQuantity] = useState(1);
  const [kg, setKg] = useState("");

  const grams = mode === "weight" ? (parseKg(kg) ?? 0) : (variant?.weight_grams ?? 0) * quantity;
  const price =
    mode === "weight" ? priceForGrams(product.price_per_kg, grams) : (variant?.price ?? 0) * quantity;
  const overStock = !allowNegative && grams > available;
  const canAdd = grams > 0 && !overStock && (mode === "weight" || variant !== null);

  const submit = () => {
    if (!canAdd) return;
    if (mode === "weight") onAdd(product, null, 1, grams);
    else onAdd(product, variant, quantity, 0);
  };

  return (
    <Modal
      title={product.name}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <span className={cx("me-auto text-sm", overStock ? "font-medium text-danger" : "text-muted")}>
            {overStock ? "الكمية أكبر من المتوفر: " : "المتوفر: "}
            {formatWeight(available)}
          </span>
          <Button tone="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={!canAdd}>
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
        {hasVariants && product.sell_by_weight && (
          <Segmented
            size="lg"
            value={mode}
            onChange={setMode}
            options={[
              { value: "variant", label: "أوزان جاهزة" },
              { value: "weight", label: "بالكيلو" },
            ]}
          />
        )}

        {mode === "variant" ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              {product.variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVariant(v)}
                  aria-pressed={variant?.id === v.id}
                  className={cx(
                    "flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-start transition-colors",
                    variant?.id === v.id
                      ? "border-ink bg-white"
                      : "border-transparent bg-white hover:border-line",
                  )}
                >
                  <span className="font-semibold">{v.label}</span>
                  <span className="text-xs text-muted">{formatWeight(v.weight_grams)}</span>
                  <span className="mt-1 rounded bg-tag px-2 py-0.5 text-sm font-bold">
                    {formatAmount(v.price)}
                  </span>
                </button>
              ))}
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
                <span className="w-10 text-center text-2xl font-light">{quantity}</span>
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
              <Readout
                className="flex-1"
                size="md"
                label="السعر"
                value={formatAmount(price)}
                unit={currency}
              />
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-5">
            <div className="flex flex-col gap-3">
              <Readout label="الوزن" value={kg || "0.000"} unit="كجم" />
              <Readout
                label={`السعر · ${formatAmount(product.price_per_kg)} للكيلو`}
                value={formatAmount(price)}
                unit={currency}
              />
              <input
                dir="ltr"
                inputMode="decimal"
                value={kg}
                onChange={(e) =>
                  /^[0-9٠-٩]*[.٫]?[0-9٠-٩]{0,3}$/.test(e.target.value) && setKg(e.target.value)
                }
                placeholder="اكتب الوزن بالكيلو"
                aria-label="الوزن بالكيلو"
                className="h-11 rounded-lg border border-line bg-white px-3 text-center text-lg select-text focus:border-ink-3 focus:outline-none"
              />
            </div>
            <Keypad value={kg} onChange={setKg} maxDecimals={3} />
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
