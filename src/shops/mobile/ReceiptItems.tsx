import { formatAmount } from "../../lib/format";
import { phoneDetails } from "./format";
import type { SaleItem } from "./types";

/** One block per phone: model, details, serial and price. */
export function ReceiptItems({ items }: { items: SaleItem[] }) {
  return (
    <table className="mt-1 w-full">
      <tbody>
        {items.map((item, i) => (
          <tr key={i} className="align-top">
            <td className="py-1">
              <div className="font-semibold">{item.product_name}</div>
              {phoneDetails(item) && <div className="text-[11px]">{phoneDetails(item)}</div>}
              <div className="text-[11px]" dir="ltr">
                S/N {item.serial}
              </div>
            </td>
            <td className="py-1 text-end font-semibold whitespace-nowrap">{formatAmount(item.price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
