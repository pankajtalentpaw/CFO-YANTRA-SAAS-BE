const { probeTally } = require("../integrations/tally/tally.health");
const { detectCapabilities } = require("../integrations/tally/tally.capabilities");
const { testConnection } = require("../integrations/tally/tally.client");
const { sendXmlRequest } = require("../integrations/tally/transports/xml.transport");
const { buildCompanyDetailedRequest, buildCompanyListRequest } = require("../integrations/tally/tally.requests");
const { normalizeCanonicalCompany } = require("../integrations/tally/canonical/company.canonical");
const { extractAllMasters } = require("../integrations/tally/tally.masters");
const { parseCompanies } = require("../integrations/tally/tally.parser");
const { classifyError, isCollectionDescriptionError } = require("../services/diagnostics.service");
const env = require("../config/env");

async function getHealth(req, res) {
  try {
    const conn = await testConnection({ host: env.tally.host, port: env.tally.port });
    return res.json({
      success: conn.success,
      service: "cfo-yantra-backend",
      tally: conn
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function getStatus(req, res) {
  try {
    const status = await probeTally();
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function getCapabilities(req, res) {
  try {
    const caps = await detectCapabilities();
    return res.json(caps);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function getCompany(req, res) {
  try {
    // Light discovery query (Experiment 1). The detailed 30-field request is
    // reserved for Experiment 2 so one unsupported field cannot fail discovery.
    const xml = buildCompanyListRequest();
    const transportRes = await sendXmlRequest({ xml });
    if (!transportRes.success) {
      const message = transportRes.errorMessage || transportRes.errorCode || "Tally request failed";
      const diagnostic = classifyError(new Error(message), {
        isInvalidCollection: isCollectionDescriptionError(message)
      });
      return res.status(502).json({
        success: false,
        error: message,
        failureCode: diagnostic.failureCode,
        diagnosticHint: diagnostic.diagnosticHint,
        userAction: diagnostic.userAction,
        companyCount: 0,
        companies: [],
        company: null
      });
    }

    const parsed = transportRes.parsedResponse;
    const discovered = parseCompanies(parsed);
    if (discovered.length === 0) {
      return res.json({
        success: false,
        message: "No company loaded in Tally",
        companyCount: 0,
        companies: [],
        company: null
      });
    }

    // Every discovered company is normalized, not just the first one.
    const companies = discovered
      .map((info) => {
        // Overlay the typed scalars so canonical normalization never sees a
        // structural XML node where it expects a string.
        const base = info.raw && typeof info.raw === "object" ? { ...info.raw } : {};
        base.NAME = info.name;
        if (info.guid) base.GUID = info.guid;
        if (info.masterId) base.MASTERID = info.masterId;
        return normalizeCanonicalCompany(base, { sourceFormat: "XML" });
      })
      .filter(Boolean);

    return res.json({
      success: true,
      companyCount: companies.length,
      companies,
      discovered,
      // Backward compatibility for callers expecting a single company.
      company: companies[0]
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function getMasters(req, res) {
  try {
    const result = await extractAllMasters();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function getTransport(req, res) {
  try {
    const caps = await detectCapabilities();
    return res.json({
      selectedTransport: caps.selectedFormat,
      fallbackActive: caps.selectedFormat === "XML" && (!caps.formats.json && !caps.formats.jsonEx),
      formats: caps.formats,
      timing: caps.timing
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getHealth,
  getStatus,
  getCapabilities,
  getCompany,
  getMasters,
  getTransport
};
