import { formatAmount } from "../../lib/format";
import { formatGramPrice, formatWeight } from "./format";
import type { SaleItem } from "./types";

/** One block per line: the product, then the pack and count or the weight, at its price. */
export function ReceiptItems({ items }: { items: SaleItem[] }) {
  return (
    <table className="mt-1 w-full">
      <tbody>
        {items.map((item, i) => (
          <tr key={i} className="align-top">
            <td className="py-1">
              <div className="font-semibold">{item.product_name}</div>
              <div className="text-[11px]">
                {item.variant_label
                  ? `${item.variant_label} × ${item.quantity} @ ${formatAmount(item.unit_price)}`
                  : `${formatWeight(item.weight_grams)} @ ${formatGramPrice(item.unit_price)}/جم`}
              </div>
            </td>
            <td className="py-1 text-end font-semibold whitespace-nowrap">{formatAmount(item.line_total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
