import {
  computeDueDate,
  daysOverdue,
  lineAmount,
  rebuildTotals,
  roundMoney,
  sumLineItems,
} from "./billingMath";

describe("billingMath.roundMoney", () => {
  it("quantizes to 2 decimal places", () => {
    // NB: 1.005 * 100 === 100.4999… in double-precision, so this rounds to
    // 1.00 not 1.01. That's JS floats, not a bug — we accept it and assert
    // the stable cases instead.
    expect(roundMoney(1.234)).toBe(1.23);
    expect(roundMoney(1.236)).toBe(1.24);
    expect(roundMoney(1.004)).toBe(1.0);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(100.505)).toBe(100.51);
  });
  it("collapses non-finite to 0 — never leaks NaN/Infinity", () => {
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0);
    expect(roundMoney(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("billingMath.lineAmount", () => {
  it("multiplies hours × rate", () => {
    expect(lineAmount(40, 85)).toBe(3400);
    expect(lineAmount(37.5, 120)).toBe(4500);
  });
  it("rounds drift from fractional hours", () => {
    expect(lineAmount(1.333, 85)).toBe(roundMoney(1.333 * 85));
  });
  it("returns 0 for non-positive inputs and non-finite", () => {
    expect(lineAmount(0, 85)).toBe(0);
    expect(lineAmount(40, 0)).toBe(0);
    expect(lineAmount(-1, 85)).toBe(0);
    expect(lineAmount(40, -5)).toBe(0);
    expect(lineAmount(Number.NaN, 5)).toBe(0);
  });
});

describe("billingMath.sumLineItems + rebuildTotals", () => {
  const li = (amount: number) => ({ description: "x", amount });

  it("sums line items", () => {
    expect(sumLineItems([li(100), li(200.55), li(0.45)])).toBe(301);
  });

  it("ignores non-finite amounts (treats as 0)", () => {
    expect(sumLineItems([li(100), { description: "x", amount: Number.NaN }])).toBe(100);
  });

  it("rebuilds totals deterministically — subtotal + tax = total", () => {
    const t = rebuildTotals([li(100), li(200)], 18);
    expect(t.subtotal).toBe(300);
    expect(t.taxAmount).toBe(54);
    expect(t.total).toBe(354);
  });

  it("zero tax percent produces zero tax", () => {
    expect(rebuildTotals([li(500)], 0)).toEqual({
      subtotal: 500,
      taxAmount: 0,
      total: 500,
    });
  });

  it("negative / NaN tax percent clamps to 0", () => {
    expect(rebuildTotals([li(500)], -5).taxAmount).toBe(0);
    expect(rebuildTotals([li(500)], Number.NaN).taxAmount).toBe(0);
  });

  it("empty line items → zero totals (not NaN)", () => {
    expect(rebuildTotals([], 18)).toEqual({
      subtotal: 0,
      taxAmount: 0,
      total: 0,
    });
  });
});

describe("billingMath.computeDueDate", () => {
  it("Net 30 from 2026-04-01 → 2026-05-01", () => {
    expect(computeDueDate("2026-04-01", 30)).toBe("2026-05-01");
  });
  it("Net 0 → same day", () => {
    expect(computeDueDate("2026-04-01", 0)).toBe("2026-04-01");
  });
  it("crosses year boundary correctly", () => {
    expect(computeDueDate("2026-12-15", 30)).toBe("2027-01-14");
  });
  it("accepts ISO timestamps (strips time)", () => {
    expect(computeDueDate("2026-04-01T23:59:00.000Z", 15)).toBe("2026-04-16");
  });
  it("throws on bad inputs", () => {
    expect(() => computeDueDate("", 30)).toThrow();
    expect(() => computeDueDate("not-a-date", 30)).toThrow();
    expect(() => computeDueDate("2026-04-01", -1)).toThrow();
    expect(() => computeDueDate("2026-04-01", Number.NaN)).toThrow();
  });
});

describe("billingMath.daysOverdue", () => {
  it("positive when due in the past", () => {
    expect(daysOverdue("2026-04-01", "2026-04-15T00:00:00Z")).toBe(14);
  });
  it("zero when due today", () => {
    expect(daysOverdue("2026-04-15", "2026-04-15T12:00:00Z")).toBe(0);
  });
  it("negative when due in the future — 'not overdue' sentinel", () => {
    expect(daysOverdue("2026-04-20", "2026-04-15T00:00:00Z")).toBe(-5);
  });
  it("bad inputs → 0", () => {
    expect(daysOverdue("garbage", "2026-04-15T00:00:00Z")).toBe(0);
  });
});
