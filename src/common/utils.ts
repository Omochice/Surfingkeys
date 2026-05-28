// Browser-extension global. The typed BrowserAdapter (task #13) will replace
// this narrow declaration once cross-browser API access is centralized.
declare const chrome: {
  storage: { local: { get(keys: string[], cb: (r: any) => void): void } };
};

type LogLevel = "log" | "warn" | "error";

function LOG(level: LogLevel, msg: unknown): void {
  // To turn on all levels: chrome.storage.local.set({"logLevels": ["log", "warn", "error"]})
  chrome.storage.local.get(["logLevels"], (r) => {
    const logLevels: string[] = (r && r.logLevels) || ["error"];
    if (["log", "warn", "error"].indexOf(level) !== -1 && logLevels.indexOf(level) !== -1) {
      console[level](msg);
    }
  });
}

function regexFromString(str: string, caseSensitive?: boolean, highlight?: boolean): RegExp {
  let rxp: RegExp;
  const flags = caseSensitive ? "" : "i";
  str = str.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
  if (highlight) {
    rxp = new RegExp(str.replace(/\s+/, "|"), flags);
  } else {
    const words = str
      .split(/\s+/)
      .map((w) => {
        return `(?=.*${w})`;
      })
      .join("");
    rxp = new RegExp(`^${words}.*$`, flags);
  }
  return rxp;
}

function filterByTitleOrUrl<T extends { title?: string; url?: string }>(
  urls: T[],
  query?: string,
  caseSensitive?: boolean,
): T[] {
  if (query && query.length) {
    const rxp = regexFromString(query, caseSensitive, false);
    urls = urls.filter((b) => {
      return rxp.test(b.title ?? "") || rxp.test(b.url ?? "");
    });
  }
  return urls;
}

export { LOG, filterByTitleOrUrl, regexFromString };
