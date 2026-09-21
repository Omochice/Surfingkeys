import type { Result } from "@praha/byethrow";
import type { ChromeRuntimeError } from "@sk/common/result";

/** The companion native API (chrome.surfingkeys), present only in environments that inject it. */
export type SurfingkeysHost = {
  translateCurrentPage(): void;
  sendMouseEvent(type: number, x: number, y: number, button: number): void;
};

type RuntimeSend = <R = unknown>(
  action: string,
  args?: Record<string, unknown>,
  callback?: (response: R) => void,
) => Result.Result<void, ChromeRuntimeError>;

type RuntimeRequest = <R = unknown>(action: string, args?: Record<string, unknown>) => Promise<R>;

/**
 * The WebExtension-facing capabilities the content-script engine depends on, declared here so the
 * engine owns its required contract and never imports the chrome seams directly.
 */
export type EngineEnv = {
  RUNTIME: RuntimeSend;
  /** Rejects with a ChromeRuntimeError when the background cannot be reached. */
  request: RuntimeRequest;
  /** Whether the current frame is the Surfingkeys UI iframe. */
  isInUIFrame: () => boolean;
  reportIssue: (title: string, description: string) => void;
  tabOpenLink: (str: string | string[] | NodeList, simultaneousness?: number) => void;
  /** Resolve a path against the extension's base URL (browser.runtime.getURL). */
  getExtensionURL: (path: string) => string;
  /** Log console-style arguments at the given level, gated by the stored logLevels setting. */
  log: (level: "log" | "warn" | "error", ...args: unknown[]) => void;
  /** The companion native API, or undefined when it is not injected. */
  readonly surfingkeys: SurfingkeysHost | undefined;
};
