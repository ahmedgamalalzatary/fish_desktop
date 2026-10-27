# Manual smoke test

Run before every release and at the end of every phase of `docs/template-plan.md`, once per shop
(`npm run dev:<shop>`). Use a copy of the shop's fixture from `tests/fixtures/` as the database when
checking an upgrade, and a fresh database when checking first run. Tick every line; anything odd is a bug.

## Every shop

1. **First run:** an empty database asks to create the admin; the admin is signed in after.
2. **Login:** wrong password is refused with a message; admin and cashier both sign in.
3. **Cashier limits:** a cashier sees only the sale screen and expenses; the receipt list shows only their
   own sales of today.
4. **Sale, cash:** add items, pay with more cash than due → change shown on screen and on the receipt.
5. **Sale, split:** pay part by card, part by wallet, rest cash → receipt lists each method; card +
   wallet larger than the total is refused.
6. **Receipt:** print preview shows shop name, address, phone, items, totals, cashier and footer.
7. **Expenses:** cashier records one; it shows under their name; admin sees it in reports.
8. **Suppliers:** add one with an opening balance; record a payment; the statement and balance add up.
9. **Purchase invoice:** partly paid → stock goes up, supplier balance grows by the unpaid part; deleting
   the invoice undoes both.
10. **Reports:** every tab opens for today, this month and a custom range; profit = sales − cost −
    expenses; PDF export and print work.
11. **Employees:** add a cashier, deactivate them, they can no longer sign in.
12. **Settings:** change shop name → sidebar and receipt follow; backup writes a file that opens.
13. **Upgrade:** a copy of the fixture opens and shows its sales, suppliers and stock unchanged.

## Fish only

- Sell by weight (kg typed on the keypad) and by fixed pack; price follows the weight.
- Stock in kg goes down per sale; low-stock warning shows under the alert level.
- Stock-take sets a counted weight and logs the difference.
- Selling more than in stock is refused unless "allow selling without stock" is on.
- Categories: add a sub-category; products and the category report follow it.

## Mobile only

- Add phones with serial, storage, colour, battery; a duplicate serial in stock is refused.
- Sell by scanning a serial and by picking from a model; a sold phone cannot be sold again.
- Receipt prints each serial.
- Take a phone out with a reason; it leaves stock and shows in stock movements.
- A purchase invoice with a sold phone cannot be deleted.
