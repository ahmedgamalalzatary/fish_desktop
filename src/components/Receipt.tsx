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

      <table className="mt-1 w-full">
        <tbody>
          {sale.items.map((item, i) => (
            <tr key={i} className="align-top">
              <td className="py-1">
                <div className="font-semibold">{item.product_name}</div>
                <div className="text-[11px]">
                  {item.variant_label && `${item.variant_label} · `}
                  {item.quantity} × {formatAmount(item.unit_price)}
                </div>
              </td>
              <td className="py-1 text-end font-semibold whitespace-nowrap">
                {formatAmount(item.line_total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-1 border-t border-dashed border-black pt-1">
        <div className="flex justify-between text-base font-bold">
          <span>الإجمالي</span>
          <span>
            {formatAmount(sale.total)} {currency}
          </span>
        </div>
        <div className="flex justify-between">
          <span>طريقة الدفع</span>
          <span>{paymentLabels[sale.payment_method]}</span>
        </div>
        {sale.payment_method === "cash" && (
          <>
            <div className="flex justify-between">
              <span>المدفوع</span>
              <span>{formatAmount(sale.paid)}</span>
            </div>
            <div className="flex justify-between">
              <span>الباقي</span>
              <span>{formatAmount(sale.change_due)}</span>
            </div>
          </>
        )}
      </div>

      <div className="mt-2 border-t border-dashed border-black pt-2 text-center">
        <div>الكاشير: {sale.cashier_name}</div>
        {settings.receipt_footer && <div className="mt-1">{settings.receipt_footer}</div>}
      </div>
    </div>
  );
}
