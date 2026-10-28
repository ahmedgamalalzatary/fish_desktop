# Project Contract — POS (نقطة البيع)

The single source of truth for this repository: what exists, how it behaves, how it is structured, and
the rules a change must keep. It was written by reading the code itself — frontend, Rust backend,
migrations, tests, configs and workflows — not by trusting the former docs. It absorbs and supersedes
`docs/template-plan.md`, `docs/new-shop.md` and `docs/smoke-test.md`, and corrects their stale parts.

Verified on 2026-10-27 against the code on branch `template`.

**How to read this file:** §1–§2 are the product. §3–§10 are the structure. §11–§14 are the operation.
§15–§20 are the procedures and the non-negotiable rules. Anything not found here should be derived by
reading the listed file.

---

## 1. What this project is

One codebase for the point-of-sale desktop apps of several shops, built with **Tauri 2 + React 19 +
Tailwind CSS 4 + SQLite (rusqlite)**. One device per shop, no branches, no server, no accounts in the
cloud. The interface is Arabic and RTL.

Each shop is built as its own Windows desktop app with its own name, identifier, database file, look,
installer and update channel. Shared code implements everything every shop needs; each shop keeps only
what is truly its own: what a "product" is, how stock is counted, how the till picks items, and its
theme.

| Shop | App name | Identifier | Version | Database | Domain |
| --- | --- | --- | --- | --- | --- |
| `fish` | Fish POS — نقطة بيع الأسماك | `com.fishshop.pos` | `0.3.1` | `fish-pos.db` | Fish, sold by weight (per kg) or in fixed-weight packs, with two-level categories |
| `mobile` | Mobile POS — نقطة بيع الموبايلات | `com.mobileshop.pos` | `0.5.1` | `phones.db` | Phones, one row per physical device by serial (IMEI / S/N), no categories |

A build always targets exactly one shop. There is no default shop.

---

## 2. Feature matrix — shared vs individual

### 2.1 Every shop has these (shared code)

| Area | What exists |
| --- | --- |
| First run | Empty database asks to create the first admin (name, username, password + confirmation) |
| Auth | Login, logout, current user, change own password; Argon2 hashes; minimum 4 characters |
| Session | In-memory in the Rust process; not persisted; app restart signs out |
| Roles | Admin (مدير) everything; cashier (كاشير) sales + expenses only; enforced in Rust |
| Sales | Server-priced cart; cash/card/wallet; any mix; cash-only change; `sale_payments` rows |
| Receipts | 80 mm layout, on-screen preview, print, PDF; today's invoices list and reprint |
| Expenses | Record under the signed-in user; admin sees all; cashier sees own today |
| Employees | List/add/edit/deactivate users; roles; last-admin and self protections |
| Suppliers | Add/edit/archive; opening balance; payments; statement with running balance; balance |
| Purchases | Supplier invoice; full/partial/deferred payment; stock in; guarded delete |
| Reports | Summary, profit, sales, cashiers, purchases (invoice/item), suppliers, expenses |
| Ranges | Today, yesterday, last 7 days, this month, last month, this year, custom |
| Printing | A4 report documents, 80 mm receipts, print and save-as-PDF |
| Settings | Shop name/address/phone/currency/footer with live receipt preview |
| Backup | One-click consistent DB copy (`VACUUM INTO`); automatic daily copy (newest 7 kept) and a copy before every database update (newest 3 kept), in `backups/` next to the DB |
| Updates | Signed in-app updater: installs by itself on the screens before sign-in, then restarts; admin banner once signed in; manual check in settings |
| Activation | One activation code per PC and shop, forever; release builds refuse setup and sign-in until activated |
| Password reset | Forgotten admin password: the login screen shows a one-time reset code for this PC; the owner's signed reply lets a new admin password be set |
| Theme | Role colour/font tokens; each shop supplies values |

### 2.2 Fish only

| Area | What exists |
| --- | --- |
| Categories | Two levels (main → sub); product counts; move/delete guards |
| Products | By kg and/or fixed-weight variants; price/cost per kg; low-stock threshold; opening stock |
| Stock | Tracked per product in grams; stock-take adjustments; negative stock only if enabled |
| Purchases | Invoice lines in grams with a cost total; optionally update the product's cost per kg |
| Reports | Products, categories (with parent merge), current stock, stock movements |
| Till | Category/sub-category chips, price-tag tiles, weight keypad, fixed-pack picker, LCD readout |
| Setting | `allow_negative_stock` ("allow selling without stock") |
| Look | Readex Pro body + Lalezar display; ice/sea palette; price-tag yellow; LCD totals |
| Lifecycle | Products with history archived; variants removed from forms are deactivated, not deleted |

### 2.3 Mobile only

| Area | What exists |
| --- | --- |
| Products | Phone models with unique names |
| Stock | One row per phone: serial, storage, colour, battery %, cost, sale price, status |
| Serial rule | Unique only among `in_stock` phones; a sold/removed serial may return (trade-in) |
| Add | Add phones of one model in a batch (all-or-none); barcode/keyboard flow |
| Edit | Edit an in-stock phone; cost from a supplier invoice is immutable |
| Take out | Remove a phone without selling, with a mandatory reason |
| Purchases | One invoice line per phone; cost fixed by the invoice |
| Reports | Products, current stock, stock movements |
| Till | Scan serial (Enter), search by model/storage/colour, brand chips, stock bars, phone-screen readout |
| Look | IBM Plex Sans Arabic + Alexandria; brushed metal; green pay; OLED totals |
| Lifecycle | Models with stock cannot be deleted; models with history archived; invoices with sold/removed phones cannot be deleted |

### 2.4 Deliberate absences

- No multi-branch, no multi-device sync, no cloud, no login server.
- No cashier access to reports, purchases, employees or settings.
- No user-defined reports or custom SQL.
- No pagination: list queries cap results (sales 1000, purchases 2000, movements 2000).
- No per-shop icons yet: both shops ship Tauri's default icon set.
- PDF export is Windows-only.
- No checks run on push; releases are started by hand.

---

## 3. Complete repository inventory

Everything below currently exists and is part of the project. `node_modules/`, `src-tauri/target/`,
`dist/` and `*.tsbuildinfo` are local build artifacts, not source.

### 3.1 Root

| Path | Purpose |
| --- | --- |
| `package.json` | npm name `pos`, private, ESM, scripts, dependencies |
| `package-lock.json` | locked npm dependency tree |
| `vite.config.ts` | React + Tailwind plugins, `@shop` alias from Vite mode, Tauri dev server settings, Vitest include |
| `shops.ts` | Shop discovery, task command lists, release rules, change filtering (tested) |
| `scripts/shops.ts` | CLI: list shops, run a task for all/one shop, plan a release |
| `scripts/activation.ts` | Activation codes and reset replies: base32, code normalizing, Ed25519 signing (tested) |
| `scripts/activation-code.ts` | CLI: make a PC's activation code; `--reset <code>` a reset reply; `--new-key` (once) / `--public-key` |
| `tsconfig.json` | Editor TS project; `@shop` points at `mobile`; strict settings |
| `tsconfig.fish.json` | `@shop` → fish; checks shared folders + fish + its tests |
| `tsconfig.mobile.json` | `@shop` → mobile; checks shared folders + mobile + its tests |
| `tsconfig.node.json` | Composite project for Vite config, scripts, and the shops and activation tests |
| `eslint.config.js` | ESLint: ignores dist/src-tauri; TS + React hooks/refresh rules |
| `index.html` | RTL Arabic document; `#root`; hidden print-only `#print-root` |
| `.gitignore` | Logs, node_modules, dist, editor files, Playwright, tsbuildinfo |
| `.vscode/extensions.json` | Recommends Tauri and rust-analyzer extensions |
| `.github/workflows/release.yml` | Manual, one-shop Windows release workflow |
| `README.md` | Short user/developer overview; points at this contract |
| `AGENTS.md` | Working instructions for agents in this repo |
| `public/logo.jpeg` | Logo shown in the sign-in footer |
| `docs/project-contract.md` | This file. `docs/` contains nothing else. |

### 3.2 Shared frontend — `src/`

| Path | Purpose |
| --- | --- |
| `main.tsx` | Sets document title from the shop; mounts React with `ToastProvider`; imports CSS |
| `App.tsx` | Startup state (activation status, `currentUser`, `needsSetup`), activation gate, login gate, session, router and role routes |
| `index.css` | Imports `@shop/theme.css` then Tailwind |
| `vite-env.d.ts` | Vite client types |
| `components/ui.tsx` | Button, Input, Select, Field, Toggle, Segmented, Modal, ConfirmDialog, Keypad, Badge, PageHeader, Empty, Panel |
| `components/DataTable.tsx` | Table with sticky header, numeric alignment, optional totals footer |
| `components/Checkout.tsx` | PaymentPicker, CheckoutModal (discount, split payments), ReceiptModal, TodaySalesModal |
| `lib/discount.ts` | `discountAmount`: a typed discount's amount, rounded like the backend (tested) |
| `components/Receipt.tsx` | 80 mm receipt layout; uses the shop's `ReceiptItems` |
| `components/ReportDocument.tsx` | A4 print/PDF layout: letterhead, period, figures, sections |
| `components/PeriodPicker.tsx` | Preset chips + custom date range |
| `components/ExportButtons.tsx` | Print and save-as-PDF for a document built on demand |
| `components/Shell.tsx` | Sidebar navigation, current user, logout, admin update banner |
| `components/Updates.tsx` | `UpdateBanner`, `InstallButton` and `StartupUpdate` (installs before sign-in) |
| `lib/api.ts` | Shared typed `invoke` commands and `Range` type |
| `lib/types.ts` | Shared payload types mirrored from Rust |
| `lib/shop.ts` | The `Shop`, `Units`, `NavItem`, `ReadoutProps`, `PurchaseForm`, `ReportTab` contracts |
| `lib/session.tsx` | Session context: user, settings, reload, logout |
| `lib/format.ts` | Cents/count/decimal parsing (Arabic digits), money and date formatting, payment labels |
| `lib/periods.ts` | Presets and range calculation |
| `lib/purchases.ts` | Purchase and supplier report columns |
| `lib/expenses.ts` | Expense and per-employee columns and grouping |
| `lib/reportTabs.ts` | Shared/shop tab ordering and row filtering |
| `lib/document.ts` | `DocumentSection` and type-erasing `section()` |
| `lib/print.tsx` | Print root rendering, page CSS, print dialog, PDF save flow |
| `lib/toast.tsx` | Toast context, success/error durations, `errorMessage` |
| `lib/useResource.ts` | Load-and-reload hook with toast on failure |
| `lib/cx.ts` | `clsx`-like join with `tailwind-merge` |
| `lib/updateState.ts` | Updater state machine, percent, status text, `installsNow` (tested) |
| `lib/updater.ts` | `useUpdater`: plugin check/install/relaunch; one install at a time |
| `pages/ActivationPage.tsx` | First start on a PC: device code with copy, activation code entry |
| `pages/LoginPage.tsx` | First-run admin creation or login; shop art and footer; "forgot admin password" link |
| `pages/ResetPasswordPage.tsx` | Forgotten admin password: reset code with copy, owner's reply, pick admin, new password |
| `pages/EmployeesPage.tsx` | User list and form; roles, activity, password |
| `pages/ExpensesPage.tsx` | Record/filter/delete expenses; totals and print |
| `pages/PurchasesPage.tsx` | Invoices and suppliers tabs, purchase form/detail, payments, statements |
| `pages/ReportsPage.tsx` | All report tabs, chart, profit statement, print/PDF |
| `pages/SettingsPage.tsx` | Shop details + preview, shop section, password, backup, updates |

