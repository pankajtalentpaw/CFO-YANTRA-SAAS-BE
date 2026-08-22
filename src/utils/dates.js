/**
 * Date manipulation and formatting utilities for Tally and Indian Financial Year conventions.
 */

/**
 * Format Date or timestamp into Tally date format: YYYYMMDD
 * @param {Date|string|number} date
 * @returns {string} e.g. "20240401"
 */
function toTallyDate(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date provided: ${date}`);
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * Parse Tally date string (YYYYMMDD) into a standard ISO Date
 * @param {string} tallyDateStr
 * @returns {Date}
 */
function parseTallyDate(tallyDateStr) {
  if (!tallyDateStr || typeof tallyDateStr !== "string") {
    throw new Error(`Invalid Tally date string: ${tallyDateStr}`);
  }
  const clean = tallyDateStr.trim().replace(/[-/]/g, "");
  if (clean.length !== 8) {
    throw new Error(`Expected 8-digit Tally date format YYYYMMDD, received: ${tallyDateStr}`);
  }
  const year = parseInt(clean.substring(0, 4), 10);
  const month = parseInt(clean.substring(4, 6), 10) - 1;
  const day = parseInt(clean.substring(6, 8), 10);
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

/**
 * Format to ISO 8601 UTC date string (YYYY-MM-DD)
 * @param {Date|string} date
 * @returns {string}
 */
function toIsoDate(date) {
  const d = new Date(date);
  return d.toISOString().split("T")[0];
}

/**
 * Get Indian Financial Year for a given date (April to March)
 * @param {Date|string} date
 * @returns {string} e.g. "2023-2024"
 */
function getIndianFinancialYear(date) {
  const d = new Date(date);
  const month = d.getMonth(); // 0 = Jan, 3 = Apr
  const year = d.getFullYear();
  if (month >= 3) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}

module.exports = {
  toTallyDate,
  parseTallyDate,
  toIsoDate,
  getIndianFinancialYear
};
