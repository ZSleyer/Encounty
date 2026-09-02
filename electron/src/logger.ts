/**
 * logger.ts centralizes console output for the Electron main process.
 *
 * Every line the main process prints carries a bracketed subsystem prefix.
 * Passing that prefix as the first console argument renders exactly like the
 * hand written prefixes it replaces, so log scrapers keep working.
 */

/** A console channel that prepends its logger's prefix to every call. */
type LogFn = (...args: unknown[]) => void;

/** The console channels the main process writes to. */
export interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

/**
 * Creates a logger whose lines all start with prefix, e.g. "[Electron]".
 *
 * `info` deliberately writes through console.log rather than console.info so
 * the output stream stays the one the replaced calls used.
 */
export function createLogger(prefix: string): Logger {
  return {
    info: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}

/** Logger for the general main process subsystem. */
export const log = createLogger("[Electron]");
