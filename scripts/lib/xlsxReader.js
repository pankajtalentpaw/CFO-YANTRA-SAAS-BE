/**
 * Minimal read-only XLSX reader.
 *
 * An .xlsx file is a ZIP archive of XML parts. We need exactly three things out
 * of it — the sheet names, the shared string table, and the cell grid — so a
 * dependency-free reader is cheaper than pulling in a spreadsheet library for a
 * build-time codegen script that runs once.
 *
 * Deliberately not supported: ZIP64, encryption, styles/number formats, dates.
 * Cell values come back as raw strings exactly as Excel stored them; the caller
 * decides how to interpret them.
 */

const fs = require("fs");
const zlib = require("zlib");

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/* ------------------------------------------------------------------ */
/* ZIP                                                                 */
/* ------------------------------------------------------------------ */

/** Locate the End Of Central Directory record, scanning back from the tail. */
function findEocd(buf) {
  // The EOCD is 22 bytes plus a comment of at most 65535, so this is the
  // furthest back it can possibly start.
  const minStart = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error("Not a ZIP archive: no End Of Central Directory record found");
}

/** Read every entry in the central directory into { name -> {offset, method, size} }. */
function readCentralDirectory(buf) {
  const eocd = findEocd(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);

  const entries = new Map();
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw new Error(`Corrupt ZIP: expected central directory header at byte ${pos}`);
    }
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);

    entries.set(name, { method, compressedSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Extract one entry. The local header repeats the name and extra-field lengths
 * (and they can differ from the central directory's), so the data offset has to
 * be computed from the local header, not the central one.
 */
function readEntry(buf, entry) {
  const { localOffset, method, compressedSize } = entry;
  if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
    throw new Error(`Corrupt ZIP: expected local file header at byte ${localOffset}`);
  }
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + compressedSize);

  if (method === 0) return raw;
  if (method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`Unsupported ZIP compression method ${method}`);
}

/* ------------------------------------------------------------------ */
/* XML                                                                 */
/* ------------------------------------------------------------------ */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text) {
  if (!text || text.indexOf("&") === -1) return text || "";
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

/** Pull one attribute off a raw start-tag string. */
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`));
  return m ? decodeXml(m[1]) : null;
}

/** All <t> text inside a fragment, concatenated — how Excel stores rich text runs. */
function textOf(fragment) {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(fragment)) !== null) out += decodeXml(m[1] || "");
  return out;
}

/* ------------------------------------------------------------------ */
/* Sheet grid                                                          */
/* ------------------------------------------------------------------ */

/** "BC12" -> 54 (zero-based column index). */
function columnIndex(cellRef) {
  let n = 0;
  for (let i = 0; i < cellRef.length; i++) {
    const code = cellRef.charCodeAt(i);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/**
 * Parse one worksheet into a sparse array of rows, indexed by 1-based row
 * number so `rows[5]` is spreadsheet row 5. Each row is a dense array of
 * strings padded to its own last populated column.
 *
 * `formulas` is the same grid holding each cell's formula source instead of its
 * cached value, so a cell can be reported as both "0.682" and the
 * "IF(SUMPRODUCT(...))" that produced it. Cells with no formula are "".
 */
function parseSheet(xml, sharedStrings) {
  const rows = [];
  const formulas = [];
  const rowRe = /<row(\s[^>]*)?>([\s\S]*?)<\/row>|<row(\s[^>]*)\/>/g;
  let rowMatch;

  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const rowAttrs = rowMatch[1] || rowMatch[3] || "";
    const body = rowMatch[2] || "";
    const rowNum = Number(attr(`<row${rowAttrs}>`, "r"));
    if (!rowNum) continue;

    const cells = [];
    const cellFormulas = [];
    const cellRe = /<c(\s[^>]*)?>([\s\S]*?)<\/c>|<c(\s[^>]*)\/>/g;
    let cellMatch;
    let fallbackCol = 0;

    while ((cellMatch = cellRe.exec(body)) !== null) {
      const cellAttrs = cellMatch[1] || cellMatch[3] || "";
      const inner = cellMatch[2] || "";
      const tag = `<c${cellAttrs}>`;
      const ref = attr(tag, "r");
      const col = ref ? columnIndex(ref) : fallbackCol;
      fallbackCol = col + 1;

      cells[col] = readCellValue(attr(tag, "t"), inner, sharedStrings);
      cellFormulas[col] = readCellFormula(inner);
    }

    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    for (let i = 0; i < cellFormulas.length; i++) if (cellFormulas[i] === undefined) cellFormulas[i] = "";
    rows[rowNum] = cells;
    formulas[rowNum] = cellFormulas;
  }
  return { rows, formulas };
}

function readCellValue(type, inner, sharedStrings) {
  if (type === "s") {
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    if (!v) return "";
    const idx = Number(v[1]);
    return sharedStrings[idx] !== undefined ? sharedStrings[idx] : "";
  }
  if (type === "inlineStr") return textOf(inner);
  // "str" is a formula returning text; "e" is an error value such as #VALUE!.
  // Both live in <v> as plain text, as do numbers and booleans.
  const v = inner.match(/<v>([\s\S]*?)<\/v>/);
  return v ? decodeXml(v[1]) : "";
}

/**
 * The formula source of one cell, or "" when it holds a literal.
 *
 * Shared formulas (`<f t="shared" si="3"/>`) carry their text only on the
 * master cell; the rest reference it by index and come back "". That is fine
 * here — the formula is documentation for a failure message, not something we
 * evaluate, and every cell still has its own cached value.
 */
function readCellFormula(inner) {
  const m = inner.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/);
  return m ? decodeXml(m[1]) : "";
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Read a workbook.
 *
 * Returns { sheets: [{ name, rows, formulas }] } in the workbook's own sheet
 * order, where both grids are 1-indexed to match spreadsheet row numbers
 * (index 0 is a hole). `formulas` mirrors `rows` cell for cell.
 */
function readWorkbook(filePath) {
  const buf = fs.readFileSync(filePath);
  const dir = readCentralDirectory(buf);

  const part = (name) => {
    const entry = dir.get(name);
    if (!entry) return null;
    return readEntry(buf, entry).toString("utf8");
  };

  const sharedStrings = [];
  const ssXml = part("xl/sharedStrings.xml");
  if (ssXml) {
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(ssXml)) !== null) sharedStrings.push(textOf(m[1]));
  }

  // r:id on each <sheet> points into workbook.xml.rels, which holds the real path.
  const relTargets = new Map();
  const relsXml = part("xl/_rels/workbook.xml.rels") || "";
  const relRe = /<Relationship\s[^>]*\/>/g;
  let relMatch;
  while ((relMatch = relRe.exec(relsXml)) !== null) {
    const id = attr(relMatch[0], "Id");
    const target = attr(relMatch[0], "Target");
    if (id && target) relTargets.set(id, target);
  }

  const wbXml = part("xl/workbook.xml");
  if (!wbXml) throw new Error("Not an XLSX file: xl/workbook.xml is missing");

  const sheets = [];
  const sheetRe = /<sheet\s[^>]*\/>/g;
  let sheetMatch;
  while ((sheetMatch = sheetRe.exec(wbXml)) !== null) {
    const tag = sheetMatch[0];
    const name = attr(tag, "name");
    const rid = attr(tag, "r:id") || attr(tag, "relationshipId");
    let target = relTargets.get(rid);
    if (!target) continue;

    if (target.startsWith("/")) target = target.slice(1);
    else if (!target.startsWith("xl/")) target = `xl/${target}`;

    const sheetXml = part(target);
    if (!sheetXml) continue;
    const { rows, formulas } = parseSheet(sheetXml, sharedStrings);
    sheets.push({ name, path: target, rows, formulas });
  }

  return { sheets, sharedStrings };
}

module.exports = { readWorkbook, decodeXml, columnIndex };
