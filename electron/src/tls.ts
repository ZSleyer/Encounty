/**
 * tls.ts connects the Go backend's loopback TLS listener to Electron.
 *
 * The backend keeps its plain HTTP listener and adds a TLS one presenting a
 * self-signed certificate, which Chromium rejects on sight. Pinning that single
 * certificate by fingerprint is what makes the endpoint usable, and HTTP/2 over
 * TLS is what lifts the six-connections-per-origin limit that queues the dex
 * page's sprite requests. Browsers refuse cleartext h2c, so TLS is the only way
 * to get there.
 */

import { net, session } from "electron";
import { BACKEND_PORT } from "./config";
import { log } from "./logger";
import { isPinnedCertificate, parseTlsEndpoint, type BackendTlsEndpoint } from "./cert-pinning";

/** Chromium's "trust this certificate" verification result. */
const VERIFY_TRUST = 0;

/**
 * Chromium's "fall back to the default verification result". Everything the pin
 * does not recognise goes here, so a wrong certificate is rejected by the same
 * checks that would have applied without the pin.
 */
const VERIFY_DEFAULT = -3;

/** How long the version probe may take before the app carries on without TLS. */
const VERSION_TIMEOUT_MS = 2000;

/** The backend's plain HTTP base, which stays reachable whether or not TLS is up. */
export const httpBaseUrl = `http://localhost:${BACKEND_PORT}`;

/** What the app needs out of the backend's /api/version response. */
export interface BackendVersion {
  /** Human readable build version, used for the macOS About panel. */
  display?: string;
  /** The TLS endpoint, or null when the backend reports none. */
  tls: BackendTlsEndpoint | null;
}

/**
 * Asks the backend over plain HTTP for its build version and, if it has one,
 * its TLS endpoint.
 *
 * Returns null when the backend is unreachable or answers with an error. An
 * older backend that does not know the tls_port and tls_fingerprint fields
 * yields a version with tls set to null, which keeps the app on plain HTTP.
 */
export async function fetchBackendVersion(): Promise<BackendVersion | null> {
  try {
    const res = await net.fetch(`${httpBaseUrl}/api/version`, {
      signal: AbortSignal.timeout(VERSION_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { display?: string };
    return { display: payload.display, tls: parseTlsEndpoint(payload) };
  } catch (err) {
    log.info("Backend version probe failed, staying on plain HTTP:", err);
    return null;
  }
}

/**
 * Pins the backend's self-signed certificate for the default session.
 *
 * The proc returns 0 only for a loopback host presenting exactly the pinned
 * certificate. Everything else returns -3, which hands the decision back to
 * Chromium's normal verification, so external HTTPS keeps being checked as
 * usual. Returning 0 unconditionally, or reaching for
 * --ignore-certificate-errors or the certificate-error event, would switch
 * certificate checking off for every URL the app touches.
 */
export function pinBackendCertificate(fingerprint: string): void {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (isPinnedCertificate(request.hostname, request.certificate, fingerprint)) {
      callback(VERIFY_TRUST);
      return;
    }
    callback(VERIFY_DEFAULT);
  });
}

/**
 * Builds the base URL the renderer should send API and WebSocket traffic to.
 *
 * The literal 127.0.0.1 is deliberate: the Go listener binds IPv4 loopback, and
 * "localhost" can resolve to ::1 first.
 */
export function apiBaseUrlFor(tls: BackendTlsEndpoint | null): string {
  return tls ? `https://127.0.0.1:${tls.port}` : httpBaseUrl;
}