### 3.3 Fish frontend — `src/shops/fish/`

| Path | Purpose |
| --- | --- |
| `index.ts` | The fish shop object: title, nav, routes, pages, units, sample sale, report tabs, settings section |
| `types.ts` | Fish payloads: Category, Variant, Product, Cart, SaleItem, PurchaseLines, report rows |
| `api.ts` | Shared API plus fish commands |
| `format.ts` | Weight formatting/parsing, kg→grams, price rounding, movement labels |
| `PosPage.tsx` | Till: search, category chips, price-tag tiles, add-item modal, cart, payment |
| `ProductsPage.tsx` | Product list and form (weight, variants, opening stock, archive) |
| `CategoriesPage.tsx` | Two-level category tree and forms |
| `CategorySelect.tsx` | Category picker with indented sub-categories |
| `StockPage.tsx` | Stock list/filters, receive, stock-take, print |
| `stock.ts` | Stock valuation, low-stock predicate, shared stock columns |
| `purchases.tsx` | Purchase line editor in kg and invoice item columns |
| `reports.tsx` | Products, categories, current stock, movements tabs |
| `SettingsSection.tsx` | "Allow selling without stock" toggle |
| `Readout.tsx` | Scale/LCD-style totals display |
| `ReceiptItems.tsx` | Receipt lines with weight or pack details |
| `LoginArt.tsx` | Sign-in art: "سمك طازة" over a wave pattern |
| `theme.css` | Fish fonts and colour token values |

### 3.4 Mobile frontend — `src/shops/mobile/`

| Path | Purpose |
| --- | --- |
| `index.ts` | The mobile shop object (title, nav, routes, pages, units, sample sale, tabs) |
| `types.ts` | Phone, Product, PhoneInput, Cart, SaleItem, PurchaseLines, report rows |
| `api.ts` | Shared API plus model/phone commands |
| `format.ts` | Arabic phone counting, phone detail string, movement labels |
| `phones.ts` | Phone form drafts, copy/blank rules, validation, repeated serials, option lists |
| `PosPage.tsx` | Till: serial scan/search, brand chips, model cards, pick-phone modal, cart, payment |
| `ProductsPage.tsx` | Model list, create (optionally with phones), rename, open phones, archive |
| `PhoneModals.tsx` | Model phones, add phones, edit phone, take-out modals |
| `PhoneLines.tsx` | Phone rows for forms; optional model column; Enter-to-add |
| `StockPage.tsx` | One row per phone, value figures, filters, edit/take-out, add, purchase, print |
| `stock.tsx` | Stock rows from models, stock columns with totals |
| `purchases.tsx` | Purchase editor (one row per phone) and invoice item columns |
| `reports.tsx` | Products, current stock, movements tabs |
| `Readout.tsx` | Phone lock-screen-style totals display |
| `ReceiptItems.tsx` | Receipt lines with details and serial |
| `LoginArt.tsx` | Sign-in art: a phone showing the live time and date |
| `theme.css` | Mobile fonts and colour token values |

### 3.5 Rust backend — `src-tauri/`

| Path | Purpose |
| --- | --- |
| `Cargo.toml` | Package `pos`, lib `pos_lib`, features `fish`/`mobile`, dependencies, release profile |
| `Cargo.lock` | Locked Rust dependency tree |
| `build.rs` | Fails a build unless exactly one shop feature is on; reruns on `src/shops` |
| `tauri.conf.json` | Shared app config: base identity, window, CSP, NSIS icons, updater public key |
| `release.conf.json` | Adds `createUpdaterArtifacts: true` for release builds |
| `capabilities/default.json` | Core, dialog save/message, updater, process restart permissions |
| `shops/fish/tauri.conf.json` | Fish product name, identifier, version, window title, build commands, update endpoint |
| `shops/mobile/tauri.conf.json` | Same for mobile |
| `src/main.rs` | Windows subsystem guard; calls `pos_lib::run()` |
| `src/lib.rs` | Shop module selection, shared command list macro, plugins, DB setup, activation state, daily backup thread, handler |
| `src/state.rs` | `SessionUser`, `Activation` (device code, active flag, `require`/`activate`), `AppState` with DB and session mutexes; `user()`/`admin()` guards |
| `src/error.rs` | `AppError`, Arabic messages, serialization, `invalid()` helper |
| `src/db.rs` | Open/WAL/before-update copy/migrate/foreign-key check, `now()`, shared schema test |
| `src/backup.rs` | Daily and before-update copies into `backups/`, with pruning |
| `src/activation.rs` | Device code, public key, signature check, saved activation |
| `src/test_support.rs` | Temp DB and fixture-copy helpers for Rust tests |
| `src/commands/mod.rs` | Declares the command modules |
| `src/commands/activation.rs` | `activation_status`, `activate` |
| `src/commands/auth.rs` | Argon2 hashing, setup, login, logout, current user, password change |
| `src/commands/users.rs` | User CRUD with uniqueness and last-admin rules |
| `src/commands/suppliers.rs` | Supplier CRUD, balance SQL, payments, statement |
| `src/commands/purchases.rs` | Purchase creation, summary/list/get, guarded removal |
| `src/commands/sales.rs` | Sale settlement, insert, load, list with role limits |
| `src/commands/expenses.rs` | Expense create/query/list/delete with role limits |
| `src/commands/settings.rs` | Known-key settings read/write, backup |
| `src/commands/reports.rs` | Summary, daily, periods, purchased items, cashier, supplier reports |
| `src/commands/pdf.rs` | WebView2 PrintToPdf export command |

### 3.6 Fish backend — `src-tauri/src/shops/fish/`

| Path | Purpose |
| --- | --- |
| `mod.rs` | Shop exports: `DB_FILE`, migrations, settings keys, command macro, public modules |
| `migrations.rs` | Four ordered SQL migrations (see §8.1) |
| `categories.rs` | Category list/create/update/delete with two-level rules |
| `products.rs` | Product/variant list/create/update/archive/restore; cashiers see no costs |
| `stock.rs` | Stock-take adjustment |
| `sales.rs` | Cart pricing (weight/variants), stock checks, recording, receipt lines |
| `purchases.rs` | Invoice lines in grams, total, recording, loading, removal, cost-per-kg update |
| `reports.rs` | Unit SQL constants; product, category and movement reports |
| `testing.rs` | Test stock/line helpers; one item = 1 kg; stock sum in grams |
| `fixture_tests.rs` | Opens `fish-0.2.0.db` and asserts migration/history invariants |

### 3.7 Mobile backend — `src-tauri/src/shops/mobile/`

| Path | Purpose |
| --- | --- |
| `mod.rs` | Shop exports: `DB_FILE`, migration, empty settings keys, command macro, public modules |
| `migrations.rs` | One full initial migration (see §8.2) |
| `products.rs` | Model list/create/rename/archive/restore; cashiers see no costs |
| `phones.rs` | Phone list/insert/batch add/edit/take out; serial and status rules |
| `sales.rs` | Phone-id cart pricing, stock checks, recording, receipt lines |
| `purchases.rs` | One line per phone, total, recording, loading, removal guard |
| `reports.rs` | Unit SQL constants; product and movement reports |
| `testing.rs` | Test stock/line helpers; one item = 1 phone; stock count |
| `fixture_tests.rs` | Opens `mobile-0.4.0.db` and asserts history invariants |

### 3.8 Tests, fixtures and seeders — `tests/`

| Path | Purpose |
| --- | --- |
| `tests/shops.test.ts` | Shop resolution, task commands, release rules, relevant-change filtering |
| `tests/format.test.ts` | Money/count parsing with Arabic digits, amount formatting, local date |
| `tests/updateState.test.ts` | Updater reducer, download percent, status text, install-before-sign-in rule |
| `tests/activation.test.ts` | Activation-code tool: base32, device-code input, signing, a pinned code the Rust test also accepts |
| `tests/reportTabs.test.ts` | Shared/shop tab order and filter behavior |
| `tests/fish/format.test.ts` | kg parsing/formatting, weight pricing parity with Rust |
| `tests/mobile/format.test.ts` | Arabic phone counting and detail text |
| `tests/fixtures/README.md` | Fixture scenarios, expected numbers, regeneration procedure |
| `tests/fixtures/fish-0.2.0.db` | Fish database written by 0.2.0 |
| `tests/fixtures/mobile-0.4.0.db` | Mobile database written by 0.4.0 |
| `tests/fixtures/seeders/fish-0.2.0.rs` | Seeder run against the old fish release |
| `tests/fixtures/seeders/mobile-0.4.0.rs` | Seeder run against the old mobile release |
| `tests/fixtures/seeders/seed-build.rs` | Replacement build script used while seeding |
| `tests/fixtures/seeders/test.manifest` | Windows manifest required to start the seeded test binary |

---

## 4. Architecture and build selection

```
                       ┌─────────────────────────────────────────────┐
npm run dev fish  ───► │ vite --mode fish                            │
                       │   alias @shop → src/shops/fish              │
                       │ tauri --features fish --config shops/fish/… │
                       └──────────────────┬──────────────────────────┘
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
        shared frontend (src/)                          shared backend (src-tauri/src/)
        pages, components, lib                  commands/, db.rs, state.rs, error.rs
                  │                                               │
                  └──────────► @shop ◄──► crate::shop ────────────┘
                          src/shops/<shop>/   src-tauri/src/shops/<shop>/
```

### 4.1 Choosing a shop

- **Frontend:** Vite mode is the shop. `vite.config.ts` calls `resolveShop(mode)`; the alias `@shop`
  points at `src/shops/<mode>`. `resolveShop` refuses anything that is not a direct folder name
  matching `/^[a-z0-9-]+$/`, and lists the valid shops in the error.
- **Backend:** Cargo feature is the shop. `lib.rs` has one `#[cfg(feature = "<shop>")] #[path =
  "shops/<shop>/mod.rs"] #[macro_use] mod shop;` block per shop.
- **Guard:** `build.rs` reads `src-tauri/src/shops/`, checks `CARGO_FEATURE_*`, and panics on zero or
  more than one shop feature. The former docs wrongly said this guard was in `lib.rs`.
- **Config:** `tauri dev|build --config src-tauri/shops/<shop>/tauri.conf.json --features <shop>`. The
  shop config overrides product name, identifier, version, window title and dev/build commands. The
  base config holds shared settings.
- **TypeScript:** `tsconfig.<shop>.json` sets both `@shop` and `@shop/*` paths to the same shop and
  includes shared folders plus only that shop's tests. `tsconfig.json` (editor view) points at mobile.

