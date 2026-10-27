# POS — نقطة البيع

One codebase for the point-of-sale desktop apps of several shops (one device each, no branches), built
with **Tauri 2 + React + Tailwind + SQLite**. The interface is Arabic (RTL). Each shop is built as its
own app, with its own name, look, database and updates.

| Shop     | App                              | What it sells                                                    |
| -------- | -------------------------------- | ---------------------------------------------------------------- |
| `fish`   | Fish POS — نقطة بيع الأسماك      | fish by weight (per kg or fixed packs), with categories          |
| `mobile` | Mobile POS — نقطة بيع الموبايلات | phones, one row per device by serial (IMEI / S/N), no categories |

## What every shop has

- **Roles:** the admin (مدير) manages everything and can also sell; the cashier (كاشير) sees the sales
  screen and expenses, and reprints their own receipts from today. Roles are enforced in the Rust
  backend on every command, not only in the UI.
- **Sales:** pay with cash (with change), card or e-wallet, or a mix of them in one sale. Only cash can
  be over the total. 80 mm thermal receipt.
- **Purchases & suppliers:** a purchase invoice adds stock; pay in full, in part or on credit, and the
  unpaid part goes to the supplier's balance. Later payments, supplier statements, and deleting an
  invoice entered by mistake.
- **Expenses:** anyone signed in records an amount and a reason, booked under their name.
- **Reports:** summary with a daily chart, a profit statement (sales − cost − expenses) by day, month or
  year, receipts, employees, purchases, suppliers, expenses, current stock and stock movements, plus
  the shop's own (products, categories…), for any date range.
- **Print & PDF:** every report, sales list and receipt prints or saves as PDF (rendered by WebView2, so
  Arabic is shaped correctly).
- **Backup:** a one-click database copy from Settings.
- **Auto-update:** the app checks for a new version when it opens and an admin installs it with one
  click; the data stays as it is.

What only one shop has (products by weight and categories in fish, phones by serial in mobile) lives in
that shop's folder. On first launch, the app asks you to create the admin account.

## Development

Requirements: Node 24+, Rust (stable, MSVC), and the Visual Studio C++ Build Tools. WebView2 ships with
Windows 11.

```sh
npm install
npm run dev fish          # run a shop's desktop app with hot reload
```

Every task takes a shop name, or runs for every shop without one:

| Script                       | What it does                                              |
| ---------------------------- | --------------------------------------------------------- |
| `npm run dev <shop>`         | Desktop app in development mode                           |
| `npm run web <shop>`         | Frontend only, in a browser (backend calls will fail)     |
| `npm run build <shop>`       | Release build + Windows installer (NSIS)                  |
| `npm run typecheck [<shop>]` | TypeScript check                                          |
| `npm run lint [<shop>]`      | ESLint + `cargo clippy -D warnings`                       |
| `npm test [<shop>]`          | Vitest + `cargo test`                                     |
| `npm run check [<shop>]`     | typecheck + lint + test                                   |
| `npm run test:watch <shop>`  | Vitest in watch mode                                      |
| `npm run format`             | Prettier (width 110) + rustfmt; `format:check` only looks |
| `npm run shops`              | The shops there are                                       |

The installer is written to `src-tauri/target/release/bundle/nsis/`.

## Releasing

Nothing runs on GitHub by itself; check changes locally with `npm run check`. To release a shop, raise
`version` in `src-tauri/shops/<shop>/tauri.conf.json`, commit and push, then start the release for that
shop: on GitHub, Actions → Release → Run workflow, or

```sh
gh workflow run release.yml -f shop=fish
```

If nothing in that shop's app changed since its last release, nothing is built (other shops' folders,
docs, tests and workflows don't count). Otherwise GitHub checks the shop, builds a signed installer,
publishes it as the release `fish-v<version>`, and points the shop's update channel (the `fish-updates`
release) at it; installed copies then offer the update. A version that was already released is refused.

The update signing key is `%USERPROFILE%\.tauri\pos-updater.key` (password next to it); the repository
holds it as the secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep a
backup of it: without it, no installed shop can be updated again.

## Where data lives

| Shop     | Database                                 |
| -------- | ---------------------------------------- |
| `fish`   | `%APPDATA%\com.fishshop.pos\fish-pos.db` |
| `mobile` | `%APPDATA%\com.mobileshop.pos\phones.db` |

Money is stored as integer cents, so totals never drift from rounding. Each shop's database upgrades
itself in place; `tests/fixtures/` holds databases made by older releases to prove it.

## Project layout

```
src/                       shared frontend: pages, components (Tailwind), lib (api, formatting, printing)
  shops/<shop>/            the shop's own screens, types, theme and its entry in index.ts
src-tauri/
  src/commands/            shared backend commands
  src/shops/<shop>/        the shop's migrations, sales/purchase lines, own commands and reports
  shops/<shop>/            the shop's app config: name, identifier, version, window, update channel
tests/                     shared tests; tests/<shop>/ the shop's own; tests/fixtures/ old databases
docs/                      template-plan.md (how the template works), new-shop.md, smoke-test.md
```

To add a shop, follow [docs/new-shop.md](docs/new-shop.md).
