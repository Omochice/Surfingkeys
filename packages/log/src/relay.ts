import type { LogLevel } from "./logger";

/** Action a record relayed from one extension context to another travels under. */
const DEV_LOG_ACTION = "devLog";

/** Envelope a relayed record is sent in. */
type RelayedLogRecord = {
  action: typeof DEV_LOG_ACTION;
  context: string;
  level: LogLevel;
  args: unknown[];
};

/**
 * Make a log argument survive the extension message boundary.
 *
 * An Error arrives on the other side as an empty object, so it travels as the plain fields the OTLP
 * sink recognises as an error.
 *
 * @param arg - One argument of a log record.
 * @returns The argument itself, or the plain fields of an error.
 */
function toTransferable(arg: unknown): unknown {
  if (!Error.isError(arg)) return arg;
  return { name: arg.name, message: arg.message, stack: arg.stack };
}

export { DEV_LOG_ACTION, toTransferable };
export type { RelayedLogRecord };