### 4.2 The Rust shop interface

Shared code talks to a shop only through `src-tauri/src/shops/<shop>/mod.rs`:

| Export | Used by | Fish | Mobile |
| --- | --- | --- | --- |
| `DB_FILE: &str` | `lib.rs` (`app.data_dir().join(DB_FILE)`) | `"fish-pos.db"` | `"phones.db"` |
| `MIGRATIONS: &[&str]` | `db::open` → `db::migrate` | 4 migrations | 1 migration |
| `SETTINGS_KEYS: &[&str]` | `commands/settings.rs` | `["allow_negative_stock"]` | `[]` |
| `sales::{Cart, Priced { total, cost }, price(), record()}` | `commands/sales.rs` | weight/variant cart | phone id vector |
| `sales::{SaleItem, load_items()}` | receipt | product name, variant label, quantity, grams, prices | model, serial, storage, colour, battery, price |
| `purchases::{Lines, total(), record(), PurchaseItem, load_items()}` | `commands/purchases.rs` | grams + cost per line | one phone per line |
| `purchases::{ITEMS_COUNT_SQL, remove()}` | list/detail/delete | count movements on invoice | count phones; refuse if any sold/removed |
| `reports::{UNITS_SOLD, MOVEMENT_UNITS}` | `commands/reports.rs` | `i.weight_grams`, `m.change_grams` | `1`, `m.change_qty` |
| `shop_commands!` macro | `lib.rs` | extra commands | extra commands |
| `testing::{ITEM_UNITS, cart_worth(), lines_costing(), stock_units()}` | shared tests | 1 item = 1000 g | 1 item = 1 phone |

Every shop's migrations must satisfy `db::tests::has_the_shared_tables` (see §8.3).

### 4.3 The TypeScript shop interface

`index.ts` exports `shop: Shop` (from `src/lib/shop.ts`):

| Field | Type / shape | Used by |
| --- | --- | --- |
| `title` | string | document title, window title |
| `navItems` | `{ to, label, icon, cashier? }[]` | sidebar |
| `adminRoutes` | `{ path, Page }[]` | admin router |
| `PosPage` | component | `/pos` |
| `Readout` | component with label/value/unit/size/warn/className | till, checkout, purchases, reports |
| `LoginArt` | component | sign-in left half |
| `ReceiptItems` | component `{ items: SaleItem[] }` | receipt |
| `sampleSale` | `Pick<Sale, "items" \| "extras" \| "total" \| "payments" \| "paid" \| "change_due">` | settings receipt preview (no discount) |
| `units` | `Units` | shared reports/invoices wording and quantity formatting |
| `usePurchaseLines(productId?)` | hook → `PurchaseForm` | purchase form |
| `purchaseItemColumns(purchase)` | `Column<PurchaseItem>[]` | invoice detail/print |
| `reportTabs` | `ReportTab<unknown>[]` | reports page |
| `SettingsSection?` | component `{ draft, set }` | settings page (fish only) |

`Units` fields: `noun` (plural with article), `product` (one product's name), `perUnit` (average
price header), `per` (units per price, 1 for phones, 1000 g for per-kg), `invoiceLines?` (header for
line count when it differs from units), `format(units)` (table cell), `count(units)` (sentence).

`ReportTab` fields: `value`, `label`, `place` (`"sales"` after invoices, `"stock"` last), `snapshot?`
(current state ignores period), `intro?`, `empty`, `load(range)`, `columns(rows, summary, currency)`,
`rowKey`, `inFullReport?`, and an optional `filter { label, all, options, apply(rows, value) }`.

`PurchaseForm`: `editor`, `total`, `count`, and `read()` returning `{ items }` or `{ error }`.

Required from `@shop/types`: `SaleItem`, `Cart`, `PurchaseLine`, `PurchaseLines`, `PurchaseItem`, and
the shop's product/row types. Shop folders also provide `types.ts`, `api.ts`, `theme.css` (imported by
`src/index.css`) and their pages/components.

### 4.4 Architecture rules

1. Shared code never names a shop; it uses `crate::shop` / `@shop` only.
2. Shop files import shared pages/components; those import `@shop` back. Therefore shared code reads
   `shop` only inside components/functions, never at module top level, and shop files never import
   `@shop` themselves.
3. Never edit or renumber a released migration. Append only; each shop owns its list.
4. Never change a shop's `identifier` or `DB_FILE` after first install.
5. Prices, totals, stock changes and payment splits are computed in Rust from the database, in one
   transaction; client prices are never trusted.
6. Money is integer cents; weights are integer grams.
7. Tailwind utilities only; no custom classes or `@apply`. Shared components use role token names.
8. `rustfmt`, targeted checks for the touched area.

---

## 5. Shared frontend contract

### 5.1 Entry, session and routing

- `main.tsx`: `document.title = shop.title`; `<React.StrictMode><ToastProvider><App/></ToastProvider>`.
- `App.tsx` loads `api.activationStatus()`, `api.currentUser()` and `api.needsSetup()`.
  - Loading → nothing.
  - PC not activated → `ActivationPage` + `StartupUpdate`.
  - No user → `LoginPage` (`firstRun = needsSetup`) + `StartupUpdate`.
  - Signed in → `SessionProvider` (loads settings; renders nothing until loaded) → `HashRouter` →
    `Shell` → routes.
- Routes: `/pos` (shop PosPage), `/expenses`. Admin-only: `/reports`, every `shop.adminRoutes` entry,
  `/purchases`, `/employees`, `/settings`. Unknown → `/reports` for admin, `/pos` otherwise.
- `Shell`: 92 px sidebar. Nav order = sales, expenses, reports, shop nav items, purchases, employees,
  settings. Cashiers see only `cashier: true` items. Header shows the first two words of the shop name.
  Admin sees `<UpdateBanner/>` above the page. Logout is in the sidebar footer.
- `ActivationPage`: shop art; the device code (selectable, copy button); a box for the activation
  code (any case, spaces or dashes); errors in an alert box; success goes on to sign-in/setup.
- `ResetPasswordPage`: back link to sign-in; the PC's reset code (selectable, copy button) and a box
  for the owner's reply; once accepted, a choice of active admin (name and username) and a new
  password with confirmation; success signs that admin in. Employees' passwords are reset by an admin
  in Employees instead.
- `StartupUpdate`: checks once when shown; if an update exists it installs straight away behind a
  full-screen "جارٍ تحديث البرنامج" overlay with progress, then the app restarts. Offline or failed
  checks stay silent.
- `LoginPage`: first run asks name/username/password/confirm and creates the admin (then signs in);
  later runs ask username/password, with a "نسيت كلمة مرور المدير؟" link to `ResetPasswordPage`. Errors
  show in an alert box. Footer: logo, "BIT Technologies",
  current year. The left art comes from the shop.

### 5.2 Shared libraries — exact behavior

| File | Behavior |
| --- | --- |
| `api.ts` | `call<T>` wraps `invoke`, converts string errors to `Error(message, { cause })`; `api` holds all shared commands; `Range = { from, to }` |
| `types.ts` | Mirrors Rust payloads; money is cents; imports shop line types via `@shop/types` |
| `format.ts` | `formatAmount` Intl en-US, 2 decimals of cents/100; `formatMoney` appends non-empty currency; `parseMoney` rounds decimal×100; `parseCount` whole numbers only; `parseDecimal` accepts Arabic-Indic digits, replaces `٫`/`,` with `.`, rejects negatives/fractions where disallowed; `paymentLabels` cash/card/wallet; `paymentNames` joins with " + "; `formatDateTime` → `dd/mm/yyyy hh:mm`; `isoDate` local calendar date |
| `periods.ts` | Presets: today, yesterday (`day−1`), week (`day−6…day`), month (1…day), last-month (prev 1…prev last), year (Jan 1…today), custom |
| `shop.ts` | The contracts above; `reportTab()` type erasure |
| `session.tsx` | Loads settings once; `reloadSettings`, `logout` (calls backend then parent callback) |
| `toast.tsx` | Success 3000 ms, error 6000 ms; role `status`/`alert` |
| `useResource.ts` | Runs the stable fetcher on mount and on `reload()`; ignores stale results; toasts failures |
| `cx.ts` | Filters falsy, joins, `twMerge` |
| `document.ts` | `DocumentSection<T>`, `section<T>()` erases the row type for a mixed list |
| `print.tsx` | Renders into `#print-root`, adds `@page` CSS (A4 or 80 mm), waits `document.fonts.ready`, then prints; PDF asks for a path, measures receipt height (96 dpi) and invokes `export_pdf(path, width, height, margin)` in inches |
| `updateState.ts` | States: idle, checking, latest, available, downloading (done/total), installing, failed; progress events ignored outside a download; percent capped at 100; Arabic status strings; `installsNow(state, signedIn)` = an update is available and nobody is signed in |
| `updater.ts` | `useUpdater`: `check()` and `downloadAndInstall` with progress, then `relaunch()`; failures map to Arabic messages; a second install request while one runs is ignored |
| purchases.ts | `purchaseColumns`: id, date, supplier, supplier invoice or "—", optional invoice-line count, units total, total, paid-on-receipt total; `supplierReportColumns`: counts, units, purchases, paid, current balance |
| `expenses.ts` | `expenseColumns` (date, reason, user, total) and `expensesByUser` + columns (count/amount, largest first) |
| `reportTabs.ts` | `allTabs`: summary, profit, sales, shop "sales" tabs, cashiers, purchases, suppliers, expenses, shop "stock" tabs; `narrowRows` applies the tab filter only when a value is picked |

### 5.3 Shared components — exact behavior

- **UI kit.** Button tones `primary`, `pay` (only for taking money), `outline`, `ghost`, `danger`,
  `danger-ghost`; sizes `sm`, `md`, `lg`, `icon`. Field wrapper generates ids. Toggle is a switch.
  Segmented is a radio group. Modal closes on Escape/backdrop and focuses the first input or
  `[data-autofocus]`. Keypad is LTR, refuses extra decimals and leading-zero duplicates. Badge tones
  neutral/success/danger/ink. Panel is the white surface.
- **DataTable.** Sticky header; numeric columns end-aligned; footer only when a column defines a
  total; optional row click.
- **Checkout.** Payment picker for cash/card/wallet. `CheckoutModal` starts with the method chosen at
  the till as the automatic "rest" method; typing into it stops it being automatic. The automatic
  method covers whatever the others leave. Only non-cash overpayment is refused; cash may exceed and
  change is shown. Cash suggestions round up to 50/100/200/500/1000. A discount row above the methods
  takes the keypad like a method: a fixed amount in the currency (up to the whole ticket) or a whole
  percent (1–100), switched by a small toggle; what is due becomes the ticket less the discount and
  every method row works from that. A discount that can't be given turns the readout into a warning
  and blocks confirming. Confirming sends the cart, non-zero payment rows and the discount (or null),
  then shows the receipt. `TodaySalesModal` loads today's sales (backend limits
  cashiers to their own) with a total, list, receipt reopen and print.
