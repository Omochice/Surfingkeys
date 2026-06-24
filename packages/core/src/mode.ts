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

// Until the user's settings are applied, key events are buffered rather than handled. Otherwise a
// key pressed during the async settings fetch fires the built-in default mapping instead of the
// user's (possibly overridden) one. Buffering is opt-in via beginBufferingKeyEvents (the content
// script enables it; the UI frame, which never loads user settings, leaves it off) and the buffer
// is released on the userSettingsLoaded event.
let settingsReady = true;
let bufferedKeyEvents: { name: "keydown" | "keyup"; event: StackEvent }[] = [];
let bufferReleaseTimer: ReturnType<typeof setTimeout> | undefined;

// Safety net: release the buffer even if userSettingsLoaded never arrives (e.g. the background
// never responds), so keys can never be held indefinitely.
const SETTINGS_BUFFER_TIMEOUT_MS = 3000;

const listenedEvents: Record<string, (event: StackEvent) => void> = {
  sentinel: () => {
    eventListenerBeats++;
  },
  keydown: (event) => {
    if (event instanceof KeyboardEvent) {
      event.sk_keyName = KeyboardUtils.getKeyChar(event);
    }
    if (modeStack.length === 0 && window !== top) {
      // Boot the iframe on demand; its handler starts buffering synchronously, so this key falls
      // through to the buffer below instead of firing a default.
      dispatchSKEvent("iframeBoot");
    }
    if (!settingsReady) {
      bufferKeyEvent("keydown", event);
      return;
    }
    handleStack("keydown", event);
  },
  keyup: (event) => {
    if (!settingsReady) {
      bufferKeyEvent("keyup", event);
      return;
    }
    handleKeyup(event);
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

// Handle a keyup including the suppression of keyups whose keydown was already swallowed. Shared
// by the live keyup listener and the buffered-event replay so a replayed keyup is suppressed and
// cleaned up identically to a live one.
function handleKeyup(event: StackEvent): void {
  handleStack("keyup", event, () => {
    const i = keysNeedKeyupSuppressed.indexOf(event.keyCode ?? -1);
    if (i !== -1) {
      event.stopImmediatePropagation();
      keysNeedKeyupSuppressed.splice(i, 1);
    }
  });
}

function bufferKeyEvent(name: "keydown" | "keyup", event: StackEvent): void {
  // Stop the browser from acting on the key while it is held; it is replayed on release.
  event.preventDefault();
  event.stopImmediatePropagation();
  bufferedKeyEvents.push({ name, event });
}

/**
 * Stop buffering and replay the held key events in press order. Called on userSettingsLoaded, and
 * also directly by the content script when the settings fetch fails so keys never deadlock.
 */
export function releaseBufferedKeyEvents(): void {
  if (settingsReady) {
    return;
  }
  if (bufferReleaseTimer !== undefined) {
    clearTimeout(bufferReleaseTimer);
    bufferReleaseTimer = undefined;
  }
  // When released via the safety timeout or a direct call, the once-listener never fired and so
  // is still registered; detach it so no stale listener lingers on document.
  document.removeEventListener("surfingkeys:userSettingsLoaded", releaseBufferedKeyEvents);
  settingsReady = true;
  const buffered = bufferedKeyEvents;
  bufferedKeyEvents = [];
  for (const { name, event } of buffered) {
    if (name === "keyup") {
      handleKeyup(event);
    } else {
      handleStack(name, event);
    }
  }
}

/**
 * Start buffering key events until the user's settings are applied. The content script calls this
 * once per frame as the settings fetch begins; the UI frame does not (it never applies user
 * settings). The buffer is released on the userSettingsLoaded event or the safety timeout.
 */
export function beginBufferingKeyEvents(): void {
  settingsReady = false;
  bufferedKeyEvents = [];
  document.addEventListener("surfingkeys:userSettingsLoaded", releaseBufferedKeyEvents, {
    once: true,
  });
  bufferReleaseTimer = setTimeout(releaseBufferedKeyEvents, SETTINGS_BUFFER_TIMEOUT_MS);
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
