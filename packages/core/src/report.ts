import type { SkError } from "@sk/common/result";

import { dispatchSKEvent } from "./events";

const formatMessage = (err: SkError): string => {
  switch (err.kind) {
    case "chrome-runtime": {
      return `[runtime exception] ${err.op}: ${String(err.cause)}`;
    }
    case "user-code": {
      return `[user ${err.source}] ${String(err.cause)}`;
    }
    case "decode": {
      return `[decode] failed to parse: ${err.input}`;
    }
    case "http": {
      return `[http${err.status != null ? ` ${err.status}` : ""}] ${err.url}: ${String(err.cause)}`;
    }
    case "dom-api": {
      return `[dom] ${err.op}: ${String(err.cause)}`;
    }
  }
};

/** Surface an error via the popup banner. Call only from presentation-layer code. */
export const reportError = (err: SkError): void => {
  dispatchSKEvent("front", ["showPopup", formatMessage(err)]);
};