- **Receipt.** 72 mm content inside the 80 mm page. Shop name/address/phone, invoice number/time,
  shop item lines, then — when discounted — the subtotal and a "خصم" line (with the percent when it
  was one), total, each payment (cash shows handed-over amount = covered + change), change row
  when positive, cashier, footer.
- **ReportDocument.** RTL A4; letterhead; title; period (single day or range); generated timestamp;
  optional 4-column figures strip; sections with tables, totals and "no data" text.
- **PeriodPicker.** Preset chips; custom shows two date inputs constrained to each other.
- **ExportButtons.** Print and save-as-PDF; both disabled while busy; success toast after a PDF save.
- **Updates.** Banner (signed-in admins) shows available/downloading/installing, or a failed install
  with retry; a failed automatic check on start stays silent. `StartupUpdate` (before sign-in) installs
  without asking.

### 5.4 Shared pages — exact behavior

- **Employees.** Table: name (marks you), username, role, active, invoice count, created date,
  edit/delete. Form: name, username, password/new password, role segmented, active toggle; role and
  active are hidden for yourself. Delete confirms; backend may deactivate instead.
- **Expenses.** One-line add form (amount, reason, quick reason chips), "recorded under your name".
  Admins get period chips and employee filter; cashiers see "your expenses today". Table plus a readout
  of the total; admins see per-employee breakdown. Delete allowed for admins or own same-day entries.
  Print/PDF for admins with per-employee and detail sections.
- **Purchases.** Two tabs. Invoices: default range is month start → today, supplier filter, table,
  detail modal (figures + item lines + print), guarded delete. Suppliers: balances table (owed in red,
  credit in green), payment modal (with "full balance"), statement modal (opening balance, purchases,
  paid, running balance; clicking a purchase opens its detail; only standalone payments can be
  deleted), edit/archive. New invoice form: supplier (or create inline), invoice number, shop lines,
  full/partial payment, note, totals.
- **Reports.** Loads all shared reports and every shop tab in parallel on range change; periods load
  separately for the day/month/year switch. Six key figures; tab strip; per-tab print and a full
  combined report. Summary: daily bar chart (gaps filled, capped at 400 points) and payment table.
  Profit: running statement ending in a readout, plus per-period table with day/month/year grouping.
  Sales: rows open the receipt. Purchases: invoice/item switch; rows open the invoice. Suppliers:
  period activity plus current balance. Expenses: detail + per-employee. Shop tabs render intro,
  optional filter select, table, and their columns. Daily chart uses the shop's `--color-chart`.
- **Settings.** Shop details with a live receipt preview using the shop's `sampleSale`; optional shop
  section; password change; backup to a chosen `.db` (the text explains the automatic copies);
  updates (current version, manual check, install; the text explains installing before sign-in). Save is enabled only when the draft differs.

### 5.5 Theme tokens

Required in every `theme.css`:

`--font-sans`, `--font-display`, `--color-page`, `--color-surface`, `--color-line`, `--color-muted`,
`--color-ink`, `--color-ink-2`, `--color-ink-3`, `--color-pay`, `--color-pay-hover`,
`--color-pay-deep`, `--color-ok`, `--color-ok-soft`, `--color-danger`, `--color-danger-hover`,
`--color-danger-soft`, `--color-chart`, `--color-readout`, `--color-readout-ink`.

Fish additionally uses `--color-tag` and `--color-tag-deep` in its own components.

---

## 6. Shared backend contract

### 6.1 Runtime

- `lib.rs` plugins: dialog, updater, process. Setup creates the app data dir, opens
  `db::open(dir.join(shop::DB_FILE))`, works out the PC's device code from the app identifier, decides
  activation (required in release builds; in debug only with `POS_REQUIRE_ACTIVATION` set; active when
  the saved code is good for this PC), manages `AppState`, then starts the daily backup thread (a copy
  now, then a look every hour).
- `AppState`: `Mutex<Connection>` + `Mutex<Option<SessionUser>>` + `Activation`; `user()` errors if
  signed out; `admin()` errors for cashiers; `activation.require()` errors with
  "البرنامج غير مفعّل على هذا الجهاز" until activated. `Activation` also runs the password reset:
  `reset_code()`, `allow_reset(reply)` (wrong reply: "كود الاستعادة غير صحيح لهذا الطلب…") and
  `finish_reset(set)`, which refuses until a reply was accepted and then ends the reset.
- One `invoke_handler!` macro lists all shared commands then splices the shop's `shop_commands!`.
- `AppError` → Arabic string: "يجب تسجيل الدخول أولاً", "ليس لديك صلاحية لهذا الإجراء", "{what} غير موجود",
  the invalid message, "خطأ في قاعدة البيانات: …", or a custom message.

### 6.2 Database and migrations

- `db::open`: open file, `PRAGMA journal_mode = WAL`; when `0 < user_version < migrations` (an update
  is about to change existing data) copy it to `backups/<stem>-before-update-<YYYY-MM-DD-HHMMSS>.db`
  (newest 3 kept); migrate; then `PRAGMA foreign_keys = ON`. New and current databases are not copied.
- `db::migrate`: foreign keys OFF; read `PRAGMA user_version`; apply every migration at index ≥ version
  in its own transaction; run `pragma_foreign_key_check` and reject if any broken reference remains;
  set `user_version = i + 1`; commit.
- `now()` = local `YYYY-MM-DD HH:MM:SS`.

### 6.3 Commands — args, guards, results

All commands are Tauri commands returning `AppResult<T>` (Arabic error on failure).

| Command | Args | Guard | Result / effect |
| --- | --- | --- | --- |
| `activation_status` | — | none | `{ active, device_code }` |
| `activate` | code | none | checks the code against this PC's device code, saves it, marks active; wrong code refused |
| `needs_setup` | — | none | `bool`: no users |
| `setup_admin` | name, username, password | activated; no users exist | session user; inserts admin; fails if users exist |
| `login` | username, password | activated | session user; active account + Argon2 verify |
| `logout` | — | — | clears session |
| `current_user` | — | — | session user or null |
| `change_password` | current, new_password | signed in | verifies current; new min 4 |
| `password_reset_code` | — | activated | this PC's reset code (kept in `reset.txt` until a reset is done) |
| `check_password_reset` | reply | activated | checks the owner's reply to the reset code; `[{ id, name, username }]` of active admins |
| `reset_admin_password` | user_id, new_password | accepted reply | sets an active admin's password (min 4), signs them in, ends the reset |
| `list_users` | — | admin | users with sales count |
| `create_user` | input `{name, username, role, active, password?}` | admin | id; password required (min 4); unique username (NOCASE) |
| `update_user` | id, input | admin | updates; optional non-empty password; self role/active guard; last-admin guard |
| `delete_user` | id | admin | `"deleted"` if no sales/movements, else `"deactivated"`; cannot delete self |
| `list_suppliers` | — | admin | rows + counts/totals/balance/last purchase |
| `create_supplier` | input | admin | id; name required; opening ≥ 0 |
| `update_supplier` | id, input | admin | update |
| `delete_supplier` | id | admin | `"deleted"` if no history, else `"deactivated"` |
| `add_supplier_payment` | supplier_id, amount, note | admin | amount > 0 |
| `delete_supplier_payment` | id | admin | deletes payment |
| `supplier_statement` | supplier_id | admin | purchases + payments ordered by date/kind |
| `create_purchase` | input `{supplier_id, invoice_no, note, paid, items}` | admin | id; supplier active; 0 ≤ paid ≤ total; transaction |
| `list_purchases` | from, to, supplier_id? | admin | summaries in date range, limit 2000 |
| `get_purchase` | id | admin | summary + note + shop items |
| `delete_purchase` | id | admin | shop removal, payments, invoice |
| `create_sale` | items (shop cart), payments, discount `{ kind: fixed\|percent, value }` or null | signed in | sale; server pricing; discount checked (fixed 0 < value ≤ subtotal in cents, percent 1–100 rounded to the cent) and taken off before the payments are settled; transaction |
| `get_sale` | id | signed in | sale; cashier only own |
| `list_sales` | from, to, user_id? | signed in | summaries; cashier forced today+self; limit 1000 |
| `create_expense` | amount, reason | signed in | id; amount > 0; reason required; booked to caller |
| `list_expenses` | from, to, user_id? | signed in | cashier forced today+self |
| `delete_expense` | id | signed in | admin any; cashier own same day |
| `get_settings` | — | signed in | key → value map |
| `update_settings` | values map | admin | known keys only; trimmed; transaction |
| `backup_database` | path | admin | deletes target then `VACUUM INTO` |
| `export_pdf` | path, width, height, margin | signed in | WebView2 PrintToPdf |
| `report_summary` | from, to | admin | totals (revenue after discounts, discounts given), units, expenses, purchases, supplier paid, per-method |
| `report_daily` | from, to | admin | per-day count/revenue/profit |
| `report_by_cashier` | from, to | admin | per-user count/revenue/profit/first/last/discounts |
| `report_by_supplier` | from, to | admin | per-supplier period activity + current balance |
| `report_periods` | from, to, group | admin | day/month/year rows; invalid group rejected |
| `report_purchased_items` | from, to | admin | per-product received units/cost |

### 6.4 Key calculations

- **Sale settlement:** methods must be `cash`, `card`, `wallet`; amounts ≥ 0; `card + wallet ≤ total`;
  `paid = sum(amounts) ≥ total`; `change = paid − total`; covered rows are `cash − change`, `card`,
  `wallet`, each kept only if > 0. Sale stores total, cost, paid, change.
- **Supplier balance** (`BALANCE_SQL`): `opening_balance + Σpurchases.total − Σsupplier_payments.amount`.
- **Purchase summary:** `items_count` uses the shop SQL; `units` sums purchase movements; `paid` sums
  payments pointing at that invoice.
- **Report summary:** sales count/Σtotal/Σcost; units via `UNITS_SOLD`; purchases cost/units from
  `stock_movements` reason `purchase`; supplier payments; expenses; per-method totals (a split sale is
  counted once under each method it used, and the amounts still add up).
- **Periods:** `strftime` by day/month/year; merge five queries (sales count, revenue/cost, units,
  expenses, purchases); periods with no activity are omitted; profit/net derived after.
- **Statement:** union of purchases and payments ordered by `created_at`, kind descending, id.

### 6.5 Authorization and lifecycle rules

- Every command is guarded with `state.user()` or `state.admin()`; nobody can get a session on a PC
  that is not activated, because `setup_admin` and `login` require it.
- Cashiers are forced to their own today's sales and expenses, regardless of sent range/user.
- Deleting history is avoided: users with sales/movements, suppliers with purchases/payments, fish
  products with history, mobile models with any phone, are archived/deactivated instead.
- Cannot remove the last active admin; cannot change your own role or deactivate/delete yourself.
- Settings only for known keys (shared + shop keys).
- Sale and purchase creation are fully transactional.
- Mobile purchase removal is refused if any phone from it is not `in_stock`.
- Fish purchase removal subtracts the invoice grams and deletes its movements; product cost changes it
  made are left as they are.

### 6.6 Backend tests

