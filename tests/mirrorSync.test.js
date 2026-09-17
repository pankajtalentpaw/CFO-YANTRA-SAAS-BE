jest.mock("../src/integrations/tally/transports/xml.transport", () => ({ sendXmlRequest: jest.fn() }));

const { sendXmlRequest } = require("../src/integrations/tally/transports/xml.transport");
const { parseTallyResponse } = require("../src/integrations/tally/tally.parser");
const { invalidate } = require("../src/services/companyScope.service");
const service = require("../src/services/companyData.service");
const { syncCompany, runSyncCycle } = require("../src/services/sync/syncEngine.service");
const mirror = require("../src/services/sync/mirror.service");
const { Company, SyncState, DOMAIN_MODELS, Voucher } = require("../src/models");
const { connectDatabase, disconnectDatabase, isConnected } = require("../src/config/db");

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

beforeAll(async () => {
  await connectDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  sendXmlRequest.mockReset();
  invalidate();
  if (isConnected()) {
    await Promise.all([
      ...Object.values(DOMAIN_MODELS).map((m) => m.deleteMany({})),
      Voucher.deleteMany({}),
      Company.deleteMany({}),
      SyncState.deleteMany({})
    ]);
  }
});

const itDb = () => test;

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

describe("Partial writes never tombstone", () => {
  /*
   * The CDC engine writes a DELTA - only the vouchers whose AlterId moved -
   * through the same upsert path the full sync uses. That path tombstones
   * anything absent from the set it was handed, which is correct for a complete
   * register and catastrophic for a batch of three: one CDC run struck off
   * 2,412 live vouchers, and a company mirrored only by CDC read back empty
   * while every row was still sitting in the table.
   *
   * Nothing caught it because every existing tombstone test hands over the
   * complete set. These cases pin the distinction itself.
   */
  const CO = "guid-cdc-partial";
  const vch = (id, date) => ({
    sourceObjectId: id,
    objectType: "SalesVoucher",
    voucherType: "Sales",
    voucherDate: date,
    partyLedgerName: "Acme Traders",
    amount: "100.00"
  });

  itDb()("a CDC delta leaves the vouchers outside its batch alone", async () => {
    await mirror.upsertVouchers(
      CO,
      [vch("v1", "2024-05-01"), vch("v2", "2024-05-02"), vch("v3", "2024-05-03")],
      "RUN_FULL"
    );
    expect(await Voucher.count({ where: { companyId: CO, isDeleted: false } })).toBe(3);

    // Exactly what a CDC tick sends: one altered voucher, not the register.
    const stats = await mirror.upsertVouchers(CO, [vch("v2", "2024-05-02")], "CDC_1", {
      tombstoneMissing: false
    });

    expect(stats.tombstoned).toBe(0);
    expect(await Voucher.count({ where: { companyId: CO, isDeleted: false } })).toBe(3);
  });

  itDb()("a complete set still tombstones what genuinely vanished", async () => {
    await mirror.upsertVouchers(CO, [vch("v1", "2024-05-01"), vch("v2", "2024-05-02")], "RUN_FULL");
    // v2 is gone from Tally, and this caller is handing over the whole register.
    const stats = await mirror.upsertVouchers(CO, [vch("v1", "2024-05-01")], "RUN_FULL_2");

    expect(stats.tombstoned).toBe(1);
    expect(await Voucher.count({ where: { companyId: CO, isDeleted: false } })).toBe(1);
  });
});

describe("Change detection excludes per-read bookkeeping", () => {
  /*
   * The whole economy of the sync loop rests on one claim: a company where
   * nothing moved costs no writes. That held for masters and quietly failed for
   * vouchers, because the canonical sales voucher is stamped with a fresh
   * `syncRunId` and `sourceFetchedAt` on every single read. Hashing those made
   * every voucher look changed, so a register of 10,812 was rewritten in full
   * every five minutes against a Tally that had not changed at all.
   *
   * The ledger test above could never have caught it — masters carry no such
   * fields. These cases pin the rule at the level it actually matters: what the
   * hash is allowed to notice.
   */
  const voucher = () => ({
    sourceObjectId: "vch-1",
    objectType: "SalesVoucher",
    voucherType: "Sales",
    voucherDate: "2024-05-10",
    partyLedgerName: "Acme Traders",
    amount: "1000.00"
  });

  test("a re-read of identical data hashes the same despite new run id and fetch time", () => {
    const firstRead = {
      ...voucher(),
      syncRunId: "RUN_1", sourceFetchedAt: "2026-01-01T00:00:00.000Z",
      extractionRunId: "EX_1", checksum: "chk_1"
    };
    const secondRead = {
      ...voucher(),
      syncRunId: "RUN_2", sourceFetchedAt: "2026-06-30T12:34:56.000Z",
      extractionRunId: "EX_2", checksum: "chk_2"
    };
    expect(mirror.contentHash(firstRead)).toBe(mirror.contentHash(secondRead));
  });

  test("an AlterId only one of the two writers stamps is not a content change", () => {
    // CDC stamps AlterId; the full sync's pass does not. Hashing it meant the
    // same voucher hashed two ways depending on who wrote it last, and the two
    // writers rewrote the same 928 records on every cycle forever.
    const base = { ...voucher(), syncRunId: "RUN_1", sourceFetchedAt: "2026-01-01T00:00:00.000Z" };
    expect(mirror.contentHash({ ...base, alterId: 40916 })).toBe(mirror.contentHash({ ...base, alterId: null }));
    expect(mirror.contentHash({ ...base, alterId: 40916 })).toBe(mirror.contentHash(base));
  });

  test("a real content change still moves the hash", () => {
    const base = { ...voucher(), syncRunId: "RUN_1", sourceFetchedAt: "2026-01-01T00:00:00.000Z" };
    expect(mirror.contentHash({ ...base, amount: "2000.00" })).not.toBe(mirror.contentHash(base));
    expect(mirror.contentHash({ ...base, voucherDate: "2024-05-11" })).not.toBe(mirror.contentHash(base));
    expect(mirror.contentHash({ ...base, partyLedgerName: "Other Co" })).not.toBe(mirror.contentHash(base));
    // An alteration Tally reports via AlterId always moves real content too, so
    // excluding AlterId above never hides a genuine change.
    expect(mirror.contentHash({ ...base, alterId: 40917, amount: "2000.00" })).not.toBe(mirror.contentHash(base));
  });
});
