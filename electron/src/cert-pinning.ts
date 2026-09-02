/**
 * cert-pinning.ts holds the pure decision logic that pins the Go backend's
 * self-signed loopback certificate.
 *
 * It imports nothing from Electron on purpose: the comparison below is the only
 * thing standing between a self-signed certificate and Chromium's normal
 * verification, so it has to be unit testable without an Electron instance. The
 * Electron wiring lives in tls.ts.
 */

import { createHash } from "node:crypto";

/**
 * The only hosts the pin may ever apply to. The backend binds its TLS listener
 * to loopback, so a pinned certificate presented by anything else is a
 * mismatch by definition.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** A SHA-256 digest as the backend reports it: 64 lowercase hex characters. */
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/** The subset of Electron's Certificate structure the pin looks at. */
export interface PinnableCertificate {
  /** PEM encoded certificate data. */
  data?: string;
  /** Chromium's own fingerprint string, formatted "sha256/<base64>". */
  fingerprint?: string;
}

/** The backend's loopback TLS endpoint as reported by /api/version. */
export interface BackendTlsEndpoint {
  /** Port of the TLS listener. */
  port: number;
  /** Lowercase hex SHA-256 over the certificate's DER bytes. */
  fingerprint: string;
}

/**
 * Normalizes a hex SHA-256 fingerprint: drops the separators different tools
 * print it with and lowercases the rest.
 *
 * Returns null unless the result is exactly 32 bytes of hex, so a truncated,
 * padded or otherwise malformed value can never end up being used as a pin.
 */
export function normalizeHexFingerprint(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.replaceAll(/[\s:-]/g, "").toLowerCase();
  return HEX_SHA256.test(hex) ? hex : null;
}

/**
 * Parses Chromium's fingerprint string, "sha256/" followed by the base64 of the
 * digest over the DER bytes, into lowercase hex. A plain hex string is accepted
 * as well. Returns null for any other digest algorithm or a hash that is not 32
 * bytes long.
 */
export function parseChromiumFingerprint(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^sha256\/([A-Za-z0-9+/=]+)$/i.exec(value.trim());
  if (!match) return normalizeHexFingerprint(value);
  const digest = Buffer.from(match[1], "base64");
  return digest.length === 32 ? digest.toString("hex") : null;
}

/**
 * Computes the lowercase hex SHA-256 over a PEM certificate's DER bytes, which
 * is exactly what the backend reports in /api/version. Returns null when the
 * PEM body is absent or does not decode.
 */
export function fingerprintFromPem(pem: string | null | undefined): string | null {
  if (!pem) return null;
  const match = /-{5}BEGIN CERTIFICATE-{5}([A-Za-z0-9+/=\s]+?)-{5}END CERTIFICATE-{5}/.exec(pem);
  if (!match) return null;
  const der = Buffer.from(match[1].replaceAll(/\s+/g, ""), "base64");
  if (der.length === 0) return null;
  return createHash("sha256").update(der).digest("hex");
}

/**
 * Derives a certificate's SHA-256 fingerprint as lowercase hex.
 *
 * The PEM body is the primary source: hashing it here does not depend on how a
 * given Electron version happens to format its own fingerprint field. That
 * field is only consulted when the PEM is missing.
 */
export function certificateFingerprint(
  cert: PinnableCertificate | null | undefined,
): string | null {
  if (!cert) return null;
  return fingerprintFromPem(cert.data) ?? parseChromiumFingerprint(cert.fingerprint);
}

/**
 * Decides whether a certificate may be trusted by the pin.
 *
 * Both conditions have to hold: the request went to a loopback host, and the
 * certificate hashes to exactly the fingerprint the backend reported over plain
 * HTTP. Any other host, a certificate whose fingerprint cannot be derived, an
 * unusable pin and a single differing hex digit all return false, and the
 * caller then leaves the decision to Chromium's normal verification.
 */
export function isPinnedCertificate(
  hostname: string,
  cert: PinnableCertificate | null | undefined,
  pinnedFingerprint: string,
): boolean {
  const pinned = normalizeHexFingerprint(pinnedFingerprint);
  if (pinned === null) return false;
  if (typeof hostname !== "string" || !LOOPBACK_HOSTS.has(hostname.toLowerCase())) return false;
  const actual = certificateFingerprint(cert);
  return actual !== null && actual === pinned;
}

/**
 * Reads the TLS endpoint out of a /api/version payload.
 *
 * Returns null whenever the fields are absent, zero or malformed, which is the
 * documented signal that the backend has no TLS listener. The caller then stays
 * on plain HTTP rather than pinning something it cannot verify.
 */
export function parseTlsEndpoint(payload: unknown): BackendTlsEndpoint | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { tls_port: port, tls_fingerprint: fingerprint } = payload as {
    tls_port?: unknown;
    tls_fingerprint?: unknown;
  };
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (typeof fingerprint !== "string") return null;
  const normalized = normalizeHexFingerprint(fingerprint);
  if (normalized === null) return null;
  return { port, fingerprint: normalized };
}
