# Plan: turn the POS into a reusable multi-shop template

One codebase, many shops. Everything every shop needs (login, employees, suppliers, expenses, payments,
backup, printing, auto-update…) is written once. Each shop (fish, mobile, and future ones) only keeps the
part that is truly its own: what a "product" is, how stock is counted, how the sale screen picks items,
and its look.

```
npm run dev fish      npm run build fish      →  Fish POS installer
npm run dev mobile    npm run build mobile    →  Mobile POS installer
npm run check                                 →  typecheck + lint + tests for every shop
```

## Where we start (state on 2026-10-27)

| Branch        | Commit    | What it is                                                               |
| ------------- | --------- | ------------------------------------------------------------------------ |
| `main`        | `5a13245` | Fish shop, Release 0.2.0                                                 |
| `fish-shop`   | `5a13245` | Same as `main`                                                           |
| `mobile-shop` | `95afe6e` | Mobile shop, Release 0.4.0 (has expenses, split payments, profit report) |

Facts from reading both branches that shape this plan:

- The app is small: ~8,400 lines (fish) and ~9,400 lines (mobile), frontend + backend.
- Already identical in both: `auth.rs`, `users.rs`, `suppliers.rs`, `pdf.rs`, `error.rs`, `state.rs`,
  `ExportButtons.tsx`, `print.tsx`, `session.tsx`, `useResource.ts`, `document.ts`, `cx.ts`.
- Many "different" shared files differ **only by colour token names**: fish `mist / frost / gill / kelp /
tag / lcd`, mobile `dim / glass / alert / ok / charge / screen`. `DataTable.tsx`, `toast.tsx`,
  `EmployeesPage.tsx` differ by 4 lines each, `ReportDocument.tsx` by 2, most of `ui.tsx` likewise.
- Truly shop-specific: the product/stock schema, `sale_items`, the cart, the products/stock pages,
  the purchase-invoice lines, the item-level reports, and the totals readout (`Lcd` vs `Screen`).
- Installed shops must upgrade in place. Fish stores `fish-pos.db` (2 migrations, `user_version = 2`),
  mobile stores `phones.db` (1 migration). Neither database may be recreated or renumbered. No real shop
  data is on the dev machine, so upgrades are tested against **fixture databases built by the old code**
  (Phase 0).
- Mobile's `db.rs` `migrate()` is better than fish's (foreign keys off while migrating + a
  `foreign_key_check` before commit). That becomes the shared one.
- Mobile commit `e7fa5fd` contains a tested migration that moves `sales.payment_method` into
  `sale_payments`. Fish needs exactly that migration; reuse it.

## Target layout

```
src/                              shared frontend (stays where it is today)
  components/  lib/  pages/       login, employees, expenses, settings, suppliers, receipts frame,
                                  checkout/payments, reports frame, ui kit, update banner
  shops/
    fish/                         index.ts (the shop's interface), theme.css, pages, cart, readout…
    mobile/
src-tauri/
  src/
    commands/                     shared commands
    db.rs                         shared migration runner + shared SQL pieces
    shops/
      fish/   mod.rs …            products by weight, categories, stock-takes, fish sale lines
      mobile/ mod.rs …            phones by serial, take-out, phone sale lines
  tauri.conf.json                 shared base config
  shops/fish/tauri.conf.json      name, identifier, version, icons, window title, update URL
  shops/mobile/tauri.conf.json
```

How a build picks a shop (no extra tools needed, works on Windows):

- **Frontend:** `vite --mode fish`. `vite.config.ts` reads `mode` and points the alias `@shop` at
  `src/shops/fish`. Shared code imports shop parts only through `@shop`.
- **Backend:** Cargo feature `fish` / `mobile`. `lib.rs` does
  `#[cfg(feature = "fish")] #[path = "shops/fish/mod.rs"] mod shop;` and a `compile_error!` when zero or
  two shop features are on.
- **Config:** `tauri dev|build --config src-tauri/shops/fish/tauri.conf.json --features fish`. The shop
  config overrides `productName`, `identifier`, `version`, window title, icons and
  `build.beforeDevCommand` / `beforeBuildCommand` (`vite --mode fish`, `tsc && vite build --mode fish`).

## The rules (read before every phase)

