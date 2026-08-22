jest.mock("../src/integrations/tally/tally.client", () => ({
  sendXml: jest.fn(),
  checkHeartbeat: jest.fn()
}));

const { sendXml } = require("../src/integrations/tally/tally.client");
const { probeTally } = require("../src/integrations/tally/tally.health");

function respond(inner) {
  return {
    statusCode: 200,
    responseTimeMs: 12,
    body: `<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION>${inner}</COLLECTION></DATA></BODY></ENVELOPE>`
  };
}

describe("probeTally company discovery", () => {
  beforeEach(() => sendXml.mockReset());

  test("successful handshake reports typed companies plus legacy fields", async () => {
    sendXml.mockResolvedValue(
      respond(`
        <COMPANY><NAME>Alpha Traders</NAME><GUID>g-1</GUID><STARTINGFROM>20230401</STARTINGFROM></COMPANY>
        <COMPANY><NAME>Beta Enterprises</NAME><GUID>g-2</GUID></COMPANY>`)
    );

    const result = await probeTally();

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.companyAvailable).toBe(true);
    expect(result.companyCount).toBe(2);
    expect(result.companies.map((c) => c.name)).toEqual(["Alpha Traders", "Beta Enterprises"]);
    expect(result.companyNames).toEqual(["Alpha Traders", "Beta Enterprises"]);
    expect(result.company.companyId).toBe("g-1");
    expect(result.companies.every((c) => typeof c.name === "string")).toBe(true);
  });

  test("no company open reports zero companies without failing the handshake", async () => {
    sendXml.mockResolvedValue(respond(""));

    const result = await probeTally();

    expect(result.success).toBe(true);
    expect(result.companyCount).toBe(0);
    expect(result.companies).toEqual([]);
    expect(result.company).toBeNull();
  });
});
