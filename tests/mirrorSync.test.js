jest.mock("../src/integrations/tally/transports/xml.transport", () => ({ sendXmlRequest: jest.fn() }));

const { execFileSync } = require("child_process");
const mongoose = require("mongoose");
const { sendXmlRequest } = require("../src/integrations/tally/transports/xml.transport");
const { parseTallyResponse } = require("../src/integrations/tally/tally.parser");
const { invalidate } = require("../src/services/companyScope.service");
const service = require("../src/services/companyData.service");
const { syncCompany, runSyncCycle } = require("../src/services/sync/syncEngine.service");
const mirror = require("../src/services/sync/mirror.service");
const { Company, SyncState, DOMAIN_MODELS, Voucher } = require("../src/models");

const TEST_URI = process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27017/cfo_yantra_test";
const COMPANY = { companyId: "guid-sync-1", name: "Sync Test Co", guid: "guid-sync-1", startingAt: "2023-04-01" };

function transportOk(collectionXml) {
  const raw = `<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION>${collectionXml}</COLLECTION></DATA></BODY></ENVELOPE>`;
  return { success: true, statusCode: 200, responseTimeMs: 3, rawResponse: raw, parsedResponse: parseTallyResponse(raw) };
}

const COMPANY_XML = `<COMPANY NAME="Sync Test Co"><NAME>Sync Test Co</NAME><GUID>guid-sync-1</GUID><STARTINGFROM>20230401</STARTINGFROM></COMPANY>`;
const LEDGERS_V1 = `
  <LEDGER NAME="Acme Traders"><GUID TYPE="String">led-1</GUID><PARENT TYPE="String">Sundry Debtors</PARENT></LEDGER>
  <LEDGER NAME="Zenith Supplies"><GUID TYPE="String">led-2</GUID><PARENT TYPE="String">Sundry Creditors</PARENT></LEDGER>`;
// led-1 renamed (checksum moves), led-2 gone (tombstone), led-3 new (insert)
const LEDGERS_V2 = `
  <LEDGER NAME="Acme Traders Pvt Ltd"><GUID TYPE="String">led-1</GUID><PARENT TYPE="String">Sundry Debtors</PARENT></LEDGER>
  <LEDGER NAME="New Party"><GUID TYPE="String">led-3</GUID><PARENT TYPE="String">Sundry Debtors</PARENT></LEDGER>`;

/** Company-list probes must answer with the company; everything else is a domain. */
function routeTally(domainXml) {
  sendXmlRequest.mockImplementation(({ xml }) =>
    Promise.resolve(transportOk(/List of Companies|COMPANY/i.test(xml || "") && /Company/i.test(xml || "") && !/LEDGER|STOCK|GROUP|UNIT|GODOWN|COST|VOUCHER|CURRENCY/i.test(xml || "")
      ? COMPANY_XML
      : domainXml))
  );
}

/**
 * Whether MongoDB is reachable has to be known while the suite is being
 * collected, because that is when the test/test.skip choice is made - long
 * before any async beforeAll could answer it. Hence a one-off synchronous
 * TCP probe rather than an async connect.
 */
function mongoReachable(uri) {
  const match = /mongodb:\/\/([^:/,]+)(?::(\d+))?/.exec(uri);
  const host = match ? match[1] : "127.0.0.1";
  const port = match && match[2] ? match[2] : "27017";
  try {
    execFileSync(
      process.execPath,
      ["-e", `const n=require("net");const s=n.connect(${port},"${host}");s.on("connect",()=>{s.end();process.exit(0)});s.on("error",()=>process.exit(1));setTimeout(()=>process.exit(1),2000)`],
      { stdio: "ignore", timeout: 5000 }
    );
    return true;
  } catch (e) {
    return false;
  }
}

const mongoUp = mongoReachable(TEST_URI);

beforeAll(async () => {
  if (!mongoUp) return;
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000, bufferCommands: false });
});

