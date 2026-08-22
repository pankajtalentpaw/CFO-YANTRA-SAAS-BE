/**
 * Robust XML parser and schema normalizer for Tally HTTP responses.
 */

const { XMLParser, XMLValidator } = require("fast-xml-parser");

const defaultParserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false, // Keep values as strings to avoid precision loss on numbers/dates
  removeNSPrefix: true
};

const xmlParser = new XMLParser(defaultParserOptions);

/**
 * Check if the raw XML text contains a LINEERROR tag
 * @param {string} rawXml
 * @returns {string|null} Line error message if present
 */
function extractLineError(rawXml) {
  if (typeof rawXml !== "string") return null;
  const match = rawXml.match(/<LINEERROR>(.*?)<\/LINEERROR>/is);
  return match ? match[1].trim() : null;
}

/**
 * Ensure a given item is returned as an array
 * @param {any} item
 * @returns {Array}
 */
function normalizeArray(item) {
  if (item === null || item === undefined) return [];
  if (Array.isArray(item)) return item;
  return [item];
}

/**
 * Extract scalar value from node (handles text nodes, attribute names, string/number)
 */
function extractValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "object") {
    if (val["#text"] !== undefined) return String(val["#text"]).trim();
    if (val["_"] !== undefined) return String(val["_"]).trim();
    return JSON.stringify(val);
  }
  return String(val).trim();
}

/**
 * @typedef {object} TallyCompanyInfo
 * @property {string} companyId    Stable identity: GUID when available, else MasterId, else name hash
 * @property {string} name         Company name exactly as returned by Tally
 * @property {string} companyName  Alias of `name` (backward compatible with existing UI/canonical code)
 * @property {string} [guid]       Tally company GUID, when returned
 * @property {string} [masterId]   Tally MasterId, when returned
 * @property {string} [startingAt] Books/financial year start (ISO yyyy-mm-dd when derivable)
 * @property {object} raw          Raw parsed XML node this record was built from
 */

/** Field aliases actually observed across Tally XML company collections. */
const COMPANY_NAME_KEYS = ["NAME", "Name", "name", "@_NAME", "COMPANYNAME", "CompanyName"];
const COMPANY_GUID_KEYS = ["GUID", "Guid", "guid", "@_GUID"];
const COMPANY_MASTERID_KEYS = ["MASTERID", "MasterId", "masterId", "@_MASTERID", "REMOTECMPID", "@_REMOTECMPID"];
const COMPANY_START_KEYS = ["STARTINGFROM", "StartingFrom", "startingFrom", "BOOKSFROM", "BooksFrom", "booksFrom"];

/**
 * Read the first present alias from a parsed XML node, flattening text nodes.
 * @param {object} node
 * @param {string[]} keys
 * @returns {string|null}
 */
function pickField(node, keys) {
  if (!node || typeof node !== "object") return null;
  for (const key of keys) {
    if (node[key] === undefined || node[key] === null) continue;
    const value = extractValue(node[key]);
    // extractValue falls back to JSON for structural nodes; those are not scalar values.
    if (value !== null && value !== "" && !value.startsWith("{") && !value.startsWith("[")) {
      return value;
    }
  }
  return null;
}

/**
 * Convert Tally's compact yyyymmdd date form to ISO. Any other form is passed through.
 * @param {string|null} value
 * @returns {string|null}
 */
function normalizeCompanyDate(value) {
  if (!value) return null;
  const compact = String(value).trim();
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  return compact;
}

/**
 * Derive a stable company identity. GUID wins over MasterId; name is the last resort
 * because it is user-editable and therefore not a permanent identity.
 * @param {string|null} guid
 * @param {string|null} masterId
 * @param {string} name
 * @returns {string}
 */
function deriveCompanyId(guid, masterId, name) {
  if (guid && guid !== "0") return guid;
  if (masterId && masterId !== "0") return `MID_${masterId}`;
  return `NAME_${name.toLowerCase().replace(/\s+/g, "_")}`;
}

/**
 * Build a strongly typed company record from one parsed XML company node.
 * Returns null when the node carries no usable company name.
 * @param {object|string} node
 * @returns {TallyCompanyInfo|null}
 */
function toCompanyInfo(node) {
  if (node === null || node === undefined) return null;

  if (typeof node === "string" || typeof node === "number") {
    const name = String(node).trim();
    if (!name) return null;
    return {
      companyId: deriveCompanyId(null, null, name),
      name,
      companyName: name,
      raw: node
    };
  }

  if (typeof node !== "object") return null;

  const name = pickField(node, COMPANY_NAME_KEYS);
  if (!name) return null;

  const guid = pickField(node, COMPANY_GUID_KEYS);
  const masterId = pickField(node, COMPANY_MASTERID_KEYS);
  const startingAt = normalizeCompanyDate(pickField(node, COMPANY_START_KEYS));

  /** @type {TallyCompanyInfo} */
  const company = {
    companyId: deriveCompanyId(guid, masterId, name),
    name,
    companyName: name,
    raw: node
  };

  // Optional fields are only attached when Tally actually returned them.
  if (guid) company.guid = guid;
  if (masterId) company.masterId = masterId;
  if (startingAt) company.startingAt = startingAt;

  return company;
}

