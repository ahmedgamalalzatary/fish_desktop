import { describe, expect, it } from "vitest";
import {
  addPiece,
  changePieces,
  extrasTotal,
  inCategory,
  piecesLeft,
  toExtraLines,
  type Extra,
} from "../src/lib/extras";

const extra = (patch: Partial<Extra>): Extra => ({
  id: 1,
  name: "مياه",
  category_id: 10,
  category_name: "مياه",
  parent_category_id: 1,
  parent_category_name: "مشروبات",
  price: 500,
  cost: 300,
  track_stock: true,
  stock_qty: 2,
  low_stock_qty: 0,
  active: true,
  ...patch,
});

describe("extras on the ticket", () => {
  const water = extra({});
  const salad = extra({ id: 2, name: "سلطة", track_stock: false, stock_qty: 0, price: 2000 });

  it("a tap adds one piece, and the next tap adds to the same line", () => {
    const once = addPiece([], water, false);
    expect(addPiece(once, water, false)).toEqual([{ extra: water, quantity: 2 }]);
  });

  it("counted pieces stop at what is in stock, unless the shop sells below zero", () => {
    const two = addPiece(addPiece([], water, false), water, false);
    expect(addPiece(two, water, false)).toBe(two);
    expect(piecesLeft(water, two)).toBe(0);
    expect(addPiece(two, water, true)[0].quantity).toBe(3);
  });

  it("an item that is not counted can always be added", () => {
    const lines = addPiece(addPiece(addPiece([], salad, false), salad, false), salad, false);
    expect(lines[0].quantity).toBe(3);
    expect(piecesLeft(salad, lines)).toBe(Infinity);
  });

  it("minus takes a piece off and removes the line at zero", () => {
    const lines = addPiece(addPiece([], water, false), salad, false);
    expect(changePieces(lines, salad.id, -1)).toEqual([{ extra: water, quantity: 1 }]);
    expect(changePieces(lines, water.id, 1)[0].quantity).toBe(2);
  });

  it("totals the lines and sends only ids and quantities", () => {
    const lines = addPiece(addPiece(addPiece([], water, false), water, false), salad, false);
    expect(extrasTotal(lines)).toBe(500 * 2 + 2000);
    expect(toExtraLines(lines)).toEqual([
      { extra_id: 1, quantity: 2 },
      { extra_id: 2, quantity: 1 },
    ]);
  });
});

describe("inCategory", () => {
  const juice = extra({ category_id: 11, parent_category_id: 1 });
  const covers = extra({ category_id: 2, parent_category_id: null });

  it("a main category shows its own items and its sub categories' items", () => {
    expect(inCategory(juice, null, null)).toBe(true);
    expect(inCategory(juice, 1, null)).toBe(true);
    expect(inCategory(covers, 2, null)).toBe(true);
    expect(inCategory(covers, 1, null)).toBe(false);
  });

  it("a sub category shows only its own items", () => {
    expect(inCategory(juice, 1, 11)).toBe(true);
    expect(inCategory(juice, 1, 12)).toBe(false);
  });
});
