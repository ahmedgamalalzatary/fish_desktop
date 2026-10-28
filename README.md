# POS — نقطة البيع

One codebase for the point-of-sale desktop apps of several shops (one device each, no branches), built
with **Tauri 2 + React + Tailwind + SQLite**. The interface is Arabic (RTL). Each shop is built as its
own app, with its own name, look, database and updates.

| Shop     | App                              | What it sells                                                    |
| -------- | -------------------------------- | ---------------------------------------------------------------- |
| `fish`   | Fish POS — نقطة بيع الأسماك      | fish by weight (per kg or fixed packs), with categories          |
| `mobile` | Mobile POS — نقطة بيع الموبايلات | phones, one row per device by serial (IMEI / S/N), no categories; sells on credit |

## What every shop has

- **Roles:** the admin (مدير) manages everything and can also sell; the cashier (كاشير) sees the sales
  screen and expenses, and reprints their own receipts from today. Roles are enforced in the Rust
  backend on every command, not only in the UI.
- **Sales:** pay with cash (with change), card or e-wallet, or a mix of them in one sale. Only cash can
  be over the total. Anyone selling can give a discount on the whole sale, a fixed amount (50 ج.م) or a
  percent (10%); it prints on the receipt and the reports show what was given, per invoice and per
  employee. 80 mm thermal receipt.
- **Purchases & suppliers:** a purchase invoice adds stock; pay in full, in part or on credit, and the
  unpaid part goes to the supplier's balance. Later payments, supplier statements, and deleting an
  invoice entered by mistake.
- **Expenses:** anyone signed in records an amount and a reason, booked under their name.
- **Reports:** summary with a daily chart, a profit statement (sales − cost − expenses) by day, month or
  year, receipts, employees, purchases, suppliers, expenses, current stock and stock movements, plus
  the shop's own (products, categories…), for any date range.
- **Print & PDF:** every report, sales list and receipt prints or saves as PDF (rendered by WebView2, so
  Arabic is shaped correctly).
- **Backups:** a copy of the database every day (the last 7 are kept) and one before every update (the
  last 3), in a `backups` folder next to the database, plus a one-click copy anywhere from Settings.
- **Auto-update:** when the app opens it installs any new version by itself before anyone signs in, then
  restarts; once someone is working, an admin sees a banner instead. The data stays as it is.
- **Activation:** a new PC shows a device code and works only after the owner's activation code for it.
  A code is good on that one PC, for that one shop, forever.
- **Forgotten admin password:** the sign-in screen gives a one-time reset code for that PC; your reply to
  it lets the shop set a new admin password.

What only one shop has (products by weight and categories in fish, phones by serial in mobile) lives in
that shop's folder.

**Selling on credit (mobile):** at checkout, "بيع آجل" lets the customer pay part now, with one method or
several, and owe the rest; the cashier takes their name and phone (a known phone fills the name). The
**Customers** page, open to cashiers too, shows what each customer owes, on which invoices, what they
bought, when and from whom, and takes later payments (25,000 = 15,000 + 5,000 + 5,000), each with one
method or several. The whole sale counts as revenue on its day; the reports add what is still owed, what
was collected, and a tab of the sales on credit. The engine is shared (`src-tauri/src/commands/credit.rs`);
a shop turns it on with `CREDIT_SALES` in its Rust module and `creditSales` in its `index.ts`. On first launch, the app asks you to create the admin account.

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
| `npm run shops`              | The shops there are                                       |

The installer is written to `src-tauri/target/release/bundle/nsis/`.

## Releasing

Nothing runs on GitHub by itself; check changes locally with `npm run check`. To release a shop, raise
`version` in `src-tauri/shops/<shop>/tauri.conf.json`, commit and push, then start the release for that
shop: on GitHub, Actions → Release → Run workflow, or

```sh
gh workflow run release.yml -f shop=fish -f version=0.3.1
```

If nothing in that shop's app changed since its last release, nothing is built (other shops' folders,
docs, tests and workflows don't count). Otherwise GitHub checks the shop, builds a signed installer,
publishes it as the release `fish-v<version>`, and points the shop's update channel (the `fish-updates`
release) at it; installed copies then offer the update. A version that was already released is refused.

The update signing key is `%USERPROFILE%\.tauri\pos-updater.key` (password next to it); the repository
holds it as the secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep a
backup of it: without it, no installed shop can be updated again.

## Activating a shop's PC

On first start the app shows a **device code** (e.g. `64RU-S3TU-FVO6-DQUJ`). The shop sends it to you;
you make its activation code and send that back to paste into the app:

```sh
npm run activation-code 64RU-S3TU-FVO6-DQUJ
```

The activation code is your signature of the device code. The app holds only the public half of the key,
so it can check codes but never make them. A code works only on the PC (Windows machine id) and shop it
was made for, and the app checks the saved code again on every start, so copying the app's files to
another PC doesn't carry the activation. Codes use the letters A–Z and digits 2–7 only: an `O` is always
the letter, never zero.

This needs the private key `%USERPROFILE%\.tauri\pos-activation.key`. Back it up next to the update key:
without it no new PC can be activated and no admin password can be reset. Development builds skip
activation (set `POS_REQUIRE_ACTIVATION=1` to try it).

## Resetting a forgotten password

- **An employee forgot:** an admin sets a new password for them in **Employees**.
- **The admin forgot:** on the sign-in screen they press **نسيت كلمة مرور المدير؟**, which shows a
  **reset code** for that PC. The shop sends it to you; you send back the reply:

  ```sh
  npm run reset-code 7KQW-M2XA-PL4D-6ZRT
  ```

  They paste the reply, choose the admin account (it lists names and usernames, so a forgotten username
  is found too) and set a new password, which signs them in.

A reply works once, only on the PC that showed the code; the next reset gets a new code. The reset code
stays the same until it is used, so the app may be closed while waiting for your reply. It is signed
differently from activation codes, so neither works in place of the other.

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
docs/project-contract.md   the full project contract: behaviour, architecture, schema, release, smoke test
```

To add a shop, follow [docs/project-contract.md](docs/project-contract.md#12-build-configuration-and-tooling)
(section 12.4).