- `test_support::temp_db(name)` creates a fresh shop DB (migrations applied) with admin id 1.
- `test_support::open_fixture(name)` copies `tests/fixtures/<name>` before opening it.
- `int()` runs a scalar query; `open_fixture`/`int` are `#[allow(dead_code)]` for shops without fixtures.
- Tests cover sale splitting/change, stock and negative stock, serial rules, purchase balances,
  report grouping, role rules, schema and migration behavior, daily/before-update backups and
  pruning, activation codes (device code, accepting/refusing codes, saved activation, the gate),
  password reset (reply accepted once, only on this PC, never an activation code; nothing set without it).

---

## 7. Frontend/backend payload contracts

### 7.1 Shared TypeScript types (`src/lib/types.ts`)

- `Role = "admin" | "cashier"`; `PaymentMethod = "cash" | "card" | "wallet"`.
- `SessionUser { id, name, username, role }`.
- `User extends SessionUser { active, created_at, sales_count }`.
- `UserInput { name, username, role, active, password: string | null }`.
- `PaymentInput { method, amount }`; `Payment { method, amount }`.
- `DiscountInput { kind: "fixed" | "percent", value }` (cents, or a whole percent).
- `Sale { id, created_at, cashier_name, subtotal, discount, discount_type, discount_value, total,
  payments, paid, change_due, items, extras }`; `total` = `subtotal − discount` is what was due.
- `SaleSummary { id, created_at, cashier_name, total, discount, methods, items_count }`.
- `Settings` = the five shared string keys + any extra string keys.
- `ReportSummary { sales_count, revenue, discounts, cost, profit, units_sold, expenses, net_profit,
  purchases_cost, purchases_units, supplier_paid, by_payment[] }`.
- `DailyRow { day, sales_count, revenue, profit }`.
- `PeriodGroup = "day" | "month" | "year"`; `PeriodRow { period, sales_count, units_sold, revenue,
  cost, profit, expenses, net_profit, purchases_cost, purchases_units }`.
- `PurchasedItemRow { product_id, name, units, cost }`.
- `Expense { id, created_at, amount, reason, user_id, user_name }`.
- `CashierReportRow { user_id, name, sales_count, revenue, profit, first_sale, last_sale }`.
- `Supplier { id, name, phone, note, opening_balance, active, purchases_count, purchases_total,
  paid_total, balance, last_purchase }`; `SupplierInput { name, phone, note, opening_balance, active }`.
- `PurchaseInput { supplier_id, invoice_no, note, paid, items: PurchaseLines }`.
- `PurchaseSummary { id, created_at, supplier_id, supplier_name, invoice_no, items_count, units,
  total, paid, user_name }`; `Purchase extends PurchaseSummary { note, items }`.
- `StatementRow { kind: "purchase" | "payment", id, created_at, reference, purchase_id, amount }`.
- `SupplierReportRow { supplier_id, name, purchases_count, purchases_total, pieces, paid, balance }`.

### 7.2 Fish types (`src/shops/fish/types.ts`)

- `Category { id, name, parent_id, product_count }`.
- `Variant { id: number | null, label, weight_grams, price, cost }`.
- `Product { id, name, category_id, category_name, parent_category_id, parent_category_name,
  sell_by_weight, price_per_kg, cost_per_kg, stock_grams, low_stock_grams, active, variants[] }`.
- `ProductInput { name, category_id, sell_by_weight, price_per_kg, cost_per_kg, low_stock_grams,
  variants[] }`.
- `CartItem { product_id, variant_id: number | null, quantity, weight_grams: number | null }`;
  `Cart = CartItem[]`.
- `SaleItem { product_name, variant_label, quantity, weight_grams, unit_price, line_total }`.
- `PurchaseLine { product_id, grams, cost_total }`;
  `PurchaseLines { update_cost: boolean, lines: PurchaseLine[] }`.
- `PurchaseItem { product_name, grams, cost_total }`.
- `ProductReportRow { product_id, name, category_name, units, grams, revenue, cost, profit }`.
- `CategoryReportRow { category_id, name, parent_id, parent_name, grams, revenue, profit }`.
- `MovementReason = "sale" | "purchase" | "adjustment"`.
- `MovementRow { id, created_at, product_name, change_grams, reason, cost_total, note, sale_id,
  purchase_id, supplier_name, user_name }`.

### 7.3 Mobile types (`src/shops/mobile/types.ts`)

- `Phone { id, product_id, serial, storage, color, battery, price, cost, purchase_id, created_at }`.
- `Product { id, name, active, phones: Phone[] }`.
- `PhoneInput { serial, storage, color, battery, price, cost }`.
- `SaleItem { product_name, serial, storage, color, battery, price }`.
- `Cart = number[]` (phone ids).
- `PurchaseLine extends PhoneInput { product_id }`; `PurchaseLines = PurchaseLine[]`.
- `PurchaseItem { product_name, serial, storage, color, battery, cost,
  status: "in_stock" | "sold" | "removed" }`.
- `ProductReportRow { product_id, name, units, revenue, cost, profit }`.
- `MovementReason = "added" | "purchase" | "sale" | "removed"`.
- `MovementRow { id, created_at, product_name, serial, storage, color, change_qty, reason, cost_total,
  note, sale_id, purchase_id, supplier_name, user_name }`.

### 7.4 Shop command APIs

Fish (`src/shops/fish/api.ts`, on top of the shared API):

`list_categories`, `create_category(name, parentId)`, `update_category(id, name, parentId)`,
`delete_category(id)`, `list_products(includeInactive)`, `create_product(input, openingStockGrams)`,
`update_product(id, input)`, `delete_product(id)`, `restore_product(id)`,
`adjust_stock(productId, newGrams, note)`, `report_by_product(range)`,
`report_by_category(range)`, `report_movements(range, reason?)`.

Mobile (`src/shops/mobile/api.ts`, on top of the shared API):

`list_products(includeInactive)`, `create_product(name)`, `update_product(id, name)`,
`delete_product(id)`, `restore_product(id)`, `add_phones(productId, phones)`,
`update_phone(id, input)`, `remove_phone(id, note)`, `report_by_product(range)`,
`report_movements(range, reason?)`.

---

## 8. Data model

### 8.1 Fish schema (4 migrations, append-only)

`001` — users, categories, products, product_variants, sales, sale_items, stock_movements, settings,
indexes:

- `users(id, name, username UNIQUE NOCASE, password_hash, role CHECK admin/cashier, active DEFAULT 1,
  created_at)`.
- `categories(id, name, parent_id → categories ON DELETE RESTRICT, created_at)`.
- `products(id, name, category_id → categories RESTRICT, sell_by_weight DEFAULT 1, price_per_kg DEFAULT
  0, cost_per_kg DEFAULT 0, stock_grams DEFAULT 0, low_stock_grams DEFAULT 0, active DEFAULT 1,
  created_at, updated_at)`.
- `product_variants(id, product_id → products CASCADE, label, weight_grams, price, cost, active DEFAULT
  1, sort DEFAULT 0)`.
- `sales(id, user_id → users, created_at, total, cost_total, payment_method CHECK, paid, change_due)`.
- `sale_items(id, sale_id → sales CASCADE, product_id → products, variant_id, product_name,
  variant_label, quantity, weight_grams, unit_price, line_total, line_cost)`.
- `stock_movements(id, product_id → products, change_grams, reason CHECK sale/purchase/adjustment,
  cost_total, note, sale_id → sales, user_id → users, created_at)`.
- `settings(key PK, value)` seeded with shop name محل الأسماك, empty phone/address, footer
  "شكراً لزيارتكم", currency `ج.م`, `allow_negative_stock = 0`.
- Indexes on sales date, sale items (sale, product), movements date, products category.

`002` — suppliers, purchases, supplier_payments, `stock_movements.purchase_id`, indexes:

- `suppliers(id, name, phone DEFAULT '', note DEFAULT '', opening_balance DEFAULT 0, active DEFAULT 1,
  created_at)`.
- `purchases(id, supplier_id → suppliers, invoice_no DEFAULT '', total, note DEFAULT '', user_id →
  users, created_at)`.
- `supplier_payments(id, supplier_id → suppliers, purchase_id → purchases, amount CHECK > 0, note
  DEFAULT '', user_id → users, created_at)`.
- `ALTER stock_movements ADD purchase_id → purchases`; indexes on purchases/supplier/payment dates.

`003` — split payments:

- Creates `sales_new` without `payment_method`; copies all sales.
- Creates `sale_payments(id, sale_id → sales CASCADE, method CHECK cash/card/wallet, amount CHECK > 0)`.
- Inserts one row per old sale with `total > 0` using its old method and its whole (change-deducted)
  total.
- Drops `sales`, renames `sales_new` to `sales`, recreates the sales-date index, adds the payment index.

`004` — `expenses(id, amount CHECK > 0, reason CHECK non-blank, user_id → users, created_at)` and its
date index.

`005` — weights and prices in grams; `006` — the shared extras (`commands::extras::MIGRATION`).

`007` — discounts (`commands::sales::DISCOUNT_MIGRATION`, shared): `ALTER sales ADD discount DEFAULT 0
CHECK ≥ 0`, `discount_type CHECK fixed/percent` (null when none), `discount_value` (cents, or the whole
percent). `total` stays what was due; the subtotal is `total + discount`. Lines keep their full prices,
so per-product reports show sales before discounts; revenue and profit everywhere else are after them.

### 8.2 Mobile schema (3 migrations)

- `users` — same as fish.
- `products(id, name UNIQUE NOCASE, active DEFAULT 1, created_at, updated_at)`.
- `suppliers`, `purchases`, `supplier_payments` — same as fish.
- `phones(id, product_id → products, serial CHECK non-blank, storage DEFAULT '', color DEFAULT '',
  battery CHECK 1–100, price CHECK > 0, cost DEFAULT 0 CHECK ≥ 0, status DEFAULT 'in_stock' CHECK
  in_stock/sold/removed, purchase_id → purchases, created_at)`.
- `sales(id, user_id, created_at, total, cost_total, paid, change_due)`.
- `sale_payments` — same shape as fish.
- `sale_items(id, sale_id → sales CASCADE, phone_id → phones, product_id → products, product_name,
  serial, storage, color, battery, price, cost)`.
- `stock_movements(id, phone_id → phones, product_id → products, change_qty CHECK −1/1, reason CHECK
  added/purchase/sale/removed, cost_total, note, sale_id, purchase_id, user_id, created_at)`.
- `expenses` — same as fish.
- `settings` seeded with shop name محل الموبايلات and the same other defaults.
- Migration 2 adds the shared extras (accessories); migration 3 the shared discount columns, as fish `007`.
- Partial unique index `phones(serial COLLATE NOCASE) WHERE status = 'in_stock'`; indexes for phones
  (product/status, purchase), sales date, payments, sale items (sale/product), movements
  (date/purchase), purchases (date/supplier), payments supplier, expenses date.

### 8.3 Shared schema contract

`db::tests::has_the_shared_tables` requires, in every shop, these tables with at least the columns the
shared commands read:

