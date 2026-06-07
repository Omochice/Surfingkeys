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

function _getContainerName(_self: unknown, _response: any) {
  return function (message: any, sender: any, sendResponse: any) {
    const cookieStoreId = sender.tab.cookieStoreId;
    browser.contextualIdentities.get(cookieStoreId).then(
      (container: any) => {
        _response(message, sendResponse, {
          name: container.name,
        });
      },
      () => {
        _response(message, sendResponse, {
          name: null,
        });
      },
    );
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
