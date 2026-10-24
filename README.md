# Mobile POS — نقطة بيع الموبايلات

A point-of-sale desktop app for a single mobile phone shop (one device, no branches), built with
**Tauri 2 + React + Tailwind + SQLite**. The interface is Arabic (RTL).

## Features

- **Roles**
  - **Admin (مدير):** manages models, phones, stock, employees, settings and reports, and can also sell.
  - **Cashier (كاشير):** sales screen only, plus reprinting their own receipts from today.
  - Roles are enforced in the Rust backend on every command, not only in the UI.
- **Models and phones:** a product is a model named in full, brand included
  (e.g. «Samsung Galaxy S24 Ultra»); there are no categories. Every physical phone is its own
  row with a serial number (IMEI / S/N), storage, colour, battery health and its own sell and
  buy price. Stock is the number of phones not yet sold: one serial is one phone.
- **Adding phones:** from the products or stock page, or on a supplier purchase invoice. Pressing
  Enter after a serial starts the next row with the same details, so a scanner can read a box quickly.
  A phone that leaves without a sale (returned, damaged, added by mistake) is taken out with a reason.
- **Purchases & suppliers:** a purchase invoice has a supplier and one line per phone (model, serial,
  buy price), and adds them to stock. Pay in full, in part, or on credit;
  the unpaid part goes to the supplier's balance. Record later payments, view and print a supplier
  statement, and delete an invoice entered by mistake, as long as none of its phones has been sold.
- **Sales:** scan a serial (or pick the model, then the phone) to add it. Pay with cash
  (with change calculation), card or e-wallet, or a mix of them in one sale
  (e.g. 20,000 cash and 15,000 by card). Only cash can be over the total. 80 mm thermal receipt.
- **Expenses:** anyone signed in records an amount and a reason; it is booked under their name.
  Cashiers see and can take back only their own expenses of the day.
- **Reports:** summary with a daily chart, a profit statement (sales − cost of phones sold −
  expenses = net profit) with a daily / monthly / yearly breakdown of what was bought, sold,
  spent and earned, receipts, models, employees, purchases
  (per invoice or per model), suppliers (purchases, payments and what is owed), expenses
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

The database is `%APPDATA%\com.mobileshop.pos\phones.db`. Money is stored as integer
cents, so totals never drift from rounding.

## Project layout

```
src/                 React frontend
  pages/             one file per screen
  components/        shared UI (Tailwind), receipt, report document, tables
  lib/               api bindings, formatting, printing/PDF, session
src-tauri/src/
  db.rs              schema migrations
  commands/          backend commands: auth, users, products, phones, suppliers,
                     purchases, sales, expenses, reports, settings, pdf
```