| Table | Required columns |
| --- | --- |
| `users` | id, name, username, password_hash, role, active, created_at |
| `settings` | key, value |
| `suppliers` | id, name, phone, note, opening_balance, active, created_at |
| `purchases` | id, supplier_id, invoice_no, total, note, user_id, created_at |
| `supplier_payments` | id, supplier_id, purchase_id, amount, note, user_id, created_at |
| `sales` | id, user_id, created_at, total, cost_total, paid, change_due, discount, discount_type, discount_value |
| `sale_payments` | id, sale_id, method, amount |
| `sale_items` | id, sale_id, product_id |
| `products` | id, name |
| `stock_movements` | id, product_id, reason, cost_total, purchase_id, user_id, created_at |
| `expenses` | id, amount, reason, user_id, created_at |

Shops add their own columns/tables on top.

---

## 9. Fish shop — full behavior

### 9.1 Domain and validation

- A category has at most two levels. A category cannot be its own parent; a sub-category cannot be
  placed under another sub-category; a category with children cannot be moved; a category with
  children or products cannot be deleted.
- A product belongs to one category, active by default, with `sell_by_weight` and/or variants.
  Validation: name required; if not sold by weight, at least one variant; if sold by weight, price per
  kg > 0; price/cost/low-stock ≥ 0; every variant needs a label, weight > 0, price > 0, cost ≥ 0.
- Cashiers can list products but costs are returned as 0 (`hide_cost`).
- Creating a product and its opening stock are one transaction. Opening stock creates an `adjustment`
  movement with note "مخزون افتتاحي".
- Removing a variant from the form deactivates it (past sales reference it); it is not deleted.
- Products with sale items or stock movements are archived (`active = 0`); untouched products are
  deleted. `restore_product` reactivates.

### 9.2 Pricing and stock

- `price_for_grams(per_kg, grams) = (per_kg * grams + 500) / 1000`, integer division. The frontend
  uses `Math.floor` of the same expression, so cart preview equals receipt.
- Weight line: `quantity = 1`, `weight_grams = entered grams`, `unit_price = price_per_kg`,
  `line_total = price_for_grams(price_per_kg, grams)`, `line_cost` likewise from `cost_per_kg`.
- Variant line: `quantity` from the customer, `weight_grams = variant.weight × quantity`,
  `unit_price = variant.price`, `line_total = variant.price × quantity`, `line_cost = variant.cost ×
  quantity`.
- Stock needed is summed per product across lines. Unless `allow_negative_stock = 1`, each product's
  `stock_grams` must cover it; the error names the product and both weights.
- Recording inserts sale items, subtracts total grams per product, and writes one `sale` movement per
  product with `−grams`.
- Stock-take: setting a counted value inserts an `adjustment` movement for the difference (note
  optional, blank becomes null) and sets the stock; a zero difference is a no-op.

### 9.3 Purchases

- Lines: `{ product_id, grams, cost_total }` plus `update_cost`. Total = Σ cost; empty lines or
  non-positive grams / negative cost are refused.
- Recording inserts a `purchase` movement per line, adds grams to the product, and if `update_cost`
  and cost > 0 sets `cost_per_kg = round(cost × 1000 / grams)`.
- Removing an invoice subtracts the recorded grams per product, deletes the movements, then the
  shared purchase removal deletes payments and the invoice.
- Invoice line count = number of stock movements with that `purchase_id`; invoice units = sum of
  those movements.

### 9.4 UI specifics

- **Till.** Search by name; top-level category chips then sub-category chips; product tile shows
  category, name, available grams minus what is already in the cart, low/out state, price per kg or
  "starts from" the cheapest variant. Out-of-stock tiles are disabled unless negative stock is allowed.
  Cart line keys: `product:variant` (variants merge by quantity) and `product:w:<timestamp>` (weight
  lines do not merge). Variant lines use +/− quantity; weight lines have a remove button.
- **Add-item modal.** If a product is sold both ways, a segmented switch chooses fixed packs vs weight;
  otherwise the supported mode only. Fixed packs show label, weight and price, a quantity stepper and a
  price readout. Weight mode shows weight and price readouts, a decimal input limited to 3 decimals,
  and a keypad. It refuses more than available unless negative stock is allowed.
