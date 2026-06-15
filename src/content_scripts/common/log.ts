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

export { LOG };
