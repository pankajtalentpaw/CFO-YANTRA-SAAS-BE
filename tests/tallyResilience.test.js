jest.mock("axios", () => ({ post: jest.fn(), get: jest.fn() }));

const axios = require("axios");
const breaker = require("../src/integrations/tally/tally.breaker");
const { sendXml, checkHeartbeat } = require("../src/integrations/tally/tally.client");
const { classifyError } = require("../src/services/diagnostics.service");
const { classifyTransportFailure, INGESTION_ERROR_CODES } = require("../src/integrations/tally/sales/factSales.errors");
const { FAILURE_CODES } = require("../src/constants");

const PROBE_XML = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CompanyCollection</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>`;

/** The error axios raises when Tally accepts the socket and never answers. */
function timeoutError() {
  const error = new Error("timeout of 10000ms exceeded");
  error.code = "ECONNABORTED";
  return error;
}

beforeEach(() => {
  axios.post.mockReset();
  axios.get.mockReset();
  breaker.reset();
});

describe("Tally breaker", () => {
  test("one timeout is enough to stop the next call from waiting at all", async () => {
    axios.post.mockRejectedValueOnce(timeoutError());
    await expect(sendXml(PROBE_XML)).rejects.toThrow(/timeout/i);
    expect(axios.post).toHaveBeenCalledTimes(1);

    // The second call must be refused locally, without touching the network.
    const startedAt = Date.now();
    await expect(sendXml(PROBE_XML)).rejects.toMatchObject({ code: "ETALLYUNAVAILABLE" });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBeLessThan(50);
  });

  test("the cooldown lengthens while Tally stays down", async () => {
    axios.post.mockRejectedValue(timeoutError());
    await expect(sendXml(PROBE_XML)).rejects.toThrow();
    const first = breaker.retryInMs();

    // Force the first cooldown to elapse, then fail again.
    breaker.reset();
    await expect(sendXml(PROBE_XML)).rejects.toThrow();
    breaker.recordFailure(timeoutError());
    expect(breaker.retryInMs()).toBeGreaterThan(first);
  });

  test("a live heartbeat closes the breaker, so work resumes on its own", async () => {
    axios.post.mockRejectedValueOnce(timeoutError());
    await expect(sendXml(PROBE_XML)).rejects.toThrow();
    expect(breaker.isOpen()).toBe(true);

    // The heartbeat is the recovery probe and is never blocked by the breaker.
    axios.get.mockResolvedValueOnce({ status: 200 });
    const heartbeat = await checkHeartbeat({ timeoutMs: 1000 });
    expect(heartbeat.alive).toBe(true);
    expect(breaker.isOpen()).toBe(false);

    axios.post.mockResolvedValueOnce({ status: 200, data: "<ENVELOPE></ENVELOPE>" });
    await expect(sendXml(PROBE_XML)).resolves.toMatchObject({ statusCode: 200 });
  });

  test("a Tally that answers with an error is still reachable and stays callable", async () => {
    // A TDL fault comes back as a normal 200 body, not a transport failure.
    axios.post.mockResolvedValue({ status: 200, data: "<ENVELOPE><LINEERROR>Unknown collection</LINEERROR></ENVELOPE>" });
    await sendXml(PROBE_XML);
    expect(breaker.isOpen()).toBe(false);

    await expect(sendXml(PROBE_XML)).resolves.toMatchObject({ statusCode: 200 });
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test("quick heartbeat skips the POST fallback that used to double the wait", async () => {
    axios.get.mockRejectedValueOnce(timeoutError());
    const heartbeat = await checkHeartbeat({ timeoutMs: 500, quick: true });
    expect(heartbeat.alive).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("requests never overlap — Tally is single-threaded", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    axios.post.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { status: 200, data: "<ENVELOPE></ENVELOPE>" };
    });

    await Promise.all([sendXml(PROBE_XML), sendXml(PROBE_XML), sendXml(PROBE_XML)]);
    expect(maxInFlight).toBe(1);
    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  test("a rejected request does not break the queue for the caller behind it", async () => {
    axios.post
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "ESOMETHING" }))
      .mockResolvedValueOnce({ status: 200, data: "<ENVELOPE></ENVELOPE>" });

    const [first, second] = await Promise.allSettled([sendXml(PROBE_XML), sendXml(PROBE_XML)]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("fulfilled");
  });
});

describe("The heartbeat never wedges Tally", () => {
  test("its POST fallback defines the collection it asks for", async () => {
    // The old probe named CompanyCollection without defining it, which raised a
    // TDL modal inside Tally and blocked the gateway — the health check became
    // the cause of the outage it was meant to detect.
    axios.get.mockRejectedValueOnce(timeoutError());
    axios.post.mockResolvedValueOnce({ status: 200, data: "<ENVELOPE></ENVELOPE>" });

    await checkHeartbeat({ timeoutMs: 500 });

    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain("<ID>CompanyCollection</ID>");
    expect(body).toContain('<COLLECTION NAME="CompanyCollection"');
  });
});

describe("Bounded queueing", () => {
  test("a caller that waited too long gives up its slot instead of hanging", async () => {
    let releaseFirst;
    axios.post.mockImplementationOnce(
      () => new Promise((resolve) => { releaseFirst = () => resolve({ status: 200, data: "<ENVELOPE></ENVELOPE>" }); })
    );

    const first = sendXml(PROBE_XML);
    // Second caller is only allowed to queue briefly.
    const second = breaker.runExclusive(() => axios.post("x"), { maxWaitMs: 20 });

    await expect(second).rejects.toMatchObject({ code: "ETALLYBUSY" });
    // It never reached Tally: only the first request was ever dialled.
    expect(axios.post).toHaveBeenCalledTimes(1);

    releaseFirst();
    await expect(first).resolves.toMatchObject({ statusCode: 200 });
  });

  test("a request already on the wire is never cut off by the queue cap", async () => {
    axios.post.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, data: "<ENVELOPE></ENVELOPE>" }), 60))
    );
    // The cap is shorter than the call, but the call had already started.
    await expect(breaker.runExclusive(() => axios.post("x"), { maxWaitMs: 20 })).resolves.toMatchObject({ status: 200 });
  });
});

describe("Paused Tally is reported as paused, not as a fresh timeout", () => {
  test("diagnostics classify the breaker's refusal", () => {
    const diagnostic = classifyError(Object.assign(new Error("paused"), { code: "ETALLYUNAVAILABLE" }));
    expect(diagnostic.failureCode).toBe(FAILURE_CODES.TALLY_PAUSED);
    expect(diagnostic.retryable).toBe(true);
    expect(diagnostic.userAction).toMatch(/no restart is needed/i);
  });

  test("ingestion classifies it too, and marks it retryable", () => {
    const code = classifyTransportFailure({ errorCode: "ETALLYUNAVAILABLE", errorMessage: "paused for 5s" });
    expect(code).toBe(INGESTION_ERROR_CODES.TALLY_PAUSED);
  });

  test("a real timeout is still a timeout", () => {
    const code = classifyTransportFailure({ errorMessage: "timeout of 10000ms exceeded" });
    expect(code).toBe(INGESTION_ERROR_CODES.TALLY_TIMEOUT);
  });
});
