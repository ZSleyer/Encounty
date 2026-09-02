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
import {
  isLoopbackHost,
  matchesPinnedCertificate,
  parseTlsEndpoint,
  setPinnedFingerprint,
  type BackendTlsEndpoint,
} from "./cert-pinning";

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

/** Whether the verify proc is installed. Installing it twice would replace it. */
let procInstalled = false;

/**
 * The pin refresh currently in flight, so a burst of handshakes against a
 * reissued certificate probes the backend once instead of once each.
 */
let pinRefresh: Promise<boolean> | null = null;

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
 * certificate, after re-reading the fingerprint once when the offered loopback
 * certificate is unknown. Everything else returns -3, which hands the decision
 * back to Chromium's normal verification, so external HTTPS keeps being checked
 * as usual. Returning 0 unconditionally, or reaching for
 * --ignore-certificate-errors or the certificate-error event, would switch
 * certificate checking off for every URL the app touches.
 */
export function pinBackendCertificate(fingerprint: string): void {
  if (setPinnedFingerprint(fingerprint)) {
    log.warn("Backend certificate changed, updating the pin");
  }

  if (procInstalled) return;
  procInstalled = true;
  // The pin is read at call time, never captured, so a certificate the backend
  // reissues later is adopted instead of rejected forever.
  session.defaultSession.setCertificateVerifyProc(verifyBackendCertificate);
}

/**
 * Runs one pin refresh at a time and hands every concurrent caller the same
 * result, so a page full of parallel requests to a reissued certificate costs
 * a single probe. Never rejects: a failed probe simply leaves the pin alone.
 */
function refreshPin(): Promise<boolean> {
  pinRefresh ??= repinBackendCertificate()
    .catch((err) => {
      log.info("Pin refresh failed:", err);
      return false;
    })
    .finally(() => {
      pinRefresh = null;
    });
  return pinRefresh;
}

/**
 * Decides a single certificate verification for the default session.
 *
 * A loopback certificate that misses the pin is almost always the backend
 * having reissued its pair, and rejecting it here is not a decision that can be
 * taken back: Chromium caches the verdict per certificate and stops consulting
 * this proc for it, so every later request would fail with
 * ERR_CERT_AUTHORITY_INVALID until the app restarts (measured on Electron
 * 43.4.0, Chromium 150). The fingerprint is therefore re-read over plain HTTP
 * before answering, so the verdict that gets cached is the correct one.
 */
function verifyBackendCertificate(
  request: Electron.Request,
  callback: (verificationResult: number) => void,
): void {
  if (matchesPinnedCertificate(request.hostname, request.certificate)) {
    callback(VERIFY_TRUST);
    return;
  }
  if (!isLoopbackHost(request.hostname)) {
    callback(VERIFY_DEFAULT);
    return;
  }
  void refreshPin().then((changed) => {
    if (changed) log.warn("Backend presented a reissued certificate, pin refreshed");
    const trusted = matchesPinnedCertificate(request.hostname, request.certificate);
    callback(trusted ? VERIFY_TRUST : VERIFY_DEFAULT);
  });
}

/**
 * Re-reads the backend's TLS endpoint and updates the pin, for use after the
 * backend restarts.
 *
 * Reports whether the fingerprint changed. Calling this after a backend
 * restart only brings the refresh forward: the verify proc refreshes the pin
 * by itself on the first handshake that misses it, which is what keeps
 * Chromium from caching a rejection the new pin could no longer undo.
 */
export async function repinBackendCertificate(): Promise<boolean> {
  const version = await fetchBackendVersion();
  if (!version?.tls) return false;
  return setPinnedFingerprint(version.tls.fingerprint);
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
