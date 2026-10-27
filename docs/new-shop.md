# Adding a new shop

A shop is three folders and a few lines of wiring. Everything else (login, employees, suppliers,
purchases frame, expenses, payments, receipts frame, reports frame, settings, backup, printing,
auto-update) is shared and comes for free. Below, `<new>` is the new shop's name (lowercase letters,
digits and `-`, e.g. `bakery`) and `<base>` is the existing shop closest to it (`fish` sells by weight,
`mobile` sells one serial-numbered item per row).

## 1. Copy the closest shop

```sh
cp -r src/shops/<base>            src/shops/<new>
cp -r src-tauri/src/shops/<base>  src-tauri/src/shops/<new>
cp -r src-tauri/shops/<base>      src-tauri/shops/<new>
cp -r tests/<base>                tests/<new>
cp tsconfig.<base>.json           tsconfig.<new>.json
```

In `tsconfig.<new>.json`, replace `<base>` with `<new>` (4 places).

## 2. Wire the Rust shop in

- `src-tauri/Cargo.toml`, `[features]`: add `<new> = []`.
- `src-tauri/src/lib.rs`, next to the other shops:

  ```rust
  #[cfg(feature = "<new>")]
  #[path = "shops/<new>/mod.rs"]
  #[macro_use]
  mod shop;
  ```

`build.rs` finds the shops in `src-tauri/src/shops/` by itself and stops any build that has no shop
feature or more than one.

## 3. Give it its own identity

`src-tauri/shops/<new>/tauri.conf.json`, every field:

| Field                       | Value                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `productName`               | English name, e.g. `Bakery POS` (names the installer)                                    |
| `version`                   | `0.1.0`                                                                                  |
| `identifier`                | new and never changed again, e.g. `com.bakeryshop.pos` (where its data lives)            |
| `build.beforeDevCommand`    | `vite --mode <new>`                                                                      |
| `build.beforeBuildCommand`  | `tsc --noEmit -p tsconfig.<new>.json && vite build --mode <new>`                         |
| `app.windows[0].title`      | Arabic window title                                                                      |
| `plugins.updater.endpoints` | `["https://github.com/<owner>/<repo>/releases/download/<new>-updates/latest.json"]`      |
| `bundle.icon` (optional)    | own icons: `npx tauri icon logo.png -o src-tauri/shops/<new>/icons`, then list its files |

In `src-tauri/src/shops/<new>/mod.rs` set `DB_FILE` to a new file name (e.g. `"bakery.db"`). Never
change `identifier` or `DB_FILE` after the first install, or installed shops lose sight of their data.

## 4. Make it the new shop

Now change what the shop really is. The contract each side must keep is in
[template-plan.md](template-plan.md#the-shop-interface-the-contract-every-shop-implements):
`src/lib/shop.ts` for the screens, the `mod.rs` exports for the backend. The compiler and the shared
tests tell you when something is missing.

- **Database:** `migrations.rs` starts over for a new shop: one first migration that creates the shared
  tables (copy them from `<base>`'s migrations: users, settings, suppliers, purchases, supplier_payments,
  sales, sale_payments, sale_items, products, stock_movements, expenses) plus the shop's own.
  `db::tests::has_the_shared_tables` checks the shared ones. After the first release, only ever add
  migrations at the end; never edit or reorder a released one.
- **Backend:** `sales.rs` (what a cart is, its price, how a sale takes stock), `purchases.rs` (invoice
  lines), `reports.rs` (`UNITS_SOLD`, `MOVEMENT_UNITS` and any own reports), `testing.rs` (stock and
  lines the shared tests use), and the shop's own commands in `shop_commands!`. Delete `fixture_tests.rs`
  and its `mod` line: they test the base shop's old releases.
- **Frontend:** `index.ts` (title, menu, pages, units, report tabs), `types.ts` and `api.ts` (match the
  backend), `PosPage.tsx`, `Readout.tsx`, `ReceiptItems.tsx`, `LoginArt.tsx`, products/stock pages.
- **Look:** `theme.css` sets the fonts and the colour values; keep every role name (`ink`, `pay`,
  `readout`, …) and change only the values. Style with Tailwind classes only.
- **Tests:** keep `tests/<new>/` for the shop's own logic (formatting, prices).

## 5. Check it

```sh
npm run check <new>     # typecheck + lint + tests for this shop only
npm run dev <new>       # run it; go through docs/smoke-test.md
npm run check           # every shop, before committing a change to shared code
```

The release workflow takes the shop by its name.

## 6. Release it

1. Set `version` in `src-tauri/shops/<new>/tauri.conf.json`, commit, push.
2. `gh workflow run release.yml -f shop=<new>` (or Actions → Release → Run workflow).

The release workflow refuses a version that was already released or a wrong update address, then builds a
signed installer, publishes it as the GitHub release `<new>-v<version>`, and points the `<new>-updates`
channel at it. Every later
release with a higher version reaches installed copies through the in-app update banner.