/**
 * Extract every company record from a parsed Tally response (or a raw collection array).
 * Duplicates sharing a companyId are collapsed, keeping the richest record.
 * @param {object|Array} parseResultOrCollection
 * @returns {TallyCompanyInfo[]}
 */
function parseCompanies(parseResultOrCollection) {
  let collection = [];
  if (Array.isArray(parseResultOrCollection)) {
    collection = parseResultOrCollection;
  } else if (parseResultOrCollection && typeof parseResultOrCollection === "object") {
    if (parseResultOrCollection.success === false) return [];
    collection = normalizeArray(parseResultOrCollection.collection);
  }

  /** @type {Map<string, TallyCompanyInfo>} */
  const byId = new Map();
  for (const node of collection) {
    const company = toCompanyInfo(node);
    if (!company) continue;

    const existing = byId.get(company.companyId);
    if (!existing) {
      byId.set(company.companyId, company);
      continue;
    }
    // Prefer whichever record carries more optional metadata.
    const score = (c) => (c.guid ? 1 : 0) + (c.masterId ? 1 : 0) + (c.startingAt ? 1 : 0);
    if (score(company) > score(existing)) byId.set(company.companyId, company);
  }

  return Array.from(byId.values());
}

/**
 * Render companies as human-readable diagnostic lines.
 * This exists so no caller ever falls back to default object-to-string coercion.
 * @param {TallyCompanyInfo[]} companies
 * @returns {string}
 */
function formatCompanyList(companies) {
  const list = Array.isArray(companies) ? companies : [];
  const lines = [`Loaded Companies: ${list.length}`];

  if (list.length === 0) {
    lines.push("  (no company is currently open in TallyPrime)");
    return lines.join("\n");
  }

  list.forEach((company, index) => {
    const details = [];
    if (company.guid) details.push(`GUID: ${company.guid}`);
    else if (company.masterId) details.push(`MasterId: ${company.masterId}`);
    if (company.startingAt) details.push(`Starting At: ${company.startingAt}`);

    lines.push(`  ${index + 1}. ${company.name}`);
    if (details.length > 0) lines.push(`     ${details.join("  |  ")}`);
  });

  return lines.join("\n");
}

/**
 * Parse and validate a Tally XML response
 * @param {string} rawXml
 * @returns {object} Normalized parse result
 */
function parseTallyResponse(rawXml) {
  if (!rawXml || typeof rawXml !== "string" || !rawXml.trim()) {
    return {
      success: false,
      isEmpty: true,
      error: "Empty XML response received from Tally",
      rawXml: rawXml || ""
    };
  }

  // 1. Check for explicit LINEERROR in raw response
  const lineError = extractLineError(rawXml);
  if (lineError) {
    return {
      success: false,
      hasLineError: true,
      lineError,
      rawXml
    };
  }

  // 2. Validate XML syntax
  const validationResult = XMLValidator.validate(rawXml);
  if (validationResult !== true) {
    return {
      success: false,
      isMalformedXml: true,
      error: `Malformed XML syntax: ${validationResult.err ? validationResult.err.msg : "Invalid XML"}`,
      rawXml
    };
  }

  // 3. Parse XML into JS object
  let parsed;
  try {
    parsed = xmlParser.parse(rawXml);
  } catch (err) {
    return {
      success: false,
      isMalformedXml: true,
      error: `Failed to parse XML: ${err.message}`,
      rawXml
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      success: false,
      isMalformedXml: true,
      error: "Parsed XML root is null or not an object",
      rawXml
    };
  }

  const envelope = parsed.ENVELOPE || parsed.envelope;
  if (!envelope) {
    return {
      success: false,
      isInvalidEnvelope: true,
      error: "Response is missing root <ENVELOPE>",
      parsed,
      rawXml
    };
  }

  const header = envelope.HEADER || envelope.header || {};
  const body = envelope.BODY || envelope.body || {};
  const data = body.DATA || body.data || {};
  const desc = body.DESC || body.desc || {};

  // Extract collection items if present
  let collection = [];
  const collectionWrapper = data.COLLECTION || data.collection;
  if (collectionWrapper && typeof collectionWrapper === "object") {
    const keys = Object.keys(collectionWrapper).filter((k) => !k.startsWith("@_"));
    for (const key of keys) {
      const items = normalizeArray(collectionWrapper[key]);
      collection.push(...items);
    }
  }

  // Fallback: Check TALLYMESSAGE
  if (collection.length === 0 && data.TALLYMESSAGE) {
    const messages = normalizeArray(data.TALLYMESSAGE);
    for (const msg of messages) {
      if (typeof msg === "object") {
        const msgKeys = Object.keys(msg).filter((k) => !k.startsWith("@_"));
        for (const k of msgKeys) {
          collection.push(...normalizeArray(msg[k]));
        }
      }
    }
  }

  // Extract CMPINFO if present
  const cmpInfo = desc.CMPINFO || desc.cmpinfo || null;

  return {
    success: true,
    headerStatus: header.STATUS || header.status || null,
    collection,
    cmpInfo,
    envelope,
    rawXml
  };
}

module.exports = {
  parseTallyResponse,
  extractLineError,
  normalizeArray,
  extractValue,
  toCompanyInfo,
  parseCompanies,
  formatCompanyList,
  normalizeCompanyDate,
  deriveCompanyId
};
