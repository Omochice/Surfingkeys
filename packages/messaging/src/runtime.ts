import { chromeRuntimeError } from "@sk/common/result";
import { conf, getCaseSensitive } from "@sk/core/conf";
import { repeatCount } from "@sk/core/repeatCount";
import { reportError } from "@sk/core/report";

// notify stays on the raw, callback-less chrome.runtime.sendMessage rather than the
// promise-based BrowserAdapter: the polyfill's promise form would turn every unanswered
// send into an unhandled rejection. request wraps that same callback-form send for
// callers that do handle a rejection. onMessage stays here for the same callback contract.

const actionsRepeatBackground = [
  "closeTab",
  "nextTab",
  "previousTab",
  "moveTab",
  "reloadTab",
  "setZoom",
  "closeTabLeft",
  "closeTabRight",
  "focusTabByIndex",
];

function buildPayload(
  action: string,
  args: Record<string, unknown> | null | undefined,
  needResponse: boolean,
): Record<string, unknown> {
  const a: Record<string, unknown> = args || {};
  a["action"] = action;
  if (actionsRepeatBackground.includes(action)) {
    // if the action can only be repeated in background, pass repeats to background with args,
    // and set repeatCount.value 1, so that it won't be repeated in foreground's _handleMapKey
    a["repeats"] = repeatCount.value;
    repeatCount.value = 1;
  }
  a["needResponse"] = needResponse;
  return a;
}

/** Calls the background `action` without waiting for a response. */
function notify(action: string, args?: Record<string, unknown>): void {
  const a = buildPayload(action, args, false);
  try {
    chrome.runtime.sendMessage(a);
  } catch (error) {
    // A send throws on every key press in a page whose extension was reloaded, so raising
    // the banner here would repeat it per key.
    console.warn(`[runtime exception] sendMessage:${action}: ${String(error)}`);
  }
}

/** Calls the background `action`; rejects with a ChromeRuntimeError if unreachable. */
function request<R = unknown>(action: string, args?: Record<string, unknown>): Promise<R> {
  const a = buildPayload(action, args, true);
  return new Promise<R>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(a, (response: R) => {
        if (chrome.runtime.lastError) {
          reject(
            chromeRuntimeError(
              `sendMessage:${action}`,
              chrome.runtime.lastError.message ?? "unknown error",
            ),
          );
          return;
        }
        resolve(response);
      });
    } catch (error) {
      // A throw inside the executor rejects with the raw value, which would hand
      // the caller's rejection handler something reportError cannot format.
      reject(chromeRuntimeError(`sendMessage:${action}`, error));
    }
  });
}

type MessageHandler = (
  // Dispatch registry: handlers narrow the message themselves; a shared `unknown` parameter would
  // reject handlers declared with their own concrete message type (contravariance).
  // eslint-disable-next-line typescript/no-explicit-any
  msg: any,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => void;

const handlers: Record<string, MessageHandler> = {};

const getTopURLPromise = new Promise<string>((resolve) => {
  if (window === top) {
    resolve(window.location.href);
  } else {
    request<{ url: string }>("getTopURL").then((response) => {
      resolve(response.url);
    }, reportError);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, response) => {
  handlers[msg.subject]?.(msg, sender, response);
});

const runtime = {
  conf,
  on(message: string, cb: MessageHandler): void {
    handlers[message] = cb;
  },
  bookMessage(message: string, cb: MessageHandler): boolean {
    if (handlers[message]) {
      return false;
    }
    handlers[message] = cb;
    return true;
  },
  releaseMessage(message: string): void {
    delete handlers[message];
  },
  getTopURL(cb: (url: string) => void): void {
    getTopURLPromise.then(cb);
  },
  postTopMessage(msg: unknown): void {
    getTopURLPromise.then((topUrl) => {
      if (window === top) {
        // Firefox use "resource://pdf.js" as window.origin for pdf viewer
        topUrl = window.location.origin;
      }
      if (topUrl === "null" || new URL(topUrl).origin === "file://") {
        topUrl = "*";
      }
      top!.postMessage(msg, topUrl);
    });
  },
  getCaseSensitive,
};

export { notify, request, runtime };
