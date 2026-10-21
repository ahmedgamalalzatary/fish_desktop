# Fish POS — نقطة بيع الأسماك

A point-of-sale desktop app for a single fish shop (one device, no branches), built with
**Tauri 2 + React + Tailwind + SQLite**. The interface is Arabic (RTL).

## Features

- **Roles**
  - **Admin (مدير):** manages products, categories, stock, employees, settings and reports, and can also sell.
  - **Cashier (كاشير):** sales screen only, plus reprinting their own receipts from today.
  - Roles are enforced in the Rust backend on every command, not only in the UI.
- **Products** have a category, a price per kg and a cost per kg, plus optional
  **fixed-weight options** (e.g. ¼ kg, ½ kg, 1 kg box), each with its own sell and cost price.
  A product can be sold by entered weight, by fixed weights, or both.
- **Categories** have one level of sub-categories (e.g. أسماك ← أسماك نيلية).
- **Stock** is tracked per product in grams. Fixed-weight sales deduct their weight.
  Admins record goods received (with cost, optionally updating cost per kg) and stock-takes.
  Overselling is blocked unless enabled in settings.
- **Sales:** cash (with change calculation), card or e-wallet. 80 mm thermal receipt.
- **Reports:** summary with a daily chart, receipts, products, categories (with roll-up),
  employees, current stock, and stock movements, for any date range.
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

The database is `%APPDATA%\com.fishshop.pos\fish-pos.db`. Money is stored as integer
cents and weight as integer grams, so totals never drift from rounding.

## Project layout

```
src/                 React frontend
  pages/             one file per screen
  components/        shared UI (Tailwind), receipt, report document, tables
  lib/               api bindings, formatting, printing/PDF, session
src-tauri/src/
  db.rs              schema migrations
  commands/          backend commands: auth, users, categories, products,
                     stock, sales, reports, settings, pdf
```
