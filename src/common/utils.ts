type LogLevel = "log" | "warn" | "error";

function LOG(level: LogLevel, msg: unknown): void {
  // To turn on all levels: chrome.storage.local.set({"logLevels": ["log", "warn", "error"]})
  chrome.storage.local.get(["logLevels"], (r) => {
    const rawLogLevels: unknown = r?.["logLevels"];
    const logLevels: string[] = Array.isArray(rawLogLevels) ? rawLogLevels : ["error"];
    if (["log", "warn", "error"].includes(level) && logLevels.includes(level)) {
      console[level](msg);
    }
  });
}

function regexFromString(str: string, caseSensitive?: boolean, highlight?: boolean): RegExp {
  let rxp: RegExp;
  const flags = caseSensitive ? "" : "i";
  str = str.replaceAll(/[|\\{}()[\]^$+*?.]/g, String.raw`\$&`);
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
  urls: readonly T[],
  query?: string,
  caseSensitive?: boolean,
): readonly T[] {
  if (query && query.length) {
    const rxp = regexFromString(query, caseSensitive, false);
    return urls.filter((b) => {
      return rxp.test(b.title ?? "") || rxp.test(b.url ?? "");
    });
  }
  return urls;
}

export { LOG, filterByTitleOrUrl, regexFromString };