1. **Shared code never mentions a shop.** It talks to the shop only through the shop interface
   (`crate::shop` in Rust, `@shop` in TS). No `if fish … else …` anywhere.
2. **Never edit a released migration, never renumber.** Each shop owns its ordered migration list.
3. **Each shop keeps its own database file and app identifier** (`fish-pos.db` + `com.fishshop.pos`,
   `phones.db` + `com.mobileshop.pos`), so installed shops upgrade in place.
4. **Behaviour stays the same** while restructuring (Phases 1–4). Feature work waits until after.
5. Every phase ends with `npm run check` green for **every** shop, a manual smoke test, a commit, a push.
6. Tailwind utilities only (no custom CSS classes / `@apply`); format touched files at width 110.

## The shop interface (the contract every shop implements)

### Rust: `src-tauri/src/shops/<shop>/mod.rs` exports

| Item                                                                  | Used by                 | Fish                      | Mobile                  |
| --------------------------------------------------------------------- | ----------------------- | ------------------------- | ----------------------- |
| `DB_FILE: &str`                                                       | `lib.rs`                | `"fish-pos.db"`           | `"phones.db"`           |
| `MIGRATIONS: &[&str]`                                                 | `db::open`              | legacy 1–2 + new ones     | legacy 1 + new ones     |
| `SETTINGS_KEYS: &[&str]` (extra keys)                                 | `settings.rs`           | `allow_negative_stock`    | none                    |
| `sales::{Cart, Priced { total, cost }, price(), record()}`            | `commands/sales.rs`     | weight + variants, grams  | phone ids               |
| `sales::{SaleItem, load_items()}`                                     | receipt                 | name, label, grams, price | name, serial, storage…  |
| `purchases::{Lines, total(), record(), PurchaseItem, load_items()}`   | `commands/purchases.rs` | grams per product         | one row per phone       |
| `purchases::{ITEMS_COUNT_SQL, remove()}`                              | purchases list, delete  | lines on the invoice      | phones, refused if sold |
| `reports::{UNITS_SOLD, MOVEMENT_UNITS}` (SQL over `i` / `m`)          | `commands/reports.rs`   | `i.weight_grams`, grams   | `1`, `m.change_qty`     |
| `shop_commands!` (its own commands)                                   | `lib.rs`                | categories, stock, …      | models, phones, reports |
| `testing::{ITEM_UNITS, cart_worth(), lines_costing(), stock_units()}` | shared tests            | grams                     | phones                  |

Migrations stay a plain ordered list per shop, so released ones are never renumbered. What the shared
commands need from any shop's schema is pinned by `db::tests::has_the_shared_tables` (users, settings,
suppliers, purchases, supplier payments, sales, sale payments, sale items, products, stock movements,
expenses), so a shop that forgets a shared table fails its tests. The shared tests never touch a shop's
own tables; they get stock to sell and lines to buy from `shop::testing`.

### TypeScript: `src/shops/<shop>/`

`index.ts` exports `shop`, checked against the `Shop` interface in `src/lib/shop.ts`:

| Field                                                      | Used by                             |
| ---------------------------------------------------------- | ----------------------------------- |
| `title`, `tagline`, `LoginArt`                             | window title, `LoginPage.tsx`       |
| `navItems`, `adminRoutes`, `PosPage`                       | `Shell.tsx`, `App.tsx`              |
| `Readout` (totals display: `Lcd` / phone screen)           | till, checkout, purchases, reports  |
| `ReceiptItems`, `sampleSale`                               | `Receipt.tsx`, settings preview     |
| `units` (noun, product, per-unit price, format, count)     | purchases list, reports wording     |
| `usePurchaseLines()`, `purchaseItemColumns()`              | `PurchasesPage.tsx` form and detail |
| `reportTabs` (`reportTab(...)`, placed "sales" or "stock") | `ReportsPage.tsx`, full report      |

