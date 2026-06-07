import { extendObject, getSubSettings } from "./settings";

async function loadRawSettings(keys: string[], defaultSet?: any): Promise<any> {
  const rawSet = defaultSet || {};
  const localSet = await chrome.storage.local.get(null);
  extendObject(rawSet, localSet);
  const subset = getSubSettings(rawSet, keys);
  if (chrome.runtime.lastError) {
    subset.error =
      "Settings sync may not work thoroughly because of: " + chrome.runtime.lastError.message;
  }
  return subset;
}

function _setNewTabUrl(): string {
  return "about:newtab";
}

function _getContainerName(_self: unknown) {
  return async (_message: any, sender: any) => {
    try {
      const container = await browser.contextualIdentities.get(sender.tab.cookieStoreId);
      return { name: container.name };
    } catch {
      return { name: null };
    }
  };
}

function getLatestHistoryItem(text: string, maxResults: number): Promise<any[]> {
  return chrome.history.search({
    startTime: 0,
    text,
    maxResults,
  });
}

/** Firefox-specific background glue, composed by the WXT background entrypoint. */
export const firefoxSpecifics = {
  name: "Firefox",
  detectTabTitleChange: true,
  getLatestHistoryItem,
  loadRawSettings,
  _setNewTabUrl,
  _getContainerName,
};
