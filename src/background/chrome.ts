import { filterByTitleOrUrl } from "../common/utils";
import { _save, extendObject, getSubSettings } from "./settings";

function loadRawSettings(keys: string[], cb: (set: any) => void, defaultSet?: any): void {
  const rawSet = defaultSet || {};
  chrome.storage.local.get(null, (localSet: any) => {
    const localSavedAt = localSet.savedAt || 0;
    chrome.storage.sync.get(null, (syncSet: any) => {
      const syncSavedAt = syncSet.savedAt || 0;
      if (localSavedAt > syncSavedAt) {
        extendObject(rawSet, localSet);
        _save(chrome.storage.sync, localSet, () => {
          const subset = getSubSettings(rawSet, keys);
          if (chrome.runtime.lastError) {
            subset.error =
              "Settings sync may not work thoroughly because of: " +
              chrome.runtime.lastError.message;
          }
          cb(subset);
        });
      } else if (localSavedAt < syncSavedAt) {
        // don't sync local path
        delete syncSet.localPath;
        extendObject(rawSet, syncSet);
        cb(getSubSettings(rawSet, keys));
        _save(chrome.storage.local, syncSet);
      } else {
        extendObject(rawSet, localSet);
        cb(getSubSettings(rawSet, keys));
      }
    });
  });
}

function _setNewTabUrl(): string {
  return "chrome://newtab/";
}

function _getContainerName(_self: unknown, _response: unknown): void {}

function getLatestHistoryItem(
  text: string,
  maxResults: number,
  cb: (results: any[]) => void,
): void {
  let results: any[] = [];
  const impl = (endTime: number, maxResults: number, cb: (results: any[]) => void): void => {
    const prefetch = maxResults * Math.pow(10, Math.min(2, text.length));
    chrome.history.search(
      {
        startTime: 0,
        endTime,
        text: "",
        maxResults: prefetch,
      },
      (items: any[]) => {
        const filtered = filterByTitleOrUrl(items, text, false);
        results = [...results, ...filtered];
        if (items.length < maxResults || results.length >= maxResults) {
          // all items are scanned or we have got what we want
          cb(results.slice(0, maxResults));
        } else {
          endTime = items[items.length - 1].lastVisitTime - 0.01;
          impl(endTime, maxResults, cb);
        }
      },
    );
  };

  impl(new Date().getTime(), maxResults, cb);
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
