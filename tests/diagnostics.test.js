const { classifyError, buildDiagnosticReport } = require("../src/services/diagnostics.service");
const { FAILURE_CODES, FAILURE_METADATA } = require("../src/constants/failureCodes");

describe("Diagnostics Service & Failure Codes", () => {
  test("classifies ECONNREFUSED as TALLY_STOPPED for default port", () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:9000");
    error.code = "ECONNREFUSED";

    const result = classifyError(error, { isNonDefaultPort: false });
    expect(result.success).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.TALLY_STOPPED);
    expect(result.retryable).toBe(true);
    expect(result.diagnosticHint).toBeDefined();
  });

  test("classifies ECONNREFUSED as WRONG_PORT when custom port is specified", () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:9001");
    error.code = "ECONNREFUSED";

    const result = classifyError(error, { isNonDefaultPort: true });
    expect(result.success).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.WRONG_PORT);
  });

  test("classifies timeout errors as CONNECTION_TIMEOUT", () => {
    const error = new Error("timeout of 10000ms exceeded");
    error.code = "ETIMEDOUT";

    const result = classifyError(error);
    expect(result.success).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.CONNECTION_TIMEOUT);
    expect(result.retryable).toBe(true);
  });

  test("classifies read-only policy violation", () => {
    const error = new Error("READ_ONLY_VIOLATION");
    const result = classifyError(error, { isReadOnlyViolation: true });
    expect(result.failureCode).toBe(FAILURE_CODES.READ_ONLY_VIOLATION);
    expect(result.retryable).toBe(false);
  });

  test("builds diagnostic report for known codes", () => {
    const report = buildDiagnosticReport(FAILURE_CODES.MALFORMED_XML, { extraInfo: "Test" });
    expect(report.failureCode).toBe(FAILURE_CODES.MALFORMED_XML);
    expect(report.extraInfo).toBe("Test");
    expect(report.retryable).toBe(false);
  });
});
