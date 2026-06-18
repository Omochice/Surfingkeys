import { Result } from "@praha/byethrow";
import { domApiError } from "@sk/common/result";

import { conf } from "./conf";
import type { EngineEnv } from "./engineEnv";
import { dispatchSKEvent } from "./events";
import KeyboardUtils from "./keyboardUtils";

// The WebExtension-facing capabilities the mode hub needs (isInUIFrame / reportIssue). The hub is
// module-level (showModeStatus is an exported free function called from ~10 sites), so unlike the
// factories it receives its env once via initModeHub rather than a constructor argument.
let engineEnv: EngineEnv | undefined;

type StackEvent = Event & { keyCode?: number };

/**
 * Tell the event hub to swallow the next scroll event. scrollDetection's probe writes a scroll
 * offset to test scrollability, which fires a real scroll event; the counter it increments here is
 * consumed by the global scroll listener below.
 */
export function suppressNextScrollEvent(): void {
  suppressScrollEvent++;
}

let modeStack: ModeHandle[] = [];

let eventListenerBeats = 0;
let suppressScrollEvent = 0;
const keysNeedKeyupSuppressed: number[] = [];

const listenedEvents: Record<string, (event: StackEvent) => void> = {
  sentinel: () => {
    eventListenerBeats++;
  },
  keydown: (event) => {
    if (event instanceof KeyboardEvent) {
      event.sk_keyName = KeyboardUtils.getKeyChar(event);
    }
    if (modeStack.length === 0 && window !== top) {
      // automatically boots iframe on demand
      dispatchSKEvent("iframeBoot");
      document.addEventListener(
        "surfingkeys:userSettingsLoaded",
        () => {
          // proceed to handle the key event after userSettingsLoaded.
          handleStack("keydown", event);
        },
        { once: true },
      );
      return;
    }
    handleStack("keydown", event);
  },
  keyup: (event) => {
    handleStack("keyup", event, () => {
      const i = keysNeedKeyupSuppressed.indexOf(event.keyCode ?? -1);
      if (i !== -1) {
        event.stopImmediatePropagation();
        keysNeedKeyupSuppressed.splice(i, 1);
      }
    });
  },
  scroll: (event) => {
    handleStack("scroll", event);
    if (suppressScrollEvent > 0) {
      event.stopImmediatePropagation();
      event.preventDefault();
      suppressScrollEvent--;
    }
  },
};

function onAfterHandler(_mode: ModeHandle, event: StackEvent): void {
  if (event.sk_stopPropagation) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }
}

function handleStack(eventName: string, event: StackEvent, cb?: (mode: ModeHandle) => void): void {
  for (const m of modeStack) {
    if (event.sk_stopPropagation) {
      break;
    }
    if (!event.sk_suppressed && Object.hasOwn(m.eventListeners, eventName)) {
      const handler = m.eventListeners[eventName];
      if (handler) {
        handler(event);
        onAfterHandler(m, event);
      }
    }
    if (m.name === "Disabled") {
      break;
    }
    cb?.(m);
  }
}

function init(cb?: () => void): void {
  modeStack = [];
  for (const [evtName, listener] of Object.entries(listenedEvents)) {
    window.addEventListener(evtName, listener, true);
  }
  cb?.();
}

export class ModeHandle {
  name: string;
  statusLine: string | undefined;
  eventListeners: Record<string, (event: StackEvent) => void> = {};
  priority: number | undefined;
  onEnter?: () => void;
  onExit?: (pos?: number) => void;

  constructor(name: string, statusLine?: string) {
    this.name = name;
    this.statusLine = statusLine;
  }

  addEventListener(evtName: string, handler: (event: StackEvent) => void): this {
    this.eventListeners[evtName] = handler;

    if (!Object.hasOwn(listenedEvents, evtName)) {
      const listener = (event: StackEvent): void => {
        handleStack(evtName, event);
      };
      listenedEvents[evtName] = listener;
      window.addEventListener(evtName, listener, true);
    }

    return this;
  }

  enter(priority?: number, reentrant?: boolean): number {
    const pos = modeStack.indexOf(this);
    if (!this.priority) {
      this.priority = priority || modeStack.length;
    }

    if (pos === -1) {
      // push this mode into stack
      modeStack.unshift(this);
    } else if (pos > 0) {
      if (reentrant) {
        // pop up all the modes over this
        modeStack = modeStack.slice(pos);
      } else {
        const modeList = modeStack.map((u) => u.name).join(",");
        engineEnv?.reportIssue(
          `Mode ${this.name} pushed into mode stack again.`,
          `Modes in stack: ${modeList}`,
        );
      }
    }

    modeStack.sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa < pb) return 1;
      if (pb < pa) return -1;
      return 0;
    });

    this.onEnter?.();

    showModeStatus();
    return pos;
  }

  exit(peek?: boolean): void {
    const pos = modeStack.indexOf(this);
    if (pos !== -1) {
      this.priority = 0;
      if (peek) {
        // for peek exit, we need push modes above this back to the stack.
        modeStack.splice(pos, 1);
      } else {
        // otherwise, we just pop all modes above this inclusively.
        modeStack = modeStack.slice(pos + 1);
      }
    }
    showModeStatus();
    this.onExit?.(pos);
  }
}

/** The mode currently on top of the stack, i.e. the one that sees events first. */
export function getCurrentMode(): ModeHandle | undefined {
  return modeStack[0];
}

/** Suppress the next keyup for `keyCode`, for keys whose keydown was already swallowed. */
export function suppressKeyUp(keyCode: number): void {
  if (!keysNeedKeyupSuppressed.includes(keyCode)) {
    keysNeedKeyupSuppressed.push(keyCode);
  }
}

/**
 * Inject the engine env and install the global window listeners that drive the mode hub. The env is
 * stored synchronously so showModeStatus / ModeHandle.enter can reach it even when init itself is
 * deferred (the about:blank iframe case below).
 */
export function initModeHub(env: EngineEnv, cb?: () => void): void {
  engineEnv = env;
  // For blank page in frames, we defer init to page loaded
  // as document.write will clear added eventListeners.
  if (
    window.location.href === "about:blank" &&
    window.frameElement &&
    (!document.body || document.body.childElementCount === 0)
  ) {
    window.frameElement.addEventListener("load", () => {
      const r = Result.try({
        try: (): void => init(cb),
        catch: (cause) => domApiError("iframe init", cause),
      });
      if (Result.isFailure(r)) {
        console.log("Error on blank iframe loaded: " + String(r.error.cause));
      }
    });
  } else {
    init(cb);
  }
}

/** Push the current top-of-stack mode's status line to the front. */
export function showModeStatus(): void {
  if (document.hasFocus() && modeStack.length) {
    const cm = modeStack[0];
    if (cm == null) {
      return;
    }
    let sl = cm.statusLine || (conf.showModeStatus ? cm.name : "");
    if (sl !== "" && window !== top && engineEnv && !engineEnv.isInUIFrame()) {
      const pathname = window.location.pathname.split("/");
      if (pathname.length) {
        sl += " - frame: " + pathname.at(-1);
      }
    }
    dispatchSKEvent("front", ["showStatus", [sl]]);
  }
}

/** Probe the sentinel listener and reinstall the hub (then call `onMissing`) if it is gone. */
export function checkEventListener(onMissing: () => void): void {
  const previousState = eventListenerBeats;
  window.dispatchEvent(new CustomEvent("sentinel"));
  if (previousState === eventListenerBeats) {
    init();
    onMissing();
  }
}
