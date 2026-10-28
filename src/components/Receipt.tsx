import { shop } from "@shop";
import { formatAmount, formatDateTime, paymentLabels } from "../lib/format";
import type { Sale, Settings } from "../lib/types";

/** Receipt layout, sized for 80mm thermal paper and also used for the on-screen preview. */
export function Receipt({ sale, settings }: { sale: Sale; settings: Settings }) {
  const currency = settings.currency;
  return (
    <div className="mx-auto w-[72mm] bg-white px-1 py-3 text-[12px] leading-5 text-black">
      <div className="text-center">
        <div className="font-display text-2xl leading-8">{settings.shop_name}</div>
        {settings.shop_address && <div>{settings.shop_address}</div>}
        {settings.shop_phone && <div dir="ltr">{settings.shop_phone}</div>}
      </div>

      <div className="mt-2 flex justify-between border-y border-dashed border-black py-1">
        <span>فاتورة رقم {sale.id}</span>
        <span dir="ltr">{formatDateTime(sale.created_at)}</span>
      </div>

      <shop.ReceiptItems items={sale.items} />
      {sale.extras.length > 0 && (
        <table className="w-full">
          <tbody>
            {sale.extras.map((x, i) => (
              <tr key={i} className="align-top">
                <td className="py-1">
                  <div className="font-semibold">{x.name}</div>
                  <div className="text-[11px]">
                    {x.quantity} × {formatAmount(x.unit_price)}
                  </div>
                </td>
                <td className="py-1 text-end font-semibold whitespace-nowrap">
                  {formatAmount(x.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-1 border-t border-dashed border-black pt-1">
        {sale.discount > 0 && (
          <>
            <div className="flex justify-between">
              <span>المجموع</span>
              <span>{formatAmount(sale.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>خصم{sale.discount_type === "percent" && ` ${sale.discount_value}%`}</span>
              <span>−{formatAmount(sale.discount)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between text-base font-bold">
          <span>الإجمالي</span>
          <span>
            {formatAmount(sale.total)} {currency}
          </span>
        </div>
        {sale.payments.map((p) => (
          <div key={p.method} className="flex justify-between">
            <span>{paymentLabels[p.method]}</span>
            {/* Cash shows what was handed over; the change line below gives the rest back. */}
            <span>{formatAmount(p.method === "cash" ? p.amount + sale.change_due : p.amount)}</span>
          </div>
        ))}
        {sale.change_due > 0 && (
          <div className="flex justify-between">
            <span>الباقي للعميل</span>
            <span>{formatAmount(sale.change_due)}</span>
          </div>
        )}
      </div>

      {sale.credit && (
        <div className="mt-1 border-t border-dashed border-black pt-1">
          <div className="flex justify-between">
            <span>بيع آجل · {sale.credit.customer_name}</span>
            <span dir="ltr">{sale.credit.customer_phone}</span>
          </div>
          {sale.credit.later.map((p) => (
            <div key={p.id} className="flex justify-between">
              <span>
                دفعة <span dir="ltr">{formatDateTime(p.created_at)}</span> ·{" "}
                {p.payments.map((m) => paymentLabels[m.method]).join(" + ")}
              </span>
              <span>{formatAmount(p.paid - p.change_due)}</span>
            </div>
          ))}
          <div className="flex justify-between text-base font-bold">
            <span>{sale.credit.remaining > 0 ? "المتبقي على العميل" : "تم السداد بالكامل"}</span>
            <span>
              {formatAmount(sale.credit.remaining)} {currency}
            </span>
          </div>
        </div>
      )}

      <div className="mt-2 border-t border-dashed border-black pt-2 text-center">
        <div>الكاشير: {sale.cashier_name}</div>
        {settings.receipt_footer && <div className="mt-1">{settings.receipt_footer}</div>}
      </div>
    </div>
  );
}
