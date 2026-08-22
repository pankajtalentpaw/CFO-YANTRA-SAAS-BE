const { sha256, recordChecksum, canonicalJsonString } = require("../src/utils/checksum");

describe("Checksum Utility", () => {
  test("generates standard deterministic SHA-256 hash", () => {
    const hash = sha256("test-payload");
    expect(hash).toBe("6f06dd0e26608013eff30bb1e951cda7de3fdd9e78e907470e0dd5c0ed25e273");
  });

  test("generates identical record checksum regardless of object key insertion order", () => {
    const objA = { b: 2, a: 1, c: { y: 20, x: 10 } };
    const objB = { a: 1, c: { x: 10, y: 20 }, b: 2 };

    const checkA = recordChecksum(objA);
    const checkB = recordChecksum(objB);

    expect(checkA).toBe(checkB);
    expect(canonicalJsonString(objA)).toBe(canonicalJsonString(objB));
  });

  test("produces different hashes for different content", () => {
    const hash1 = sha256("chunk-1");
    const hash2 = sha256("chunk-2");
    expect(hash1).not.toBe(hash2);
  });
});
