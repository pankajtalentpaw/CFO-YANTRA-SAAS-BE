"""
Financial Decimal Arithmetic Utility.
Strictly configured for 28-digit arbitrary precision and ROUND_HALF_UP rounding,
matching src/utils/financialDecimal.js verbatim.
"""

import decimal
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Callable, Iterable, List, Optional, Union

# Set global context explicitly
FINANCIAL_CONTEXT = decimal.Context(prec=28, rounding=ROUND_HALF_UP)
decimal.setcontext(FINANCIAL_CONTEXT)

NumericType = Union[Decimal, int, float, str, None]

def to_decimal(val: NumericType) -> Decimal:
    """Safely converts input to 28-precision Decimal."""
    if isinstance(val, Decimal):
        return val
    if val is None or val == "":
        return Decimal("0")
    if isinstance(val, float):
        # Convert via str representation to prevent IEEE 754 binary floating-point drift
        return Decimal(str(val))
    try:
        return Decimal(str(val).strip())
    except (decimal.InvalidOperation, TypeError):
        return Decimal("0")

def add(a: NumericType, b: NumericType) -> Decimal:
    """Calculates a + b with 28-digit precision."""
    return to_decimal(a) + to_decimal(b)

def subtract(a: NumericType, b: NumericType) -> Decimal:
    """Calculates a - b with 28-digit precision."""
    return to_decimal(a) - to_decimal(b)

def multiply(a: NumericType, b: NumericType) -> Decimal:
    """Calculates a * b with 28-digit precision."""
    return to_decimal(a) * to_decimal(b)

def divide(a: NumericType, b: NumericType, decimal_places: int = 4) -> Decimal:
    """
    Calculates a / b rounded to decimal_places using ROUND_HALF_UP.
    Raises ValueError on division by zero matching Node.js Error message.
    """
    divisor = to_decimal(b)
    if divisor.is_zero():
        raise ValueError("Division by zero in financial computation")
    result = to_decimal(a) / divisor
    return round_decimal(result, decimal_places)

def compare(a: NumericType, b: NumericType) -> int:
    """Returns -1 if a < b, 0 if a == b, 1 if a > b."""
    dec_a = to_decimal(a)
    dec_b = to_decimal(b)
    if dec_a < dec_b:
        return -1
    elif dec_a > dec_b:
        return 1
    return 0

def equals(a: NumericType, b: NumericType) -> bool:
    """Checks if a == b."""
    return to_decimal(a) == to_decimal(b)

def round_decimal(a: NumericType, decimal_places: int = 2) -> Decimal:
    """Rounds using strictly ROUND_HALF_UP to specified decimal places."""
    dec = to_decimal(a)
    q = Decimal("10") ** -decimal_places
    return dec.quantize(q, rounding=ROUND_HALF_UP)

def format_financial(a: NumericType, decimal_places: int = 2) -> str:
    """Returns standard fixed string representation with decimal_places."""
    return f"{round_decimal(a, decimal_places):.{decimal_places}f}"

def is_zero(a: NumericType) -> bool:
    """Returns True if a == 0."""
    return to_decimal(a).is_zero()

def is_positive(a: NumericType) -> bool:
    """Returns True if a > 0."""
    dec = to_decimal(a)
    return dec > 0

def is_negative(a: NumericType) -> bool:
    """Returns True if a < 0."""
    dec = to_decimal(a)
    return dec < 0

def abs_decimal(a: NumericType) -> Decimal:
    """Returns absolute value of a."""
    return abs(to_decimal(a))

def sum_decimals(items: Optional[Iterable[Any]], selector: Callable[[Any], NumericType] = lambda x: x) -> Decimal:
    """Sums items using selector with arbitrary precision Decimal accumulator."""
    if not items:
        return Decimal("0")
    total = Decimal("0")
    for item in items:
        total += to_decimal(selector(item))
    return total

def to_exact_string(a: NumericType) -> str:
    """Returns unquantized full-precision string."""
    return str(to_decimal(a))

def to_decimal_string(a: NumericType, decimal_places: int = 2) -> str:
    """Alias for format_financial."""
    return format_financial(a, decimal_places)
