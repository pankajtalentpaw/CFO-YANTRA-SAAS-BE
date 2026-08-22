const Decimal = require("decimal.js");

// Configure Decimal with high precision suitable for strict financial accounting
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9,
  toExpPos: 28
});

function toDecimal(val) {
  if (val instanceof Decimal) {
    return val;
  }
  if (val === null || val === undefined || val === "") {
    return new Decimal(0);
  }
  return new Decimal(val);
}

function add(a, b) {
  return toDecimal(a).plus(toDecimal(b));
}

function subtract(a, b) {
  return toDecimal(a).minus(toDecimal(b));
}

function multiply(a, b) {
  return toDecimal(a).times(toDecimal(b));
}

function divide(a, b, decimalPlaces = 4) {
  const divisor = toDecimal(b);
  if (divisor.isZero()) {
    throw new Error("Division by zero in financial computation");
  }
  const result = toDecimal(a).dividedBy(divisor);
  return result.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
}

function compare(a, b) {
  return toDecimal(a).comparedTo(toDecimal(b));
}

function equals(a, b) {
  return toDecimal(a).equals(toDecimal(b));
}

function round(a, decimalPlaces = 2) {
  return toDecimal(a).toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
}

function formatFinancial(a, decimalPlaces = 2) {
  return toDecimal(a).toFixed(decimalPlaces);
}

function isZero(a) {
  return toDecimal(a).isZero();
}

function isPositive(a) {
  return toDecimal(a).isPositive() && !toDecimal(a).isZero();
}

function isNegative(a) {
  return toDecimal(a).isNegative();
}

function abs(a) {
  return toDecimal(a).abs();
}

function sum(items, selector = (x) => x) {
  if (!Array.isArray(items) || items.length === 0) {
    return new Decimal(0);
  }
  return items.reduce((acc, item) => acc.plus(toDecimal(selector(item))), new Decimal(0));
}

function toExactString(a) {
  return toDecimal(a).toString();
}

function toDecimalString(a, decimalPlaces = 2) {
  return formatFinancial(a, decimalPlaces);
}

module.exports = {
  Decimal,
  toDecimal,
  add,
  subtract,
  multiply,
  divide,
  compare,
  equals,
  round,
  formatFinancial,
  toDecimalString,
  isZero,
  isPositive,
  isNegative,
  abs,
  sum,
  toExactString
};