Next to it: `types.ts` (must export `SaleItem`, `Cart`, `PurchaseLine`, `PurchaseItem`, which the shared
types import through `@shop/types`), `api.ts` (the shared `api` plus the shop's commands), `theme.css`
(fonts and colour values, imported by `src/index.css`). The till uses the shared `CheckoutModal`,
`ReceiptModal`, `TodaySalesModal` and `PaymentPicker` from `src/components/Checkout.tsx`.

Shop modules import shared code that imports `@shop` back, so shared code reads `shop` only inside
components and functions, and shop files never import `@shop` themselves.

---

## Phase 0 — Safety net · size: S · risk: low

**Goal:** nothing we do later can lose code or customer data.

**Scope**

- Tag the current releases: `fish-v0.2.0` on `5a13245`, `mobile-v0.4.0` on `95afe6e`; push tags.
- Create branch `template` from `mobile-shop`. All of Phases 1–4 happen there.
- Build **fixture databases with the old code** — these are the upgrade tests for Phases 3 and 5:
  - On a throwaway branch from `fish-shop` (fish 0.2.0), add a `#[test] #[ignore]` seeder that calls the
    real command functions (`insert_*`, not raw SQL) to fill a DB: 3 users, nested categories, products by
    weight and with fixed-weight variants, 2 suppliers with opening balances, purchase invoices (paid,
    partial, unpaid), supplier payments, a stock adjustment, ~50 sales over 3 months using all three
    payment methods with cash change, weight sales and variant sales, one negative-stock sale
    (`allow_negative_stock = 1`). Run it once, save the file as `tests/fixtures/fish-0.2.0.db`.
  - Same on a throwaway branch from `mobile-shop` (mobile 0.4.0) → `tests/fixtures/mobile-0.4.0.db`:
    models, phones added directly and via invoices, sold / in-stock / taken-out phones, split payments,
    expenses, supplier payments, a deleted purchase.
  - The numbers that must survive (row counts, sum of `sales.total`, payments per method, each supplier
    balance, stock per product) are worked out **by hand** from the scenario, written in
    `tests/fixtures/README.md`, and asserted as literals: by the seeder against the old code, and by the
    upgrade tests against the new code. Fixtures are fake data, so they are committed with the seeder
    sources (`tests/fixtures/seeders/`). The throwaway branches are not merged.
  - If a shop ever sends a real backup (Settings → backup), also test against it, kept **outside the
    repo**.
- Write down a manual smoke test per shop (`docs/smoke-test.md`): login, sell, split payment, receipt,
  purchase invoice, supplier payment, expense, each report tab, backup.

**Done when:** tags pushed, `template` branch exists, both fixture DBs + README numbers + upgrade test committed,
smoke test written.

---

## Phase 1 — Same colour names everywhere · size: S · risk: low

**Goal:** shared components look different per shop only through theme values, not class names.

**Scope**

- Pick role names and map both shops to them:

  | Role token        | Mobile today   | Fish today  |
  | ----------------- | -------------- | ----------- |
  | `page`            | `alu`          | `ice`       |
  | `surface`         | `glass`        | `frost`     |
  | `line`            | `line`         | `line`      |
  | `muted`           | `dim`          | `mist`      |
  | `ink`, `ink-2/3`  | same           | same        |
  | `pay`, `pay-deep` | `charge…`      | `tag…`      |
  | `ok`, `ok-soft`   | `ok…`          | `kelp…`     |
  | `danger(-soft)`   | `alert…`       | `gill…`     |
  | `chart`           | `chart`        | `sea`       |
  | `readout(-ink)`   | `screen…`      | `lcd…`      |
  | `font-display`    | `font-display` | `font-sign` |

- Rename the classes across `src/` on `template` (mechanical search & replace; keep `ink*`, `line`).
- Move the `@theme` block and font imports from `src/index.css` into `src/shops/mobile/theme.css`.
  `index.css` keeps only `@import "tailwindcss";` and shared bits.
- Write the fish mapping (right column) into `docs/` now so Phase 5 can apply it.

**Done when:** no old token names left (`grep` is empty), app looks identical, `npm run check` green.

---

## Phase 2 — Shop switch skeleton · size: M · risk: medium

**Goal:** the build can choose a shop. Only `mobile` exists yet; it must behave exactly as before.

### Slice 2a — Build plumbing

- `vite.config.ts`: `defineConfig(({ mode }) => …)`, alias `@shop` → `src/shops/${mode}`; fail fast if
  the folder does not exist. Add the alias to `tsconfig.json` `paths` (point it at mobile for editors;
  type-check each shop in CI via `tsc -p` per shop or a `SHOP`-aware tsconfig).
- `Cargo.toml`: `[features] fish = [] mobile = []`, no default. Rename package/lib to neutral
  `pos` / `pos_lib` (update `main.rs`).
- `src-tauri/shops/mobile/tauri.conf.json` with the current mobile name, identifier, version, title,
  icons and `vite --mode mobile` commands. Base `tauri.conf.json` keeps only shared settings.
- `package.json` scripts: `dev:mobile`, `build:mobile`, `check:mobile`; `check` runs every shop. Rename
  package to `pos`.
- Icons: both shops still ship Tauri's default logo, so `src-tauri/icons/` stays the shared default. A shop with
  its own icons sets `bundle.icon` in its config to `shops/<shop>/icons/…`.

### Slice 2b — Empty shop modules wired in

- `src-tauri/src/shops/mobile/mod.rs` with `DB_FILE` and the `compile_error!` guard in `lib.rs`.
  `lib.rs` opens `shop::DB_FILE` instead of the hard-coded `"phones.db"`.
- `src/shops/mobile/index.ts` exporting `shop`, `LoginArt` (move `LockScreen` out of `LoginPage.tsx`),
  `Readout` (move `Screen` out of `ui.tsx`), `navItems` (move the list out of `Shell.tsx`).

**Done when:** `npm run dev:mobile` opens the same app on the same `phones.db` with all data; installer
from `build:mobile` installs over 0.4.0 and keeps data.

---

## Phase 3 — Backend split · size: L · risk: high (data)

**Goal:** shared Rust code no longer knows about phones. Mobile still behaves exactly the same.

### Slice 3a — Migrations framework

- `db.rs`: `open(path)` runs `shop::MIGRATIONS` with the mobile `migrate()` logic kept as is.
- Shared table SQL as constants. For mobile, the existing single migration stays **byte-for-byte** as
  `mobile:001_initial` (it already contains the shared tables); later shared tables are appended.
- Test: every shop list contains all required core ids; a fresh DB migrates; **a copy of
  `tests/fixtures/mobile-0.4.0.db` opens and still matches the README numbers**.

### Slice 3b — Settings

- `settings.rs` accepts `KEYS` + `shop::SETTINGS_KEYS`.

### Slice 3c — Sales

- `sales.rs` keeps: `PaymentInput`, `Payment`, `settle()`, sale header insert, `sale_payments`,
  `get_sale`, `list_sales`, all payment tests.
- Shop provides: `Cart`, `price(tx, &cart) -> Priced { total, cost, .. }`,
  `record(tx, sale_id, user_id, ts, &priced)` (lines + stock + movements), `SaleItem`, `load_items()`.
- `create_sale(items: shop::Cart, payments)`. Phone tests move to `shops/mobile/`.

### Slice 3d — Purchases

- `purchases.rs` keeps: header, supplier active check, paid ≤ total, supplier payment, list/get summary,
  delete flow. Shop provides line input, total, writing lines, loading items, the delete guard
  ("a phone from this invoice was sold"), and the items-count SQL.

### Slice 3e — Reports

- Shared: summary (money parts), daily, periods/profit, cashiers, suppliers, expenses. Units come from
  `shop::reports::UNITS_SOLD` / `MOVEMENT_UNITS`.
- Shop-only: `report_by_product`, `report_movements` (+ fish later: `report_by_category`).

### Slice 3f — Commands registration

- Core macro builds `tauri::generate_handler![…shared…, $(shop extras)]`; each shop passes its list.
  If `generate_handler!` refuses paths passed through `macro_rules!`, fall back to each shop listing the
  full set, guarded by a test that the shared names are all present.
- Move `phones.rs`, `products.rs` into `src-tauri/src/shops/mobile/`.

**Done when:** `cargo test --features mobile` and clippy green; the mobile fixture opens with all
history; smoke test passes.

---

## Phase 4 — Frontend split · size: L · risk: medium

**Goal:** shared pages no longer know about phones. Mobile looks and works exactly the same.

### Slice 4a — Types and API

- `lib/types.ts` keeps shared types (users, suppliers, payments, sale header, expenses, reports, settings).
  Phone types move to `shops/mobile/types.ts`; `Sale` becomes generic over the item type.
- `lib/api.ts` keeps shared calls; phone/product calls move to `shops/mobile/api.ts`.
- `format.ts`: `formatPhones`, `phoneDetails`, `movementLabels` move to the shop.

### Slice 4b — POS page

- Shared: page frame, cart total, `CheckoutModal` (split payments, note suggestions), `ReceiptModal`,
  `TodaySalesModal`.
- Shop: `PosCatalog` (product grid, brand chips, pick-a-phone modal) and `cartToSale()`.

### Slice 4c — Receipt, purchases, reports

- `Receipt.tsx`: shared header, totals, payments, footer; items from `@shop` `ReceiptItems`.
- `PurchasesPage.tsx` (1,066 lines): suppliers tab, payments, statement stay shared; invoice form lines
  (`PhoneLines`) and item columns come from `@shop`.
- `ReportsPage.tsx`: shared tabs (summary, profit, sales, cashiers, purchases, suppliers, expenses) +
  `reportTabs` from `@shop` (products, stock, movements).

### Slice 4d — Shop pages and routes

- `ProductsPage`, `StockPage`, `PhoneModals`, `PhoneLines`, `lib/phones.ts`, `lib/stock.tsx` move to
  `src/shops/mobile/`. `App.tsx` adds `routes` from `@shop`.

**Done when:** `grep -ri "phone\|serial" src --exclude-dir=shops` finds nothing phone-specific; smoke test
passes; release **mobile 0.5.0** from `template` (same features, new structure) and install it over 0.4.0.

**Then:** make `template` the new `main` (force-move `main` to it; `fish-shop` keeps the old fish code).

---

## Phase 5 — Bring fish in as shop #2 · size: L · risk: high (data)

**Goal:** fish builds from the same codebase, keeps all its data, and gains expenses, split payments and
the profit report.

### Slice 5a — Fish backend

- From `fish-shop`: categories, products by weight + variants, stock adjust (stock-takes), fish sale
  lines (`price_for_grams`, `allow_negative_stock`), purchase lines in grams, product/category/movement
  reports. Put them in `src-tauri/src/shops/fish/` behind the shop interface.
- Fish keeps its own sale-item columns (`quantity`, `weight_grams`, `unit_price`, `line_total`,
  `line_cost`); shared reports read money from `sales` and units from `UNITS_SOLD`.

### Slice 5b — Fish migrations (the dangerous part)

- `fish:001` and `fish:002` = today's two fish migrations, byte-for-byte.
- `fish:003` = `sale_payments`: rebuild `sales` without `payment_method` and copy each old sale into
  `sale_payments` (reuse the migration from commit `e7fa5fd`).
- `fish:004` = `expenses`.
- Test on a copy of **`tests/fixtures/fish-0.2.0.db`**: opens, `user_version = 4`, matches the README
  numbers, every sale has payments that add up to its total, stock unchanged.

### Slice 5c — Fish frontend

- `src/shops/fish/`: theme (old fish colours under the new role names, Readex Pro + Lalezar), `Lcd`
  readout, login art, `PosCatalog` with weight/variant `AddItemModal`, `ReceiptItems` with weights,
  Products / Categories / Stock pages, `CategorySelect`, purchase lines in kg, report tabs (products,
  categories, stock, movements).
- `src-tauri/shops/fish/tauri.conf.json` with `Fish POS`, `com.fishshop.pos`, its icons.

**Done when:** `npm run check` green for both shops; fish smoke test passes on the fixture; release
**fish 0.3.0** and install it over an installed 0.2.0 that has the fixture data.

---

## Phase 6 — Tooling and CI · size: M · risk: low

**Goal:** one command checks every shop, and a release builds itself when asked for.

### Slice 6a — Local checks

- `scripts/shops.ts` runs a task for every shop in `src/shops/`, or for one:
  `npm run check` / `npm run check fish`, `npm run dev mobile`, `npm run build fish`, `npm run web fish`
  (frontend only). The commands each task runs live in `taskCommands()` in `shops.ts`, tested in
  `tests/shops.test.ts`; no script names a shop.
- Each shop has `tsconfig.<shop>.json` (shared folders + its own); `tsconfig.json` is the editor's view
  (mobile). `vitest --mode <shop>` runs the shared tests plus `tests/<shop>/`.
- `npm run format` / `format:check` use width 110 on the source folders only.

### Slice 6b — GitHub Actions

- No checks run on push: the owner chose GitHub to build only the releases they ask for (2026-10-27).
  Changes are checked locally with `npm run check`.
- `.github/workflows/release.yml`, on a tag `<shop>-v<version>`: `node scripts/shops.ts release <tag>`
  refuses a tag whose version differs from the shop's config, then checks the shop and builds it with
  `tauri-apps/tauri-action`, attaching the NSIS installer to a GitHub release for that tag.

**Done when:** `npm run check` covers every shop; pushing a tag produces an installer.

---

## Phase 7 — Auto-update (first shared feature) · size: M · risk: medium

**Goal:** proof that a shared feature is written once and every shop gets it.

### Slice 7a — Backend and signing

- `tauri-plugin-updater` and `tauri-plugin-process` in `lib.rs`; `updater:default` and
  `process:allow-restart` in `capabilities/default.json`.
- The signing key was generated once (`tauri signer generate`) and lives outside the repo in
  `%USERPROFILE%\.tauri\pos-updater.key` (+ `.password.txt`). Its public key is in the base config with
  `installMode: passive`. Back the private key up: without it no installed shop can ever be updated again.
- `src-tauri/release.conf.json` turns on `createUpdaterArtifacts`; only release builds pass it, so a
  plain `npm run build <shop>` still works without the key.

### Slice 7b — Update channel per shop

- Each shop config sets `plugins.updater.endpoints` to
  `…/releases/download/<shop>-updates/latest.json`; `releaseProblems()` refuses a release tag when it
  doesn't, or when the version differs.
- `release.yml` signs the build (secrets `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`)
  and copies the new `latest.json` to the fixed release `<shop>-updates` (created on first use).

### Slice 7c — UI

- `UpdateBanner` (`src/components/Updates.tsx`) in `Shell.tsx`, admins only: checks once on start, stays
  quiet when offline, offers "تحديث وإعادة التشغيل" with download progress.
- Settings → "التحديثات": current version, a manual check and install.
- The steps live in `src/lib/updateState.ts` (tested); `src/lib/updater.ts` drives the plugin.

**Done when:** an installed fish 0.3.0 updates itself to 0.3.1, and mobile likewise, from one code change.

---

## Phase 8 — New-shop recipe · size: S · risk: low

**Goal:** adding shop #3 is a checklist, not a project.

- [`docs/new-shop.md`](new-shop.md): copy the closest shop's four folders and tsconfig, wire the Cargo
  feature and one `cfg` block in `lib.rs`, set the shop's identity (name, identifier, DB file, update
  channel, icons), then make it the new shop and check it. The scripts and the release workflow find it by itself.
