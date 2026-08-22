/**
 * Hard Read-Only Security Policy for Tally XML Requests
 * 
 * Strict Gate: Fails closed. Rejects any XML payload that contains
 * write, import, create, alter, delete, or arbitrary mutation instructions.
 */

const { XMLParser } = require("fast-xml-parser");

const BLOCKED_PATTERNS = [
  /<importdata/i,
  /<svimportformat/i,
  /<action\s*>\s*(create|alter|delete|execute)\s*<\/action>/i,
  /<tallymessage[^>]*status\s*=\s*["']?(import|alter|create|delete)["']?/i,
  /<voucher[^>]*action\s*=\s*["']?(create|alter|delete)["']?/i,
  /<ledger[^>]*action\s*=\s*["']?(create|alter|delete)["']?/i,
  /<import/i
];

const ALLOWED_TALLY_REQUESTS = new Set(["export", "execute", "import"]); // Note: In Tally, TALLYREQUEST is usually Export

/**
 * Validate that an XML string is strictly read-only
 * @param {string} xmlString
 * @returns {{ allowed: boolean, reason?: string }}
 */
function validateReadOnlyXml(xmlString) {
  if (!xmlString || typeof xmlString !== "string") {
    return { allowed: false, reason: "Empty or invalid XML payload string" };
  }

  const trimmed = xmlString.trim();
  if (!trimmed.startsWith("<ENVELOPE") && !trimmed.startsWith("<?xml")) {
    return { allowed: false, reason: "XML must start with ENVELOPE or XML declaration" };
  }

  // Check against blacklisted write patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason: `Blocked by ReadOnlyPolicy: Matched forbidden write pattern (${pattern})`
      };
    }
  }

  // Parse structure to verify safe read-only envelope
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true
    });

    const parsed = parser.parse(trimmed);
    const envelope = parsed.ENVELOPE || parsed.envelope;

    if (!envelope) {
      return { allowed: false, reason: "Missing root <ENVELOPE> element" };
    }

    const header = envelope.HEADER || envelope.header;
    if (!header) {
      return { allowed: false, reason: "Missing <HEADER> element in ENVELOPE" };
    }

    const tallyRequest = header.TALLYREQUEST || header.tallyrequest;
    if (tallyRequest && typeof tallyRequest === "string") {
      const normalizedReq = tallyRequest.trim().toLowerCase();
      // Only Export is allowed for data retrieval
      if (normalizedReq !== "export") {
        return {
          allowed: false,
          reason: `Blocked by ReadOnlyPolicy: TALLYREQUEST must be 'Export', got '${tallyRequest}'`
        };
      }
    }

    // Passed all checks
    return { allowed: true };
  } catch (parseErr) {
    return {
      allowed: false,
      reason: `Blocked by ReadOnlyPolicy: Malformed XML structure (${parseErr.message})`
    };
  }
}

/**
 * Throws a SecurityError if the XML violates the ReadOnlyPolicy
 * @param {string} xmlString
 */
function assertReadOnlyXml(xmlString) {
  const result = validateReadOnlyXml(xmlString);
  if (!result.allowed) {
    const error = new Error(`READ_ONLY_VIOLATION: ${result.reason}`);
    error.code = "READ_ONLY_VIOLATION";
    error.isReadOnlyViolation = true;
    throw error;
  }
}

module.exports = {
  validateReadOnlyXml,
  assertReadOnlyXml
};
