import type { Result } from "@praha/byethrow";

import type { ChromeRuntimeError } from "../../common/result";

/** The companion native API (chrome.surfingkeys), present only in environments that inject it. */
type SurfingkeysHost = {
  translateCurrentPage(): void;
  sendMouseEvent(type: number, x: number, y: number, button: number): void;
};

/** The messaging call the engine requires: send `action` to the background, optional response. */
type RuntimeSend = <R = unknown>(
  action: string,
  args?: Record<string, unknown> | null,
  callback?: (response: R) => void,
) => Result.Result<void, ChromeRuntimeError>;

/**
 * The WebExtension-facing capabilities the content-script engine depends on, declared here so the
 * engine owns its required contract and never imports the chrome seams directly. The concrete
 * implementation is built by createEngineEnv (a seam module) and injected at the composition roots:
 * factories receive it as a constructor argument, while the module-level mode hub receives it via
 * {@link initModeHub}.
 */
export type EngineEnv = {
  RUNTIME: RuntimeSend;
  /** Whether the current frame is the Surfingkeys UI iframe. */
  isInUIFrame: () => boolean;
  reportIssue: (title: string, description: string) => void;
  tabOpenLink: (str: string | string[] | NodeList, simultaneousness?: number) => void;
  /** Resolve a path against the extension's base URL (browser.runtime.getURL). */
  getExtensionURL: (path: string) => string;
  /** Log a message at the given level, gated by the stored logLevels setting. */
  log: (level: "log" | "warn" | "error", msg: unknown) => void;
  /** The companion native API, or undefined when it is not injected. */
  readonly surfingkeys: SurfingkeysHost | undefined;
};
