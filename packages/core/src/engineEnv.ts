/** The companion native API (chrome.surfingkeys), present only in environments that inject it. */
export type SurfingkeysHost = {
  translateCurrentPage(): void;
  sendMouseEvent(type: number, x: number, y: number, button: number): void;
};

type RuntimeNotify = (action: string, args?: Record<string, unknown>) => void;

type RuntimeRequest = <R = unknown>(action: string, args?: Record<string, unknown>) => Promise<R>;

/**
 * The WebExtension-facing capabilities the content-script engine depends on, declared here so the
 * engine owns its required contract and never imports the chrome seams directly.
 */
export type EngineEnv = {
  notify: RuntimeNotify;
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