- **Products page.** Search, category filter (includes products in that category's sub-categories),
  "show archive" toggle. Columns: product, category path, sale modes (badges), kg price, kg cost,
  stock (red at/under the low threshold), actions. The form covers name, category, weight selling,
  prices, low-stock threshold, variants (label/kg/price/cost, add/remove), and opening stock on create.
- **Categories page.** Main categories with indented sub-categories, product counts, add sub only under
  a main category, edit, delete confirmation.
- **Stock page.** Filters all/low/out with counts, search, stock value at cost (negative stock valued at
  zero), low/out badges, "receive" (opens the purchase form pre-filled with the product), "stock-take".
  The stock-take modal shows the difference from the recorded value and a reason field.
- **Reports.** Products: category, sold weight, fixed-pack count, revenue, cost, profit, margin.
  Categories: optionally merge sub-categories into their parent. Stock: snapshot with totals. Movements:
  filter by reason; quantity colored, note falls back to invoice/purchase reference; shows the user.
- **Low stock:** `stock_grams > 0 && stock_grams <= low_stock_grams`. Out means `<= 0`.
- **Settings:** "allow selling without stock" writes `allow_negative_stock` as `"1"`/`"0"`.
- **Theme:** Readex Pro body, Lalezar display; page `#eef3f3`, surface `#f8fbfb`, line `#d5e0e1`,
  muted `#5e7880`, ink `#0f2b33`, pay `#f4c430`, ok `#2e7d6f`, danger `#c2413a`, chart `#1a7fb0`,
  readout `#0b2128` with `#9fe8e0`; tag yellow `#f4c430` / `#c99a0e`.
- **Login art:** dark sea panel, "سمك طازة" in display font and tag yellow, wave pattern, a line about
  selling by weight or fixed packs and stock deducting with each invoice.

---

## 10. Mobile shop — full behavior

### 10.1 Domain and validation

- Model names are unique, case-insensitive, trimmed; blank is refused; the SQLite unique violation is
  translated to "الموديل «…» موجود بالفعل".
- A phone requires a serial, sale price > 0, cost ≥ 0; battery, when present, must be 1–100.
- A serial must be unique among phones with `status = 'in_stock'` (case-insensitive). After a phone is
  sold or removed, its serial can be used again for a new row.
- A model with phones in stock cannot be deleted or archived; the error states how many. A model that
  ever had phones is archived, otherwise deleted.
- Cashiers can list models/phones but costs come back as 0.

### 10.2 Selling and stock

- Price: rejects an empty cart, duplicate ids, and unknown or non-`in_stock` phones; total = Σ phone
  price, cost = Σ phone cost.
- Record: snapshot the phone into `sale_items`, set `phones.status = 'sold'`, write a `-1` `sale`
  movement per phone.
- Add phones (no invoice): all-or-none batch, each inserts a phone plus a `+1` `added` movement with
  its cost.
- Add phones on an invoice: insert with `purchase_id`, reason `purchase`; cost is the invoice cost.
- Edit in-stock phone: validates; if the phone came from an invoice, its cost must equal the invoice
  cost; serial uniqueness excludes itself; updates the phone and the `added` movement's cost.
- Remove without selling: mandatory reason; sets `removed`, writes a `-1` `removed` movement.
- Purchase total = Σ phone cost. Removal is refused if any phone from the invoice is not `in_stock`;
  otherwise its movements and phones are deleted.
- Invoice line count = phones with that `purchase_id`; invoice units = sum of those phones' purchase
  movements.

### 10.3 UI specifics

- **Till.** Search matches model name, serial, storage and colour. Pressing Enter: an exact serial
  match adds that phone (or warns it is already in the cart); otherwise, if exactly one model is
  visible and has available phones, opens it. Brand chips use the first word of the model name. Models
  with available phones sort first. Phones already in the cart are excluded from the catalogue and the
  picker. Model card shows up to three storage chips (+N), price from the cheapest available phone,
  and stock bars: none when out, one red bar when one left, full when more than four, otherwise two.
  Picking a phone shows storage/colour, battery (red under 80%), serial and price.
- **Products page.** Columns: model, storages in stock, price range, in-stock count (clicking the row
  opens the model's phones), actions (add phones, rename, delete). Archived toggle. Creating a model
  can include phones; if model creation succeeds but phones fail, retry adds only the phones. Renaming
  does not rewrite old invoices. The model modal lists its phones with edit/take-out and can add more.
- **Phone forms.** A draft row keeps model id, serial, storage, colour, battery, cost and price as text.
  New rows copy the previous row's model/storage/colour/prices (serial and battery stay empty). Blank
  rows are skipped. Repeated serials in one form are flagged. Storage and colour have suggestion lists.
  Enter in the last serial field adds another row for barcode-scanner flow.
- **Stock page.** Rows are one per phone, with cost value, sale value and expected profit figures,
  search (serial/model/colour), model filter, edit/take-out, add phones, purchase invoice, print.
- **Reports.** Products: model, phones sold, revenue, cost, profit, margin. Stock: snapshot of every
  phone with cost and sale totals. Movements: per phone, filter by reason, quantity colored, note
  fallback, user.
- **Settings:** no extra shop section.
- **Theme:** IBM Plex Sans Arabic body, Alexandria display; page `#e8ebee`, surface `#f7f8fa`, line
  `#d4d9df`, muted `#66707c`, ink `#1a1d23`, pay `#34c759`, ok `#1f7a45`, danger `#d83a2f`, chart
  `#3d5afe`, readout `#050608` with `#f2f5fa`.
- **Login art:** graphite phone frame with a true-black lock screen, live time (updates every 10 s) and
  Arabic date, "نقطة بيع الموبايلات", plus a line about serial/storage/colour/battery and stock.
- **Readout:** rounded phone frame; size `md` hides the notch/status bar dot, larger sizes show it.

---

## 11. Settings, data locations and backup

- Shared keys: `shop_name`, `shop_phone`, `shop_address`, `receipt_footer`, `currency`. Fish adds
  `allow_negative_stock`; mobile adds none. Values are trimmed; unknown keys are rejected.
- Defaults: fish "محل الأسماك", mobile "محل الموبايلات"; empty phone/address; footer "شكراً لزيارتكم";
  currency `ج.م`; fish negative stock `0`.
- Data files (Tauri app data dir):
  - fish: `%APPDATA%\com.fishshop.pos\fish-pos.db`
  - mobile: `%APPDATA%\com.mobileshop.pos\phones.db`
- SQLite uses WAL. The backup command deletes the chosen target then runs `VACUUM INTO`, producing a
  standalone consistent copy.
- Automatic copies, in `backups/` next to the database (same disk): `<stem>-YYYY-MM-DD.db` once a
  day, newest 7 kept; `<stem>-before-update-YYYY-MM-DD-HHMMSS.db` before an update changes the
  database, newest 3 kept. Other files there are never touched.
- Old databases upgrade in place; the fixtures prove the upgrade path.
- Activation: `activation.txt` in the app data dir holds the PC's activation code. The device code is
  the first 10 bytes of SHA-256 of `<identifier>:<Windows MachineGuid>`, base32, as `XXXX-XXXX-XXXX-XXXX`.
  The activation code is the Ed25519 signature of that string, base32 in groups of five, made with
  `npm run activation-code <device code>` and the private key `%USERPROFILE%\.tauri\pos-activation.key`
  (public half in `src-tauri/src/activation.rs`). Losing the key means no new PC can be activated.
- Password reset: `reset.txt` in the app data dir holds a random value while a reset is pending. The
  reset code is the first 10 bytes of SHA-256 of `reset:<device code>:<that value>`, as
  `XXXX-XXXX-XXXX-XXXX`; the reply is the Ed25519 signature of `reset:<reset code>` with the same key,
  made with `npm run reset-code <reset code>`. Setting the password deletes `reset.txt`, so a reply
  works once, and only on the PC that showed its code. Without the key, a forgotten admin password
  can only be fixed by editing the database.

---

## 12. Build, configuration and tooling

### 12.1 npm

Scripts: `dev`, `build`, `web`, `typecheck`, `lint`, `test`, `test:watch`, `check`, `shops`,
`activation-code`, `reset-code`, `tauri` (see the table below).

| Script | Behavior |
| --- | --- |
| `dev <shop>` | `tauri dev --config src-tauri/shops/<shop>/tauri.conf.json --features <shop>` |
| `build <shop>` | Same with `build`; NSIS installer in `src-tauri/target/release/bundle/nsis/` |
| `web <shop>` | `vite --mode <shop>` (backend calls fail) |
| `typecheck [<shop>]` | Once: `tsc -p tsconfig.node.json`; per shop: `tsc -p tsconfig.<shop>.json` |
| `lint [<shop>]` | Once: `eslint .`; per shop: `cargo clippy … --features <shop> -- -D warnings` |
| `test [<shop>]` | Per shop: `vitest run --mode <shop>`, then `cargo test … --features <shop>` |
| `check [<shop>]` | typecheck, then lint, then test |
| `test:watch <shop>` | `vitest --mode <shop>` in watch mode |
| `shops` | `node scripts/shops.ts list` |
| `activation-code <device code>` | `node scripts/activation-code.ts`: prints the PC's activation code |
| `reset-code <reset code>` | `node scripts/activation-code.ts --reset`: prints the reply to a PC's reset code |

Dependencies (current ranges): fonts Alexandria/Readex Pro/IBM Plex Sans Arabic/Lalezar; Tauri API,
dialog, process, updater; lucide-react 1; React 19; react-router-dom 7; recharts 3; tailwind-merge 3.
Dev: ESLint 10, Tailwind CSS 4 + Vite plugin, Tauri CLI 2, types for Node 26/React 19, Vite 8,
Vitest 5, TypeScript 6, typescript-eslint 8.

`vite.config.ts`: React + Tailwind plugins; `@shop` from mode; `clearScreen: false`; dev port 1420
strict; HMR on 1421 when `TAURI_DEV_HOST` is set; ignores `src-tauri`; Vitest includes shared and the
mode's own tests.

### 12.2 TypeScript / ESLint / HTML

- `tsconfig`: ES2022, DOM, bundler resolution, strict, no unused locals/parameters, no fallthrough,
  isolated modules, no emit, react-jsx. Node project is composite and covers Vite/scripts/shops and activation tests.
- ESLint ignores `dist` and `src-tauri`; recommended JS + TS; React hooks recommended; React refresh
  warns except for `useSession`, `useToast`, `errorMessage`.
- `index.html`: `lang="ar" dir="rtl"`, full height; body `select-none bg-page font-sans text-ink
  tabular-nums antialiased print:bg-white`; `#root` print-hidden; `#print-root` hidden except print.

### 12.3 Rust / Tauri

- Package `pos` edition 2024; lib `pos_lib` (staticlib/cdylib/rlib); features `fish`, `mobile` (no
  default). Release: codegen-units 1, LTO, opt 3, panic abort, strip.
- Dependencies: tauri 2, dialog 2, serde 1 + derive, serde_json 1, rusqlite 0.32 bundled, argon2 0.5,
  rand_core 0.6 getrandom, chrono 0.4, updater 2, process 2, ed25519-dalek 2, sha2 0.10, machine-uid 0.5; Windows: webview2-com 0.39, windows 0.62
  (must match wry for PrintToPdf).
- Base Tauri config: product "POS", version 0.0.0, identifier `com.pos.template`; window 1366×820,
  min 1100×680, centered; CSP `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'
  data:; font-src 'self' data:`; bundle NSIS with default icons; updater public key and
  `installMode: "passive"`; dev URL 1420; frontend dist `../dist`; base build commands deliberately
  fail, telling you to pick a shop.
- Shop configs: fish product "Fish POS", version 0.3.1, `com.fishshop.pos`, window title "نقطة بيع
  الأسماك"; mobile product "Mobile POS", version 0.5.1, `com.mobileshop.pos`, title "نقطة بيع
  الموبايلات"; both 1366×820 / min 1100×680 / centered; build commands use `vite --mode <shop>` and
  `tsc -p tsconfig.<shop>.json && vite build --mode <shop>`.
- `release.conf.json`: `bundle.createUpdaterArtifacts = true`.
- Capabilities: `core:default`, `dialog:allow-save`, `dialog:allow-message`, `updater:default`,
  `process:allow-restart`.

### 12.4 Adding a shop (checklist)

1. Copy `src/shops/<base>`, `src-tauri/src/shops/<base>`, `src-tauri/shops/<base>`, `tests/<base>`,
   and `tsconfig.<base>.json` to the new name; replace the base name in the tsconfig (four places).
2. Add `<new> = []` to `[features]`; add the `#[cfg(feature = "<new>")] #[path = …] #[macro_use] mod
   shop;` block in `lib.rs`.
3. Set the shop config: product name, version (new), identifier (new, permanent), window title, build
   commands, update endpoint; set `DB_FILE` (new, permanent).
4. Rebuild the domain: new first migration with the shared tables + its own; `sales.rs`,
   `purchases.rs`, `reports.rs`, `testing.rs`, `shop_commands!`; delete `fixture_tests.rs` and its
   `mod` line. `db::tests::has_the_shared_tables` must pass.
5. Frontend: `index.ts`, `types.ts`, `api.ts`, `PosPage`, `Readout`, `ReceiptItems`, `LoginArt`,
   products/stock pages; define every theme token; keep Tailwind-only styling.
6. Tests: keep `tests/<new>/`; `npm run check <new>`; run `npm run check` before touching shared code.
7. Release per §14, starting at 0.1.0, and run the §15 smoke test first.

---

## 13. Tests and upgrade fixtures

### 13.1 Vitest

- `tests/format.test.ts` — money parsing to cents, Arabic digits/`٫`/`,`, invalid input, whole counts,
  amount formatting with commas, local date.
- `tests/updateState.test.ts` — check/found/none/download/progress/finish/failure transitions,
  progress events ignored outside a download, percent cap, status text, install only before sign-in.
- `tests/activation.test.ts` — RFC 4648 base32, device codes however typed and refusal of others,
  codes in groups of five that verify, and a pinned code for the test key (seed of 32 × `1`) that
  `src-tauri/src/activation.rs` also accepts; reset replies sign `reset:<code>` (never valid as an
  activation code), refuse bad codes, and a pinned reply the Rust test also accepts.
- `tests/reportTabs.test.ts` — shop sales tabs after invoices, stock tabs last, shop order preserved;
  filters keep/transform rows; empty value keeps all; no filter keeps all.
- `tests/shops.test.ts` — folder resolution and rejection of unknown/path modes; sorted shop list;
  exact command lists for typecheck/lint/test/check/dev/build/web; one-shop enforcement; release
  endpoint/tag rules; numeric latest version; relevant-change filtering (other shops/docs/tests/
  workflows excluded).
- `tests/fish/format.test.ts` — kg parsing to grams (Arabic), rejection; gram/kg display; price
  rounding parity.
- `tests/mobile/format.test.ts` — Arabic counting (1, 2, 3–10, 11+, 0); detail string omits missing
  parts.

### 13.2 Rust

Unit tests sit in the modules they test (sale split/change/short payment, fish weight rounding and
negative stock, mobile serial/duplicate/sold, purchases/supplier balance, reporting periods, schema,
migration, roles, backups, activation). Shared tests use `shop::testing` so they never know what a shop sells.

### 13.3 Fixtures

| File | Written by | `user_version` | Assertions |
| --- | --- | --- | --- |
| `fish-0.2.0.db` | fish 0.2.0 (`5a13245`) | 2 → 4 after upgrade | 4 sales, 5 items, totals 192,000 / cost 137,500 / change 6,500; cash/card/wallet 113,500 / 31,000 / 47,500; each sale's payments sum to its total; stock 28,000 / 3,250 / −1,000 g; balances 40,000 / 0; 2 purchases, 3 payments, 10 movements, 2 variants, 3 categories, 0 expenses; negative stock setting `1` |
| `mobile-0.4.0.db` | mobile 0.4.0 (`95afe6e`) | 1 | 3 sales, 4 items, totals 7,700,000 / cost 6,500,000 / change 50,000; cash/card/wallet 3,400,000 / 3,800,000 / 500,000; 5 payment rows; phones sold/removed/in-stock 4/1/1; `R3` absent; 11 movements; balances 1,600,000 / 0; 2 purchases, 3 payments, 2 expenses totaling 215,000, 2 users |

Rules: fixtures are committed fake data; tests open a copy; never edit or regenerate a fixture to make
a test pass. Regeneration (only if lost): worktree the old release tag, copy the seeder to
`src-tauri/src/seed.rs`, add `#[cfg(test)] mod seed;`, add Tauri's `test` dev-feature, replace
`build.rs` with `seeders/seed-build.rs`, place `seeders/test.manifest` next to `Cargo.toml`, run
`SEED_OUT=<db> cargo test --lib seed -- --ignored`. Dates are moved to Aug–Oct 2026 so period reports
have data.

---

## 14. Release and update pipeline

- Only manual releases. No checks on push. Local validation is `npm run check`.
- `.github/workflows/release.yml` is `workflow_dispatch` with required `shop` and `version` inputs
  (`gh workflow run release.yml -f shop=fish -f version=0.3.1`); the run is titled
  "Release <shop> <version>"; Windows runner;
  Node 24; `contents: write`; full history for tags.
- Steps: checkout → Node → `node scripts/shops.ts release "$SHOP" "$VERSION"` (writes `build`, `shop`, `version`,
  `tag`, `name` to `GITHUB_OUTPUT`) → when building: Rust + clippy, rust-cache keyed by shop, `npm ci`,
  `npm run check <shop>`, `tauri-apps/tauri-action` with shop config + release config + feature and
  signing secrets → download `latest.json` from the new release, create `<shop>-updates` if absent
  (`--latest=false`, "do not delete"), upload `latest.json` with `--clobber`.
- `release()` logic: resolve shop; read its config; list tags `<shop>-v*`; compare `HEAD` with the
  latest; if no relevant change, `build=false`; else reject a typed version that differs from the config, an endpoint that does not end with
  `/releases/download/<shop>-updates/latest.json` and reject an existing `<shop>-v<version>`. Release
  name = `<productName> <version>`; tag = `<shop>-v<version>`.
- `relevantChanges` excludes paths starting `docs/`, `tests/`, `.github/`, any `.md`, and other shops'
  `src/shops/<other>/`, `src-tauri/src/shops/<other>/`, `src-tauri/shops/<other>/`,
  `tsconfig.<other>.json`.
- Signing key: `%USERPROFILE%\.tauri\pos-updater.key` + password; secrets
  `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Losing it permanently blocks
  updates for installed apps.
- Installed apps check their own `<shop>-updates/latest.json`, verify the signature against the public
  key in the base config, download, install passively and restart. Before sign-in this happens by
  itself; once someone is signed in, an admin installs from the banner (or it happens on the next start).
- Never push a change to `.github/workflows/` while a release runs: GitHub then refuses to create the
  release (it would need a `workflows` permission the workflow token never has).

---

## 15. Manual smoke test (run per shop before release)

Use a copy of the shop fixture for upgrade checks and a fresh database for first-run checks.

**Every shop**

1. First run: empty DB asks to create the admin; the admin is signed in.
2. Login: a wrong password is refused with a message; admin and cashier both sign in.
3. Cashier limits: only sales + expenses in the sidebar; their receipt/expense lists show only their
   own today; reports/purchases/employees/settings are unreachable.
4. Cash sale: more cash than due → change on screen and receipt.
5. Split sale: card + wallet + cash → each method on the receipt; card+wallet over the total refused.
   Discount: 10% and then a fixed 50 each lower what is due and print a "خصم" line; 101% or more than
   the ticket is refused; the reports show the discounts in the summary, invoices and employees tabs.
6. Receipt: preview shows name, address, phone, items, totals, cashier, footer; print and PDF work.
7. Expenses: a cashier records one under their name; an admin sees it in reports.
8. Suppliers: add with opening balance, pay, statement and balance add up; credit shown correctly.
9. Purchase (partly paid): stock rises, supplier balance rises by the unpaid part; delete undoes both.
10. Reports: every tab opens for today, this month and a custom range; profit = sales − cost −
    expenses; full report and per-tab print/PDF work.
11. Employees: add a cashier, deactivate, sign-in refused; cannot delete the last admin.
12. Settings: rename the shop → sidebar and receipt follow; backup file opens.
13. Upgrade: a fixture copy opens with sales/suppliers/stock unchanged, and a
    `backups/…-before-update-….db` copy of it appears.
14. Activation (release build, fresh PC data): the device code shows; a wrong code is refused; the code
    from `npm run activation-code` activates and the app goes on to setup; restarting stays activated.
    Password reset: "نسيت كلمة مرور المدير؟" shows a reset code that survives a restart; a wrong reply is
    refused; the reply from `npm run reset-code` lists the admins, the new password signs in, and the
    same reply is refused afterwards.
15. Daily backup: after start, `backups/<db>-<today>.db` exists and opens.
16. Update: with an older version installed and a newer release published, opening the app installs it
    before sign-in and restarts on the new version with the data unchanged.

**Fish only**

- Sell by weight and by fixed pack; price follows the weight.
- Stock decreases in grams; low-stock warning at/under the threshold.
- Stock-take logs the counted difference.
- Over-stock sale refused unless the setting is on.
- Add a sub-category; products and the category report include it.
- Products with history archive and restore.
- A purchase invoice can set the cost per kg when asked.

**Mobile only**

- Add phones with serial/storage/colour/battery; duplicate in-stock serial refused; serial reusable
  after the phone leaves stock.
- Sell by scanning (Enter) and by picking a phone; sold phone cannot be sold again.
- Receipt prints each serial.
- Take a phone out with a reason; it leaves stock and appears in movements.
- Purchase invoice with a sold/removed phone cannot be deleted.
- Model with phones still in stock cannot be deleted.

---

## 16. History (former `docs/template-plan.md`)

Historical context only; the code wins where it differs.

The project began as separate fish and mobile apps. A staged merge produced this template:

| Phase | Goal | Result |
| --- | --- | --- |
| 0 | Safety net | Tagged old releases, seeded fixture DBs from old code, wrote the smoke test |
| 1 | One set of role colour names | Renamed tokens across shared components; moved CSS variables into shop themes |
| 2 | Shop switch skeleton | Vite `@shop` alias, Cargo features, per-shop Tauri config, `build.rs` guard |
| 3 | Backend split | Shared commands + shop modules and ordered migrations |
| 4 | Frontend split | Shared pages/components; shop pages and theme; mobile 0.5.0 released |
| 5 | Fish as shop #2 | Fish domain back in; migrations 3 (split payments) and 4 (expenses); fish 0.3.0 released |
| 6 | Tooling and CI | `scripts/shops.ts`, per-shop tsconfigs/tests, manual release workflow |
| 7 | Auto-update | Updater plugins, per-shop channels, signing, banner and settings |
| 8 | New-shop recipe | §12.4; proven with a throwaway shop that was removed |

Enduring rules from that work: shared code never names a shop; released migrations are append-only;
identifiers and DB files never change; behaviour stays stable while restructuring; each step ends
green for every shop and smoke-tested.

---

## 17. Small decisions and quirks worth preserving

These are easy to miss and easy to break:

- Cents everywhere; no floating-point money. Weight input is parsed to integer grams.
- Arabic-Indic digits and `٫`/`,` are accepted in inputs, but money is displayed with Western digits
  (`en-US`), grouped and 2-decimal.
- `parseDecimal` is non-negative only; fractional counts are rejected.
- All date ranges are inclusive local dates; `isoDate` deliberately avoids UTC.
- Session is memory-only; there is no "remember me".
- One SQLite connection behind a mutex; every write is serialized.
- WAL is enabled; foreign keys are off only during migrations and checked before commit.
- Migrations are plain SQL strings with `user_version`; no migration table.
- Hard result caps avoid giant reports: sales 1000, purchases 2000, movements 2000.
- Split sales are counted once per method in the payment breakdown; amounts still sum to revenue.
- Cash change is reflected in the cash payment row, but `sales.paid` keeps the handed-over total.
- The till's chosen method starts as the automatic "rest" method; typing into it cancels automation.
- Cash suggestions are rounded up to the next 50/100/200/500/1000.
- Receipts use the shop's item component; totals/payments/footer are shared.
- PDF export asks for a path first; printing uses the system dialog. Both wait for fonts.
- A receipt PDF measures the on-screen height at 96 dpi and adds a 0.1 in buffer.
- The daily chart fills missing days (max 400 points) and uses the shop's chart colour.
- Report period names are `dd/mm/yyyy`, Arabic month + year, or the year.
- Destructive actions protect history: archive/deactivate/refuse. This applies to users, suppliers,
  fish products, mobile models and mobile invoices.
- The last active admin can never be removed; you cannot demote or deactivate yourself.
- Cashier "today" limits are re-applied in Rust, even when the UI sends a wider range.
- Fish low-stock is only "low" when stock is positive and at/under the threshold; zero is "out".
- Fish stock value treats negative stock as zero.
- Fish variants are deactivated, never deleted; product names are not unique.
- Fish weight price rounds half up to the cent and the frontend mirrors it exactly.
- Fish `update_cost` defaults to on in the purchase form.
- Mobile brand = first whitespace-delimited word of the model name.
- Mobile search matches serial/storage/colour case-insensitively; serial scan is exact.
- Mobile phones in the cart are removed from the visible catalogue.
- Mobile stock bars: 0 out, 1 = one left (red), 2 = 2–4, 3 = more than 4.
- Mobile battery is optional; UI warns under 80%.
- Mobile invoice cost is immutable; editing other phone fields is allowed while in stock.
- Mobile serial uniqueness is partial (only in stock), by design.
- Phone forms copy the previous row's shared fields to speed bulk entry; Enter adds a row.
- Phone row blanks are skipped; duplicate serials in one form are flagged before saving.
- Fish purchase line editor groups products by "parent / child" category.
- Fish stock "receive" opens the shared purchase form with the product pre-selected.
- The supplier statement shows the running balance starting from the opening balance; only standalone
  payments can be deleted there.
- Settings save button activates only when values differ; the preview uses fixed sample data.
- The update banner checks once when the admin shell mounts and stays silent on a failed check; a
  manual check shows failures.
- The updater state machine ignores progress events outside a download.
- Base Tauri identity (`com.pos.template`, version 0.0.0, product "POS") is a template placeholder;
  only shop configs are shipped.
- Both shops currently use Tauri's default icons.
- Base build commands deliberately fail with "Pick a shop…".
- The base CSP allows inline styles (Tailwind/print) and data images/fonts.
- `index.html` disables text selection globally (cashier kiosk) but inputs are selectable.
- Fonts are bundled via `@fontsource`, not fetched at runtime.
- The `@shop` alias must point at an existing folder; `resolveShop` refuses path traversal and unknown
  modes by design.
- `tests/shops.test.ts` uses `docs/project-contract.md` only as an example path; it does not require
  the file to exist.
- `tsconfig.node.tsbuildinfo` is generated locally and ignored by git.
- `docs/` now contains only this contract.
- Activation is skipped in debug builds unless `POS_REQUIRE_ACTIVATION` is set; release builds always
  require it. Copying the database or installer to another PC needs that PC's own code.
- The daily backup thread looks every hour, so a shop left open overnight still gets one a day.

---

## 18. Verified deviations from the former docs

- Former snapshot: fish 0.2.0 (`5a13245`) and mobile 0.4.0 (`95afe6e`). Current: fish 0.3.0, mobile
  0.5.0.
- Former plan placed the one-shop `compile_error!` in `lib.rs`; the guard is `build.rs`.
- Former Phase 1 colour table is narrower than the implemented tokens; `theme.css` is authoritative.
- Former docs were plans; everything in this contract describes code that exists.
- The former guides are deleted; their instructions live in §12.4 and §15.

---

## 19. Change checklist (non-negotiable)

- [ ] Shared code contains no shop name or shop-specific branch.
- [ ] `@shop` / `crate::shop` usage still matches the interfaces in §4.
- [ ] No released migration edited or renumbered; new work appended.
- [ ] No shop `identifier` or `DB_FILE` changed.
- [ ] Money stayed integer cents; weights stayed integer grams.
- [ ] Cart pricing/stock changes still happen in Rust from the database, in one transaction.
- [ ] Role enforcement, including cashier own-today limits, still happens in Rust.
- [ ] Destructive actions still protect history (archive/deactivate/refuse).
- [ ] New settings keys registered in shared `KEYS` or `shop::SETTINGS_KEYS`.
- [ ] UI uses Tailwind utilities and existing role tokens only.
- [ ] The touched shop passes `npm run check <shop>`; shared changes pass `npm run check`.
- [ ] Fixtures still open and match their expected numbers.
- [ ] A release raises the shop version and keeps its `<shop>-updates` endpoint.
- [ ] The activation public key in `src-tauri/src/activation.rs` is unchanged (else every activated PC locks).
