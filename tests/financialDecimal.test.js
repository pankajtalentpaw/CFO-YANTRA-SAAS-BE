const {
  toDecimal,
  add,
  subtract,
  multiply,
  divide,
  compare,
  equals,
  round,
  formatFinancial,
  isZero,
  isPositive,
  isNegative,
  sum,
  toExactString
} = require("../src/utils/financialDecimal");

describe("Financial Decimal Utility", () => {
  test("avoids JavaScript floating point 0.1 + 0.2 error", () => {
    const result = add("0.1", "0.2");
    expect(toExactString(result)).toBe("0.3");
    expect(formatFinancial(result, 2)).toBe("0.30");
  });

  test("handles large monetary values without precision loss", () => {
    const amount1 = "987654321098765432.123456";
    const amount2 = "123456789012345678.987654";
    const result = add(amount1, amount2);
    expect(toExactString(result)).toBe("1111111110111111111.11111");
  });

  test("performs exact subtraction and negative value detection", () => {
    const res = subtract("100.50", "250.75");
    expect(toExactString(res)).toBe("-150.25");
    expect(isNegative(res)).toBe(true);
    expect(isPositive(res)).toBe(false);
  });

  test("performs multiplication and division correctly", () => {
    const mult = multiply("1250.50", "3");
    expect(toExactString(mult)).toBe("3751.5");

    const div = divide("1000", "3", 4);
    expect(toExactString(div)).toBe("333.3333");
  });

  test("throws on division by zero", () => {
    expect(() => divide("500", "0")).toThrow(/Division by zero/);
  });

  test("compares and checks equality properly", () => {
    expect(compare("100.00", "100")).toBe(0);
    expect(equals("100.00", "100")).toBe(true);
    expect(compare("200", "100")).toBe(1);
    expect(compare("50", "100")).toBe(-1);
  });

  test("rounds to specified decimal places with HALF_UP", () => {
    expect(formatFinancial(round("123.456", 2), 2)).toBe("123.46");
    expect(formatFinancial(round("123.454", 2), 2)).toBe("123.45");
    expect(formatFinancial(round("123.455", 2), 2)).toBe("123.46");
  });

  test("sums an array of monetary items with selector", () => {
    const vouchers = [
      { amount: "1500.50" },
      { amount: "2500.25" },
      { amount: "-500.00" }
    ];
    const total = sum(vouchers, (v) => v.amount);
    expect(toExactString(total)).toBe("3500.75");
  });

  test("correctly checks zero", () => {
    expect(isZero("0.00")).toBe(true);
    expect(isZero("0")).toBe(true);
    expect(isZero("0.000000000000000000000000000")).toBe(true);
    expect(isZero("0.01")).toBe(false);
  });
});
