# Sales & Purchase Analysis — Calculation Reference

[![Precision](https://img.shields.io/badge/Arithmetic-decimal.js-blue.svg)](https://mikemcl.github.io/decimal.js/)
[![Source](https://img.shields.io/badge/Source-Voucher%20Register-green.svg)]()
[![Mode](https://img.shields.io/badge/Access-Read--Only-lightgrey.svg)]()

Every figure the **Sales Analysis** and **Purchase Analysis** pages report, written out
exactly as the code computes it.

**Source of truth**

| Concern | File | Function |
| :--- | :--- | :--- |
| Sales aggregation | `src/services/companyData.service.js` | `getSalesAnalysis()` |
| Purchase aggregation | `src/services/companyData.service.js` | `getPurchaseAnalysis()` |
| Voucher class resolution | `src/services/companyData.service.js` | `getVoucherTypeResolver()` |
| Geography resolution | `src/services/companyData.service.js` | `getPartyProfileResolver()` |
| Amount parsing | `src/integrations/tally/sales/salesVoucher.canonical.js` | `toSignedAmount()` |

All monetary arithmetic runs on `decimal.js`. No floating-point math appears anywhere in
this chain.

---

## 📐 Pipeline

Both pages run the same seven stages over one voucher register. Order matters — the sign
is decided before anything is accumulated, and line filters are applied before invoices
are counted.

| # | Stage | What happens |
| :--- | :--- | :--- |
| 1 | **Read the register** | Voucher register *with* ledger and inventory entries. Served from the local MongoDB mirror when it holds the period, otherwise extracted live from TallyPrime. |
| 2 | **Resolve voucher class** | Each custom voucher type is walked up its parent chain to a Tally core class, then keyword-matched as a fallback. |
| 3 | **Select in-scope vouchers** | Drop cancelled and optional vouchers; keep only the classes belonging to this side of the ledger. |
| 4 | **Apply filters** | Voucher-grain filters select whole invoices; line-grain filters select stock lines and drop any invoice left with none. |
| 5 | **Assign the sign** | Returns become negative. Stored amounts are magnitudes, so the sign is re-derived from the voucher class. |
| 6 | **Accumulate** | One pass builds the totals, the month/party/item/state/city buckets, and one detail row per stock line. |
| 7 | **Rank and return** | Each bucket is sorted by value, leaders are taken, the remainder is reported as a single "other" figure. |

---

## 🏷️ Voucher Class Resolution

Tally stores the company's own voucher name — `TAX INVOICE`, `Domestic Sales` — not the
core class. Everything downstream keys off the **resolved** class, so this step decides
which side of the ledger a voucher lands on.

### Step 1 — walk the parent chain (max 5 hops, cycle-guarded)

```
name := lower(trim(voucherType))

repeat up to 5 times:
    if parentMap[name] exists and parentMap[name] != name:
        name := parentMap[name]
    else:
        stop
```

Live examples from the connected companies:

```
"TAX INVOICE"       -> "export sales"
"Domestic Sales"    -> "export sales"
"PROFORMA INVOICE"  -> "export sales"
"Delivery Challan"  -> "delivery note"
```

### Step 2 — keyword fallback on the resolved name

```
contains "credit note" | "cr note" | "sales return"     -> credit note
contains "debit note"  | "dr note" | "purchase return"  -> debit note
contains "purchase"    | "grn"     | "goods receipt"    -> purchase
contains "sale" | "invoice" | "bill" | "tax inv"        -> sales
otherwise                                               -> the resolved name
```

`"export sales"` contains `"sale"`, so it resolves to `sales`.

### Admitted classes

| Page | Admitted | Deliberately excluded |
| :--- | :--- | :--- |
| **Sales** | `sales`, `credit note` | `debit note` — a purchase-side return |
| **Purchase** | `purchase`, `debit note` | `credit note` — a sales-side return |

Including the opposite side's return document would inflate the figures, so each set is
closed.

---

## 🔍 Scope & Filters

### Inclusion test

```
include voucher iff
       not isCancelled
  and  not isOptional
  and  class(voucherType) in AdmittedClasses
```

### Two filter grains

Voucher-grain filters keep or drop a whole invoice. Line-grain filters cut into the
invoice's stock lines, and an invoice with no surviving line leaves the set entirely — so
the invoice count and the item breakdown always describe the same sales.

```
// voucher grain - whole invoice in or out
customer / supplier : partyLedgerName == selected
country             : party.country   == selected
state               : (party.state ?? "(no state)") == selected
city                : (party.city  ?? "(no city)")  == selected

// line grain - only when a product or search term is set
wantsLineFilter := product or search

keep line iff  (not product or line.stockItemName == product)
          and  (not search  or needle in lower(any of:
                    voucherNumber, partyLedgerName, stockItemName,
                    country, state, city))

drop voucher iff  wantsLineFilter and surviving lines == 0
```

Filter dropdown options are collected from the **period alone**, never from the narrowed
set, so choosing one filter can never make the others disappear.

### Geography

None of it lives on the voucher — it is read off the **party ledger**. Country and state
are discrete Tally fields taken verbatim; city has no field of its own and is parsed out
of the free-text address, carrying a confidence that travels with the bucket. Nothing is
guessed.

```
country := ledger.country                   // verbatim, else "(no country)"
state   := ledger.address.stateName         // verbatim, else "(no state)"
city    := parseCity(address.lines, state)  // heuristic + confidence
                                            // else "(no city)"
```

---

## ➕➖ The Sign Convention

This is the hinge of the whole calculation.

The mirror stores every amount as a **magnitude**. The parser strips Tally's Dr/Cr
direction into a separate `amountIsCredit` flag which **the analysis never reads** — the
sign is re-derived from the voucher class instead.

### At the parser — direction discarded, magnitude kept

```
magnitude      := abs(parseFloat(text))
isCredit       := text ends with "Cr" or text starts with "-"

stored amount  := abs(signed)     // ALWAYS POSITIVE
amountIsCredit := signed < 0      // kept, but unused by analysis
```

### At the analysis — sign re-derived from class

```
// SALES
isSalesReturn := class == "credit note"
sign          := isSalesReturn ? -1 : +1

// PURCHASE
isPurchaseReturn := class == "debit note"
sign             := isPurchaseReturn ? -1 : +1

// applied identically to the voucher total and to every stock line
amount     := sign * abs(voucher.amount)
lineAmount := sign * abs(line.amount)
quantity   := sign * line.quantity
```

| Class | Page | Sign | Effect on the net figure |
| :--- | :--- | :---: | :--- |
| `sales` | Sales | `+1` | Adds to gross sales |
| `credit note` | Sales | `-1` | Sales return — reduces net sales |
| `purchase` | Purchase | `+1` | Adds to gross purchases |
| `debit note` | Purchase | `-1` | Purchase return — reduces net purchases |

---

## 💰 The Totals

Two money columns are reported and **never mixed**:

- **`invoicedValue`** — the voucher total. What the customer was billed, tax included.
- **`itemValue`** — the sum of the stock lines. Excludes tax, because tax sits on the
  voucher, not on the line.

They do not add up to each other, and the gap between them is reported as its own figure.

### Sales

| Field | Formula |
| :--- | :--- |
| `invoicedValue` | `SUM(sign * abs(voucher.amount))` — **net sales** |
| `grossSalesValue` | `SUM(abs(voucher.amount))` where **not** a return |
| `salesReturnsValue` | `SUM(abs(voucher.amount))` where **is** a return (positive magnitude) |
| `itemValue` | `SUM(sign * abs(line.amount))` over every stock line — **ex-tax** |
| `taxAndCharges` | `abs(invoicedValue - itemValue)` — GST + freight, rounding, etc. |
| `itemQuantity` | `SUM(sign * line.quantity)`, 3 decimal places |
| `invoiceCount` | `count(vouchers that are not credit notes)` |
| `creditNoteCount` | `totalVouchers - invoiceCount` |
| `averageInvoiceValue` | `invoiceCount > 0 ? invoicedValue / invoiceCount : "0.00"` |
| `customerCount` | distinct party names |
| `itemCount` | distinct stock item names |
| `vouchersWithoutItems` | `count(vouchers with 0 lines)` |

### Purchase

| Field | Formula |
| :--- | :--- |
| `invoicedValue` | `SUM(sign * abs(voucher.amount))` — **net purchases** |
| `grossPurchasesValue` | `SUM(abs(voucher.amount))` where **not** a return |
| `purchaseReturnsValue` | `SUM(abs(voucher.amount))` where **is** a return (positive magnitude) |
| `itemValue` | `SUM(sign * abs(line.amount))` over every stock line — **ex-tax** |
| `itcApprox` | `abs(invoicedValue - itemValue)` — input tax credit + overheads |
| `itemQuantity` | `SUM(sign * line.quantity)`, 3 decimal places |
| `invoiceCount` | `count(vouchers that are not debit notes)` |
| `debitNoteCount` | `totalVouchers - invoiceCount` |
| `averageInvoiceValue` | `invoiceCount > 0 ? invoicedValue / invoiceCount : "0.00"` |
| `supplierCount` | distinct party names |
| `itemCount` | distinct stock item names |
| `vouchersWithoutItems` | `count(vouchers with 0 lines)` |

### Identities that must hold

```
invoicedValue == grossValue - returnsValue
invoicedValue == itemValue  + taxAndCharges   // sales
invoicedValue == itemValue  + itcApprox       // purchase
```

The second and third hold only when every voucher carries stock lines. Vouchers with none
are counted in `vouchersWithoutItems` — where that figure is non-zero, the tax/ITC number
is absorbing service and ledger-only entries too, and should be read as *"everything not
on a stock line"* rather than as tax alone.

---

## 🗂️ Aggregation Buckets

Five breakdowns are built in the same pass. Four are at **voucher grain**; the item
breakdown is at **line grain**, which is why its counts behave differently.

| Bucket | Key | Grain | Value accumulated |
| :--- | :--- | :--- | :--- |
| `months` | `voucherDate[0:7]` → `yyyy-mm`, labelled `"Apr 2025"` | voucher | `amount += sign * abs(voucher.amount)`<br>`invoices += 1` |
| `customers` / `suppliers` | `partyLedgerName`, else `"(no party)"` | voucher | `amount += sign * abs(voucher.amount)`<br>`invoices += 1` |
| `states` | `party.state`, else `"(no state)"` | voucher | `amount += sign * abs(voucher.amount)`<br>`invoices += 1` |
| `cities` | `party.city`, else `"(no city)"` | voucher | `amount += sign * abs(voucher.amount)`<br>`invoices += 1`<br>confidence downgraded to weakest |
| `items` | `line.stockItemName` | **line** | `amount += sign * abs(line.amount)`<br>`quantity += sign * qty`<br>`invoices += 1` **per line**<br>`unit = null` if mixed |

> ⚠️ **Read these counts carefully.**
>
> **Month and party `invoices` count credit notes as vouchers**, because every in-scope
> voucher increments them. The headline `invoiceCount` excludes them. The two answer
> different questions and will not tie.
>
> **Item `invoices` counts lines, not invoices.** One invoice listing the same item on
> three lines contributes three. It is a line count wearing an invoice label.

### City confidence

A city is parsed, not read from a field, so each bucket carries the confidence of its
**weakest** contributing read — one `low` or `none` anywhere downgrades the whole bucket.
A city figure is never as firm as a state figure.

---

## 🏆 Ranking & Truncation

Every bucket goes through the same ranking function, so *top customers*, *top items*,
*top states* and *top cities* all behave identically.

```
sorted        = entries sorted by Number(amount) DESCENDING

top           = sorted[0 .. topN]     // topN defaults to 8
all           = sorted[0 .. 500]      // RANKED_LIST_CAP

totalCount    = sorted.length         // true size, before the cap
listTruncated = sorted.length > 500

otherCount    = count(sorted[topN ..])
otherAmount   = SUM(amount of sorted[topN ..])
```

Because the sort is on the **signed** amount, a party whose returns exceed their purchases
sorts to the bottom, not the top — a net-negative customer appears last and is folded into
`otherAmount` as a negative contribution.

---

## 📋 Detail Rows

The table underneath the charts is drawn at **one row per stock line**, not per invoice. A
three-item invoice produces three rows, each carrying the invoice's identity.

```
row := {
  date               : voucher.voucherDate
  voucherNumber      : voucher.sourceVoucherNumber
  voucherType        : voucher.voucherType       // the company's own name
  customer           : voucher.partyLedgerName   // `supplier` on purchase
  product            : line.stockItemName
  quantity           : sign * line.quantity
  unit               : line.unit
  country/state/city : from the party ledger
  amount             : sign * abs(line.amount)   // EX-TAX, signed
}

// newest first, stable within a day so paging never reshuffles
sort by date DESC, then voucherNumber DESC
```

The row `amount` is the line's own value and therefore **excludes tax**. Summing the
visible rows will not reproduce the invoiced total on the cards above — it reproduces
`itemValue`. A voucher with no stock lines contributes no rows at all, while still
counting in every voucher-grain total.

### Reported period

```
period.from = first monthKey present in the data
period.to   = last  monthKey present in the data
```

Taken from what was **found**, not from what was requested — an empty March inside the
range simply does not appear.

---

## ⚠️ Known Gaps in the Current Formulas

Three places where the implemented formula and the intended formula differ. None are
hypothetical — each is reachable with the voucher types already present in the connected
companies.

### Gap 1 — Counts bypass class resolution

Money uses the **resolved class**; the invoice counts use the **raw voucher name**:

```js
amount       : sign from parentVoucherType(voucherType)   // resolved
invoiceCount : String(v.voucherType).toLowerCase() !== "credit note"   // NOT resolved
```

A credit note the company named `Sales Return` or `CR NOTE` resolves to `credit note` and
is correctly **subtracted** from net sales — but fails the raw string test and is
**counted as a gross invoice**.

Consequences:

- `invoiceCount` overstates
- `creditNoteCount` can read zero while returns exist
- `averageInvoiceValue` divides by the wrong denominator

Identical issue on the purchase side with `debit note`.

**Fix:** compare on `parentVoucherType(v.voucherType)` instead of the raw string. This
changes displayed invoice counts and average invoice value, so it is a deliberate
financial-reporting decision, not a silent patch.

### Gap 2 — Proforma invoices count as sales

The voucher type master maps `PROFORMA INVOICE -> Export Sales`, which the keyword
fallback resolves to `sales`. A proforma is a quotation, not a supply — it is added to
gross sales at full value. The same route applies to anything else parented under a sales
type for numbering convenience.

### Gap 3 — The tax figure absorbs more than tax

`taxAndCharges` and `itcApprox` are **residuals** — whatever is left after subtracting
stock lines from the invoice total. That includes freight, rounding, discounts booked at
ledger level, and the entire value of any service-only voucher. The name says tax; the
arithmetic says *"not on a stock line"*.

---

## 🔗 Related

- [`../README.md`](../README.md) — backend architecture and REST API reference
- `src/integrations/tally/sales/factSales.pipeline.js` — the separate FACT_SALES
  ingestion pipeline, which builds a persisted fact table rather than an on-demand
  aggregate
