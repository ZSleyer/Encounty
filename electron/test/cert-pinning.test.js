// Checks the certificate pin that lets the renderer talk to the Go backend's
// self-signed TLS listener. Runs on the compiled output with the Node test
// runner, so it needs no test framework and no Electron instance.
//
// The certificate below is a throwaway self-signed one generated for this test;
// FINGERPRINT is the SHA-256 over its DER bytes, the same value the backend
// reports in /api/version.

const test = require("node:test");
const assert = require("node:assert");

const {
  certificateFingerprint,
  fingerprintFromPem,
  isPinnedCertificate,
  matchesPinnedCertificate,
  normalizeHexFingerprint,
  pinnedCertificateFingerprint,
  setPinnedFingerprint,
  parseChromiumFingerprint,
  parseTlsEndpoint,
} = require("../dist/cert-pinning.js");

const PEM = `-----BEGIN CERTIFICATE-----
MIIDIzCCAgugAwIBAgIUNzXRLYsrbGXGT7cyI0KZyDEhWj4wDQYJKoZIhvcNAQEL
BQAwEzERMA8GA1UEAwwIRW5jb3VudHkwHhcNMjYwOTAyMTkxNDQyWhcNMzYwODMw
MTkxNDQyWjATMREwDwYDVQQDDAhFbmNvdW50eTCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBALStvrTWn5ECAmdqc+zOXZjQD0ZIQzK/rz9WGd5phFgTecm+
l2ZLTqkrnuaRF+oZtYQpVELC4Yzio4XWxOnADB/XY9GjVwIibW/20LjcjSpQlEps
KlArHWTZIQ+naD/LOfQD97X491pZi9BEVFCJu9wT6cF4PhwJB6yKUJvH6adsGwUW
kNPkdy3Ak5EHEML9g0S/ZD0SN2FMI7G7QLP/t275Crfo3rI1n+9lwHlBLLRm+gTk
Q54Rg4QdS25nOUOI5vBVRWy3BMf9fA/wof/x4K9R2TZuwry/Hm1YyOSweR1GUKtJ
M24jcZi7PIdu1W3RHrndVjQWCaeI/0L0T1vlx7kCAwEAAaNvMG0wHQYDVR0OBBYE
FDLvl7l2TLpAh+UGvoWVs9ENi1pXMB8GA1UdIwQYMBaAFDLvl7l2TLpAh+UGvoWV
s9ENi1pXMA8GA1UdEwEB/wQFMAMBAf8wGgYDVR0RBBMwEYcEfwAAAYIJbG9jYWxo
b3N0MA0GCSqGSIb3DQEBCwUAA4IBAQBIMc2Tv3/+xTxpncVXsALvr9Ia/xuZcioi
+SmrYhZv7fkiYpL41gm4OpcUF7Xy0VCj4Jvq0XihosyWtTc0QoNoHYl6rX0bZxnF
/zqFdKArhE17nEt5SEIoeE7cv9PrKAL2mMqTuquRJRInwJoLQ6YGms/sljFSXUd9
jEvqyZgHEu73wsOlqjM8gALyXdAW2m8F3wCElQzhssK61qGZwgLxwktAFBlSXRNy
fMHhFbKPbD6WaWr11Z9dM9Cuepsfaqhun5BM2EXOonw2QZCoNdbuOOPnSPPi5rpD
tVMPOdBrPMynpfRqGE7PeYs12wqQm5py+5QHdQoIe/xKm/DemIoD
-----END CERTIFICATE-----
`;

const FINGERPRINT = "a3146d423ff488acd1f927fb14da69ed0fc4a91e63a6bacb974cd279a017618f";
const CHROMIUM_FINGERPRINT = "sha256/oxRtQj/0iKzR+Sf7FNpp7Q/EqR5jprrLl0zSeaAXYY8=";

// A single flipped hex digit. The pin must treat this like any other stranger.
const WRONG_FINGERPRINT = `b${FINGERPRINT.slice(1)}`;

test("fingerprintFromPem hashes the DER bytes, not the PEM text", () => {
  assert.strictEqual(fingerprintFromPem(PEM), FINGERPRINT);
});

test("fingerprintFromPem rejects input without a certificate block", () => {
  for (const input of [
    "",
    "not a certificate",
    "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----",
  ]) {
    assert.strictEqual(fingerprintFromPem(input), null);
  }
});

test("parseChromiumFingerprint decodes the sha256/<base64> form", () => {
  assert.strictEqual(parseChromiumFingerprint(CHROMIUM_FINGERPRINT), FINGERPRINT);
});

test("parseChromiumFingerprint rejects other algorithms and short digests", () => {
  assert.strictEqual(parseChromiumFingerprint("sha1/2jmj7l5rSw0yVb/vlWAYkK/YBwk="), null);
  assert.strictEqual(parseChromiumFingerprint("sha256/AAAA"), null);
  assert.strictEqual(parseChromiumFingerprint(""), null);
});

test("normalizeHexFingerprint strips separators and lowercases", () => {
  const spaced =
    "A3:14:6D:42:3F:F4:88:AC:D1:F9:27:FB:14:DA:69:ED:0F:C4:A9:1E:63:A6:BA:CB:97:4C:D2:79:A0:17:61:8F";
  assert.strictEqual(normalizeHexFingerprint(spaced), FINGERPRINT);
});

test("normalizeHexFingerprint rejects anything that is not 32 bytes of hex", () => {
  for (const input of [
    "",
    "zz",
    FINGERPRINT.slice(0, 63),
    `${FINGERPRINT}00`,
    `${FINGERPRINT.slice(0, 63)}g`,
  ]) {
    assert.strictEqual(normalizeHexFingerprint(input), null);
  }
});