afterAll(async () => {
  if (mongoUp) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

beforeEach(async () => {
  sendXmlRequest.mockReset();
  invalidate();
  if (mongoUp) {
    await Promise.all([
      ...Object.values(DOMAIN_MODELS).map((m) => m.deleteMany({})),
      Voucher.deleteMany({}),
      Company.deleteMany({}),
      SyncState.deleteMany({})
    ]);
  }
});

const itDb = () => (mongoUp ? test : test.skip);

describe("Local mirror sync pipeline", () => {
  itDb()("writes extracted ledgers into the mirror", async () => {
    routeTally(LEDGERS_V1);
    const result = await syncCompany(COMPANY, "RUN_1");

    expect(result.status).not.toBe("FAILED");
    expect(result.domains.ledgers.status).toBe("SUCCESS");
    expect(result.domains.ledgers.inserted).toBe(2);

    const stored = await DOMAIN_MODELS.ledgers.find({ companyId: COMPANY.companyId }).lean();
    expect(stored.map((l) => l.name).sort()).toEqual(["Acme Traders", "Zenith Supplies"]);
    expect(stored[0].checksum).toBeTruthy();
  });

  itDb()("re-running with identical data writes nothing (checksum change detection)", async () => {
    routeTally(LEDGERS_V1);
    await syncCompany(COMPANY, "RUN_1");
    const second = await syncCompany(COMPANY, "RUN_2");

    expect(second.domains.ledgers.unchanged).toBe(2);
    expect(second.domains.ledgers.inserted).toBe(0);
    expect(second.domains.ledgers.updated).toBe(0);
  });

  itDb()("updates changed records, inserts new ones and tombstones vanished ones", async () => {
    routeTally(LEDGERS_V1);
    await syncCompany(COMPANY, "RUN_1");

    routeTally(LEDGERS_V2);
    const second = await syncCompany(COMPANY, "RUN_2");

    expect(second.domains.ledgers.updated).toBe(1);    // led-1 renamed
    expect(second.domains.ledgers.inserted).toBe(1);   // led-3 added
    expect(second.domains.ledgers.tombstoned).toBe(1); // led-2 vanished

    const live = await DOMAIN_MODELS.ledgers.find({ companyId: COMPANY.companyId, isDeleted: false }).lean();
    expect(live.map((l) => l.name).sort()).toEqual(["Acme Traders Pvt Ltd", "New Party"]);

    // Vanished records are kept, not deleted, so history survives.
    const tombstoned = await DOMAIN_MODELS.ledgers.findOne({ sourceObjectId: "led-2" }).lean();
    expect(tombstoned).not.toBeNull();
    expect(tombstoned.isDeleted).toBe(true);
  });

  itDb()("serves reads from the mirror once synced, in canonical shape", async () => {
    routeTally(LEDGERS_V1);
    await syncCompany(COMPANY, "RUN_1");

    // Tally now fails outright; a mirrored read must still succeed.
    sendXmlRequest.mockResolvedValue({ success: false, errorMessage: "TALLY DOWN" });
    const read = await service.getDomain(COMPANY, "ledgers");

    expect(read.available).toBe(true);
    expect(read.source).toBe("mirror");
    expect(read.records).toHaveLength(2);

    // Canonical envelope preserved; mirror bookkeeping fields stripped.
    const rec = read.records.find((r) => r.sourceObjectId === "led-1");
    expect(rec.objectType).toBe("Ledger");
    expect(rec.sourceCompanyId).toBe(COMPANY.companyId);
    expect(rec.checksum).toBeTruthy();
    expect(rec._id).toBeUndefined();
    expect(rec.companyId).toBeUndefined();
    expect(rec.isDeleted).toBeUndefined();
    expect(rec.syncedAt).toBeUndefined();
  });

  itDb()("records per-company sync state", async () => {
    routeTally(LEDGERS_V1);
    await syncCompany(COMPANY, "RUN_1");

    const state = await SyncState.findOne({ companyId: COMPANY.companyId }).lean();
    expect(state).not.toBeNull();
    expect(["SUCCESS", "PARTIAL"]).toContain(state.status);
    expect(state.lastRunId).toBe("RUN_1");
    expect(state.totalRecords).toBeGreaterThan(0);
    expect(state.lastFinishedAt).toBeTruthy();
  });

  itDb()("a full cycle mirrors the open company list", async () => {
    routeTally(LEDGERS_V1);
    const cycle = await runSyncCycle();

    expect(cycle.skipped).toBe(false);
    const companies = await Company.find({}).lean();
    expect(companies).toHaveLength(1);
    expect(companies[0].companyId).toBe("guid-sync-1");
    expect(companies[0].isOpen).toBe(true);
  });
});

describe("Fallback safety", () => {
  itDb()("an unsynced company falls through to live TallyPrime extraction", async () => {
    routeTally(LEDGERS_V1);
    // Company is open in Tally but nothing has been mirrored for it yet, so
    // the live extraction path must answer exactly as it did before.
    const read = await service.getDomain(COMPANY, "ledgers");

    expect(read.available).toBe(true);
    expect(read.source).toBeUndefined();
    expect(sendXmlRequest).toHaveBeenCalled();
  });

  itDb()("a company that is no longer open in Tally is still refused", async () => {
    routeTally(LEDGERS_V1);
    const closed = { companyId: "guid-not-open", name: "Closed Co", startingAt: "2023-04-01" };
    const read = await service.getDomain(closed, "ledgers");

    // The safety gate stands: extracting against a closed company crashes Tally.
    expect(read.available).toBe(false);
  });

  itDb()("mirror read returns null for an empty domain rather than an empty answer", async () => {
    const result = await mirror.readDomain("guid-nothing-here", "ledgers");
    expect(result).toBeNull();
  });
});