- `build.rs` lists the shops and stops a build with no shop feature or more than one, so a new shop
  doesn't touch any other shop's lines.
- `README.md` describes the template, the scripts, releasing and where each shop keeps its data.

**Done when:** someone following only the doc can create a dummy shop that builds and passes `check`.
Done on 2026-10-27 with a throwaway `demo` shop copied from `mobile`: `npm run check demo` and
`vite build --mode demo` passed (after making the fixture test helpers optional), then it was removed.

---

## Order and effort

| Phase | What                 | Size | Risk        | Rough time       |
| ----- | -------------------- | ---- | ----------- | ---------------- |
| 0     | Safety net           | S    | low         | under an hour    |
| 1     | Same colour names    | S    | low         | 1–2 hours        |
| 2     | Shop switch skeleton | M    | medium      | half a day       |
| 3     | Backend split        | L    | high (data) | 1–2 days         |
| 4     | Frontend split       | L    | medium      | 1–2 days         |
| 5     | Fish as shop #2      | L    | high (data) | 2–3 days         |
| 6     | Tooling and CI       | M    | low         | half a day       |
| 7     | Auto-update          | M    | medium      | half a day–1 day |
| 8     | New-shop recipe      | S    | low         | 1–2 hours        |

Phases run in order. Phase 6 can start any time after Phase 2. No new features before Phase 5 is done,
so the move never mixes with feature changes.
