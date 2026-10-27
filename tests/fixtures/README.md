# Upgrade fixtures

Databases written by **released** versions of each shop, used to prove that a new version opens an
installed shop's database without losing anything. They hold made-up data, so they are committed.

| File              | Written by               | `user_version` | Checked by                                    |
| ----------------- | ------------------------ | -------------- | --------------------------------------------- |
| `mobile-0.4.0.db` | mobile 0.4.0 (`95afe6e`) | 1              | `src-tauri/src/shops/mobile/fixture_tests.rs` |
| `fish-0.2.0.db`   | fish 0.2.0 (`5a13245`)   | 2              | `src-tauri/src/shops/fish/fixture_tests.rs`   |

Never edit or regenerate a fixture to make a test pass. A fixture stands for a database that already
exists on a customer's machine.

Tests open a **copy** (`open_copy`), so the committed file is never migrated in place.

## Mobile 0.4.0 scenario

Money in cents. Users: `admin` (أحمد, id 1) and cashier `sara` (سارة, id 2).

- Models: 1 iPhone 15, 2 Samsung Galaxy S24, 3 Redmi Note 13.
- Suppliers: 1 مورد الأجهزة, opening balance 100,000; 2 مورد شاومي, opening 0.
- Added without an invoice (model 1): phone 1 `I1` price 3,000,000 cost 2,600,000; phone 2 `I2` price
  3,200,000 cost 2,800,000.
- Invoice 1, supplier 1, paid 3,000,000 of 5,000,000: phones 3 `G1`, 4 `G2` (model 2), cost 2,500,000 each.
- Invoice 2, supplier 2, paid in full 1,400,000: phones 5 `R1`, 6 `R2` (model 3), cost 700,000 each.
- Invoice 3, supplier 2: phone `R3`, then the invoice was deleted (phone and invoice gone).
- Payment to supplier 1: 500,000.
- Sale 1 (admin): `I1`, cash 3,050,000 handed over → total 3,000,000, change 50,000.
- `I2` taken out of stock ("شاشة مكسورة").
- Sale 2 (sara): `G1`, card 2,000,000 + wallet 500,000 + cash 400,000 → total 2,900,000, no change.
- Sale 3 (admin): `R1` + `R2`, card 1,800,000.
- Expenses: 200,000 rent (admin), 15,000 electricity (sara).

Expected after opening:

| What                               | Value                                   |
| ---------------------------------- | --------------------------------------- |
| sales / sale_items / sale_payments | 3 / 4 / 5                               |
| sum of totals / costs / change     | 7,700,000 / 6,500,000 / 50,000          |
| paid by cash / card / wallet       | 3,400,000 / 3,800,000 / 500,000         |
| phones sold / removed / in stock   | 4 / 1 / 1 (`R3` absent)                 |
| stock movements                    | 11 (2 added, 4 purchase, 4 sale, 1 out) |
| supplier balances 1 / 2            | 1,600,000 / 0                           |
| purchases / supplier payments      | 2 / 3                                   |
| expenses (count / sum), users      | 2 / 215,000, 2                          |

## Fish 0.2.0 scenario

Money in cents, weights in grams. Users as above.

- Categories: 1 أسماك, 2 أسماك نهرية (inside 1), 3 مأكولات بحرية.
- Product 1 بلطي (category 2): by weight only, 9,000/kg, cost 6,000/kg, opening stock 10,000 g.
- Product 2 جمبري (category 3): by weight 30,000/kg, cost 22,000/kg, and variant 1 "نصف كيلو" 500 g,
  price 15,500, cost 11,000.
- Product 3 كابوريا (category 3): variant 2 "علبة كيلو" only, 1,000 g, price 25,000, cost 18,000.
- Suppliers: 1 مورد السمك opening 50,000; 2 مورد البحر opening 0.
- Invoice 1, supplier 1: 20,000 g of بلطي for 120,000, paid 100,000.
- Invoice 2, supplier 2: 5,000 g جمبري for 110,000 + 4,000 g كابوريا for 72,000, paid in full 182,000.
- Invoice 3, supplier 2: 1,000 g جمبري, then deleted (its stock taken back).
- Payment to supplier 1: 30,000. Stock-take: بلطي 30,000 g counted as 29,500 g ("تالف").
- Sale 1 (admin): 1,500 g بلطي = 13,500 (cost 9,000), cash 20,000 → change 6,500.
- Sale 2 (sara): 2 × نصف كيلو = 31,000 (cost 22,000), card.
- Sale 3 (admin): 1 علبة كابوريا 25,000 (cost 18,000) + 750 g جمبري 22,500 (cost 16,500), wallet.
- `allow_negative_stock` turned on, then Sale 4 (admin): 4 علب كابوريا with 3 in stock = 100,000
  (cost 72,000), cash 100,000.

Expected after opening (and after moving `payment_method` into `sale_payments`):

| What                                    | Value                     |
| --------------------------------------- | ------------------------- |
| sales / sale_items                      | 4 / 5                     |
| sum of totals / costs / change          | 192,000 / 137,500 / 6,500 |
| paid by cash / card / wallet            | 113,500 / 31,000 / 47,500 |
| stock بلطي / جمبري / كابوريا (g)        | 28,000 / 3,250 / −1,000   |
| supplier balances 1 / 2                 | 40,000 / 0                |
| purchases / supplier payments           | 2 / 3                     |
| stock movements / variants / categories | 10 / 2 / 3                |
| setting `allow_negative_stock`          | `1`                       |

## Regenerating (only if a fixture is lost)

The seeders in `seeders/` drive the old release's real commands through tauri's mock runtime.

1. `git worktree add <dir> mobile-v0.4.0` (or `fish-v0.2.0`).
2. Copy the seeder to `src-tauri/src/seed.rs` and add `#[cfg(test)] mod seed;` to `lib.rs`.
3. Add `[dev-dependencies] tauri = { version = "2", features = ["test"] }` to `Cargo.toml`.
4. Replace `build.rs` with `seeders/seed-build.rs` and put `seeders/test.manifest` next to `Cargo.toml`.
   Without it Windows refuses to start the test binary (`STATUS_ENTRYPOINT_NOT_FOUND`).
5. `SEED_OUT=<path to the .db> cargo test --lib seed -- --ignored`.

Dates are moved into August–October 2026 at the end, so day/month reports have something to group.
