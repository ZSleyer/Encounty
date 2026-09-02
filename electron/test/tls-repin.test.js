// Checks how the certificate verify proc reacts to a backend that reissued its
// certificate. Runs on the compiled output with the Node test runner.
//
// dist/tls.js is the one pinning module that talks to Electron, and requiring
// it under plain Node would hand it the launcher's path string instead of the
// API. A stub is therefore primed in the module cache first: it answers
// /api/version with whatever the test wants the backend to report and records
// how often the verify proc is installed.
//
// The behaviour under test was measured against the real backend on Electron
// 43.4.0 (Chromium 150): once the proc rejects a certificate, Chromium caches
// that verdict per certificate and never consults the proc for it again, so a
// pin updated afterwards can no longer rescue the connection. The proc has to
// re-read the fingerprint before it answers, which is what these tests pin
// down.

const test = require("node:test");
const assert = require("node:assert");

const electronPath = require.resolve("electron");

/** What the stubbed backend answers on /api/version, or null when it is down. */
let versionPayload = null;
/** How many version probes the module under test has issued. */
let fetchCount = 0;
/** The verify proc the module installed, and how often it installed one. */
let installedProc = null;
let installCount = 0;

const electronStub = {
  net: {
    fetch() {
      fetchCount++;
      if (versionPayload === null) return Promise.reject(new Error("backend unreachable"));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(versionPayload) });
    },
  },
  session: {
    defaultSession: {
      setCertificateVerifyProc(proc) {
        installedProc = proc;
        installCount++;
      },
    },
  },
};

require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: electronStub,
};

const { pinBackendCertificate, repinBackendCertificate } = require("../dist/tls.js");
const { pinnedCertificateFingerprint } = require("../dist/cert-pinning.js");

/** Chromium's verification results: trust the certificate, or fall back. */
const TRUST = 0;
const DEFAULT = -3;

const FP_A = "aa".repeat(32);
const FP_B = "bb".repeat(32);
const FP_C = "cc".repeat(32);
const FP_STRANGER = "dd".repeat(32);

/** Builds the certificate shape the proc sees, in Chromium's own notation. */
function certFor(hex) {
  return { fingerprint: `sha256/${Buffer.from(hex, "hex").toString("base64")}` };
}

/** Makes the stubbed backend report a TLS listener with this fingerprint. */
function backendReports(hex) {
  versionPayload = { display: "test", tls_port: 8193, tls_fingerprint: hex };
}

/** Runs the installed verify proc and resolves with the result it hands back. */
function verify(hostname, hex) {
  return new Promise((resolve) => {
    installedProc({ hostname, certificate: certFor(hex) }, resolve);
  });
}

test("installs the verify proc exactly once across repeated pins", () => {
  backendReports(FP_A);
  pinBackendCertificate(FP_A);
  pinBackendCertificate(FP_A);
  assert.strictEqual(installCount, 1);
  assert.strictEqual(typeof installedProc, "function");
});

test("trusts the pinned certificate without probing the backend", async () => {
  const before = fetchCount;
  assert.strictEqual(await verify("127.0.0.1", FP_A), TRUST);
  assert.strictEqual(fetchCount, before);
});

test("leaves a non-loopback host to Chromium and never probes for it", async () => {
  const before = fetchCount;
  assert.strictEqual(await verify("example.com", FP_STRANGER), DEFAULT);
  assert.strictEqual(fetchCount, before);
});

test("adopts a reissued certificate instead of caching a rejection", async () => {
  backendReports(FP_B);
  assert.strictEqual(await verify("127.0.0.1", FP_B), TRUST);
  assert.strictEqual(pinnedCertificateFingerprint(), FP_B);
});

test("probes once for a burst of handshakes against the same new certificate", async () => {
  backendReports(FP_C);
  const before = fetchCount;
  const results = await Promise.all([
    verify("127.0.0.1", FP_C),
    verify("localhost", FP_C),
    verify("127.0.0.1", FP_C),
  ]);
  assert.deepStrictEqual(results, [TRUST, TRUST, TRUST]);
  assert.strictEqual(fetchCount, before + 1);
  assert.strictEqual(pinnedCertificateFingerprint(), FP_C);
});

test("falls back for a loopback certificate the backend does not report", async () => {
  backendReports(FP_C);
  assert.strictEqual(await verify("127.0.0.1", FP_STRANGER), DEFAULT);
  assert.strictEqual(pinnedCertificateFingerprint(), FP_C);
});

test("falls back when the backend cannot be reached, leaving the pin alone", async () => {
  versionPayload = null;
  assert.strictEqual(await verify("127.0.0.1", FP_STRANGER), DEFAULT);
  assert.strictEqual(pinnedCertificateFingerprint(), FP_C);
});

test("repinBackendCertificate reports whether the fingerprint changed", async () => {
  backendReports(FP_C);
  assert.strictEqual(await repinBackendCertificate(), false);
  backendReports(FP_A);
  assert.strictEqual(await repinBackendCertificate(), true);
  assert.strictEqual(pinnedCertificateFingerprint(), FP_A);
});

test("repinBackendCertificate keeps the pin when the backend is unreachable", async () => {
  versionPayload = null;
  assert.strictEqual(await repinBackendCertificate(), false);
  assert.strictEqual(pinnedCertificateFingerprint(), FP_A);
});
