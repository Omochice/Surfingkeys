import { extendObject, getSubSettings, start } from "./start.js";

// Browser-extension globals. The typed BrowserAdapter (task #13) will replace
// these once cross-browser API access is centralized; background is almost
// entirely chrome.*/browser.* glue, so it is treated as an untyped boundary.
declare const chrome: any;
declare const browser: any;

function loadRawSettings(keys: string[], cb: (set: any) => void, defaultSet?: any): void {
    const rawSet = defaultSet || {};
    chrome.storage.local.get(null, (localSet: any) => {
        extendObject(rawSet, localSet);
        const subset = getSubSettings(rawSet, keys);
        if (chrome.runtime.lastError) {
            subset.error =
                "Settings sync may not work thoroughly because of: " +
                chrome.runtime.lastError.message;
        }
        cb(subset);
    });
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

function getLatestHistoryItem(text: string, maxResults: number, cb: (items: any[]) => void): void {
    chrome.history.search(
        {
            startTime: 0,
            text,
            maxResults,
        },
        (items: any[]) => {
            cb(items);
        },
    );
}

start({
    name: "Firefox",
    detectTabTitleChange: true,
    getLatestHistoryItem,
    loadRawSettings,
    _setNewTabUrl,
    _getContainerName,
});
