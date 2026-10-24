# Mobile POS — نقطة بيع الموبايلات

A point-of-sale desktop app for a single mobile phone shop (one device, no branches), built with
**Tauri 2 + React + Tailwind + SQLite**. The interface is Arabic (RTL).

## Features

- **Roles**
  - **Admin (مدير):** manages products, categories, stock, employees, settings and reports, and can also sell.
  - **Cashier (كاشير):** sales screen only, plus reprinting their own receipts from today.
  - Roles are enforced in the Rust backend on every command, not only in the UI.
- **Products** are sold by the piece. A product either has one price (a charger, a cover), or
  **options** such as storage and colour (e.g. 128GB أسود, 256GB أزرق), each with its own
  sell price, buy price, stock and low-stock alert.
- **Categories** have one level of sub-categories (e.g. موبايلات ← سامسونج).
- **Stock** is counted in pieces per option. Goods come in through purchase invoices;
  admins also record stock-takes. Overselling is blocked unless enabled in settings.
- **Purchases & suppliers:** a purchase invoice has a supplier and several items (quantity + buy price each),
  adds them to stock, and can update each item's buy price. Pay in full, in part, or on credit;
  the unpaid part goes to the supplier's balance. Record later payments, view and print a supplier
  statement, and delete an invoice entered by mistake (its stock is taken back out).
- **Sales:** cash (with change calculation), card or e-wallet, or a mix of them in one sale
  (e.g. 20,000 cash and 15,000 by card). Only cash can be over the total. 80 mm thermal receipt.
- **Expenses:** anyone signed in records an amount and a reason; it is booked under their name.
  Cashiers see and can take back only their own expenses of the day.
- **Reports:** summary with a daily chart, a profit statement (sales − cost of pieces sold −
  expenses = net profit) with a daily / monthly / yearly breakdown of what was bought, sold,
  spent and earned, receipts, products, categories (with roll-up), employees, purchases
  (per invoice or per item), suppliers (purchases, payments and what is owed), expenses
  (per employee), current stock, and stock movements, for any date range.
- **Print & PDF:** every report, the sales lists, and each receipt can be printed or saved as PDF.
  PDFs are rendered by WebView2 itself, so Arabic text is shaped correctly.
- **Backup:** a one-click database copy from Settings.

On first launch, the app asks you to create the admin account.

## Development

Requirements: Node 20+, Rust (stable, MSVC), and the Visual Studio C++ Build Tools. WebView2 ships with Windows 11.

```sh
npm install
npm run dev          # run the desktop app with hot reload
```

| Script                 | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Desktop app in development mode                       |
| `npm run dev:web`      | Frontend only, in a browser (backend calls will fail) |
| `npm run build`        | Release build + Windows installer (NSIS)              |
| `npm run typecheck`    | TypeScript check                                      |
| `npm run lint`         | ESLint + `cargo clippy -D warnings`                   |
| `npm run format`       | Prettier + rustfmt                                    |
| `npm run format:check` | Check formatting without writing                      |
| `npm test`             | Vitest + `cargo test`                                 |
| `npm run check`        | typecheck + lint + test                               |

The installer is written to `src-tauri/target/release/bundle/nsis/`.

## Where data lives

The database is `%APPDATA%\com.mobileshop.pos\mobile-pos.db`. Money is stored as integer
cents, so totals never drift from rounding.

## Project layout

```
src/                 React frontend
  pages/             one file per screen
  components/        shared UI (Tailwind), receipt, report document, tables
  lib/               api bindings, formatting, printing/PDF, session
src-tauri/src/
  db.rs              schema migrations
  commands/          backend commands: auth, users, categories, products,
                     stock, suppliers, purchases, sales, reports, settings, pdf
```
