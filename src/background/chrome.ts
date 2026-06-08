import { filterByTitleOrUrl } from "../common/utils";
import { _save, extendObject, getSubSettings } from "./settings";

async function loadRawSettings(keys: string[], defaultSet?: any): Promise<any> {
  const rawSet = defaultSet || {};
  const localSet = await chrome.storage.local.get(null);
  const localSavedAt = localSet["savedAt"] || 0;
  const syncSet = await chrome.storage.sync.get(null);
  const syncSavedAt = syncSet["savedAt"] || 0;
  if (localSavedAt > syncSavedAt) {
    extendObject(rawSet, localSet);
    const subset = getSubSettings(rawSet, keys);
    // Promise-based storage rejects on failure (it does not set
    // chrome.runtime.lastError), so a failed sync mirror is surfaced as `error`
    // on the returned settings instead of rejecting the whole load.
    try {
      await _save(chrome.storage.sync, localSet);
    } catch (error) {
      subset.error =
        "Settings sync may not work thoroughly because of: " +
        (error instanceof Error ? error.message : String(error));
    }
    return subset;
  }
  if (localSavedAt < syncSavedAt) {
    // don't sync local path
    delete syncSet["localPath"];
    extendObject(rawSet, syncSet);
    void _save(chrome.storage.local, syncSet);
    return getSubSettings(rawSet, keys);
  }
  extendObject(rawSet, localSet);
  return getSubSettings(rawSet, keys);
}

function _setNewTabUrl(): string {
  return "chrome://newtab/";
}

function _getContainerName(_self: unknown): void {}

async function getLatestHistoryItem(text: string, maxResults: number): Promise<any[]> {
  let results: any[] = [];
  let endTime = Date.now();
  // chrome.history.search has no substring filter, so widen the time window and
  // re-filter locally, looping until enough matches are collected or history is
  // exhausted.
  for (;;) {
    const prefetch = maxResults * Math.pow(10, Math.min(2, text.length));
    const items = await chrome.history.search({
      startTime: 0,
      endTime,
      text: "",
      maxResults: prefetch,
    });
    const filtered = filterByTitleOrUrl(items, text, false);
    results = [...results, ...filtered];
    if (items.length < maxResults || results.length >= maxResults) {
      // all items are scanned or we have got what we want
      return results.slice(0, maxResults);
    }
    endTime = items[items.length - 1]!.lastVisitTime! - 0.01;
  }
}

/** Chrome-specific background glue, composed by the WXT background entrypoint. */
export const chromeSpecifics = {
  name: "Chrome",
  detectTabTitleChange: true,
  getLatestHistoryItem,
  loadRawSettings,
  _setNewTabUrl,
  _getContainerName,
};