test("certificateFingerprint prefers the PEM over the reported fingerprint", () => {
  // A certificate whose reported fingerprint disagrees with its own bytes must
  // hash to the bytes, otherwise the field would be the thing being trusted.
  const cert = { data: PEM, fingerprint: `sha256/${Buffer.alloc(32).toString("base64")}` };
  assert.strictEqual(certificateFingerprint(cert), FINGERPRINT);
});

test("certificateFingerprint falls back to the reported fingerprint without a PEM", () => {
  assert.strictEqual(certificateFingerprint({ fingerprint: CHROMIUM_FINGERPRINT }), FINGERPRINT);
  assert.strictEqual(certificateFingerprint({}), null);
  assert.strictEqual(certificateFingerprint(null), null);
});

test("isPinnedCertificate trusts the pinned certificate on loopback", () => {
  for (const host of ["127.0.0.1", "localhost", "LOCALHOST"]) {
    assert.strictEqual(isPinnedCertificate(host, { data: PEM }, FINGERPRINT), true);
  }
  // Also when only the reported fingerprint is available.
  assert.strictEqual(
    isPinnedCertificate("127.0.0.1", { fingerprint: CHROMIUM_FINGERPRINT }, FINGERPRINT),
    true,
  );
});

test("isPinnedCertificate refuses any host that is not loopback", () => {
  for (const host of ["example.com", "127.0.0.2", "192.168.1.10", "evil.localhost", "", "::1"]) {
    assert.strictEqual(isPinnedCertificate(host, { data: PEM }, FINGERPRINT), false);
  }
});

test("isPinnedCertificate refuses a certificate that is not the pinned one", () => {
  assert.strictEqual(isPinnedCertificate("127.0.0.1", { data: PEM }, WRONG_FINGERPRINT), false);
  assert.strictEqual(isPinnedCertificate("127.0.0.1", { data: "garbage" }, FINGERPRINT), false);
  assert.strictEqual(isPinnedCertificate("127.0.0.1", {}, FINGERPRINT), false);
  assert.strictEqual(isPinnedCertificate("127.0.0.1", null, FINGERPRINT), false);
});

test("isPinnedCertificate refuses an unusable pin", () => {
  for (const pin of ["", "0", FINGERPRINT.slice(0, 32)]) {
    assert.strictEqual(isPinnedCertificate("127.0.0.1", { data: PEM }, pin), false);
  }
});

test("parseTlsEndpoint reads a well formed version payload", () => {
  assert.deepStrictEqual(
    parseTlsEndpoint({
      display: "1.2.3",
      tls_port: 8193,
      tls_fingerprint: FINGERPRINT.toUpperCase(),
    }),
    { port: 8193, fingerprint: FINGERPRINT },
  );
});

test("parseTlsEndpoint returns null whenever TLS is unavailable or malformed", () => {
  const payloads = [
    null,
    "not an object",
    { display: "1.2.3" },
    { tls_port: 0, tls_fingerprint: FINGERPRINT },
    { tls_port: 8193, tls_fingerprint: "" },
    { tls_port: 8193 },
    { tls_fingerprint: FINGERPRINT },
    { tls_port: "8193", tls_fingerprint: FINGERPRINT },
    { tls_port: 8193.5, tls_fingerprint: FINGERPRINT },
    { tls_port: 70000, tls_fingerprint: FINGERPRINT },
    { tls_port: 8193, tls_fingerprint: "deadbeef" },
  ];
  for (const payload of payloads) {
    assert.strictEqual(parseTlsEndpoint(payload), null, JSON.stringify(payload));
  }
});

// --- The pin is mutable, so a reissued certificate can be adopted ---
//
// The backend rewrites its certificate when the pair on disk is lost or
// corrupted. A pin captured once at startup would reject the backend for the
// rest of the session, so these cover the state the verify proc reads.

test("nothing is trusted before a pin is set", () => {
  setPinnedFingerprint(null);
  assert.strictEqual(pinnedCertificateFingerprint(), null);
  assert.strictEqual(matchesPinnedCertificate("127.0.0.1", { data: PEM }), false);
});

test("setting the first pin does not count as a change", () => {
  setPinnedFingerprint(null);
  assert.strictEqual(setPinnedFingerprint(FINGERPRINT), false);
  assert.strictEqual(matchesPinnedCertificate("127.0.0.1", { data: PEM }), true);
});

test("re-setting the same pin does not count as a change", () => {
  setPinnedFingerprint(null);
  setPinnedFingerprint(FINGERPRINT);
  assert.strictEqual(setPinnedFingerprint(FINGERPRINT.toUpperCase()), false);
  assert.strictEqual(matchesPinnedCertificate("127.0.0.1", { data: PEM }), true);
});

test("a reissued certificate replaces the pin and is then trusted", () => {
  setPinnedFingerprint(null);
  setPinnedFingerprint("b".repeat(64));
  assert.strictEqual(matchesPinnedCertificate("127.0.0.1", { data: PEM }), false);
  assert.strictEqual(setPinnedFingerprint(FINGERPRINT), true);
  assert.strictEqual(matchesPinnedCertificate("127.0.0.1", { data: PEM }), true);
});

test("a malformed pin clears the trust rather than widening it", () => {
  setPinnedFingerprint(null);
  setPinnedFingerprint(FINGERPRINT);
  setPinnedFingerprint("nonsense");
  assert.strictEqual(pinnedCertificateFingerprint(), null);
  assert.strictEqual(matchesPinnedCertificate("127.0.0.1", { data: PEM }), false);
});

test("the pin never trusts a foreign host", () => {
  setPinnedFingerprint(null);
  setPinnedFingerprint(FINGERPRINT);
  assert.strictEqual(matchesPinnedCertificate("example.com", { data: PEM }), false);
});
