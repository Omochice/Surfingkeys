import {
    LOG,
    filterByTitleOrUrl,
} from '../common/utils.js';
import {
    _save,
    extendObject,
    getSubSettings,
    start
} from './start.js';

function loadRawSettings(keys, cb, defaultSet) {
    var rawSet = defaultSet || {};
    chrome.storage.local.get(null, function(localSet) {
        var localSavedAt = localSet.savedAt || 0;
        chrome.storage.sync.get(null, function(syncSet) {
            var syncSavedAt = syncSet.savedAt || 0;
            if (localSavedAt > syncSavedAt) {
                extendObject(rawSet, localSet);
                _save(chrome.storage.sync, localSet, function() {
                    var subset = getSubSettings(rawSet, keys);
                    if (chrome.runtime.lastError) {
                        subset.error = "Settings sync may not work thoroughly because of: " + chrome.runtime.lastError.message;
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

function _setNewTabUrl(){
    return  "chrome://newtab/";
}

function _getContainerName(self, _response){
}

function getLatestHistoryItem(text, maxResults, cb) {
    const caseSensitive = text.toLowerCase() !== text;
    let endTime = new Date().getTime();
    let results = [];
    const impl = (endTime, maxResults, cb) => {
        const prefetch = maxResults * Math.pow(10, Math.min(2, text.length));
        chrome.history.search({
            startTime: 0,
            endTime,
            text: "",
            maxResults: prefetch
        }, function(items) {
            const filtered = filterByTitleOrUrl(items, text, false);
            results = [...results, ...filtered];
            if (items.length < maxResults || results.length >= maxResults) {
                // all items are scanned or we have got what we want
                cb(results.slice(0, maxResults));
            } else {
                endTime = items[items.length-1].lastVisitTime - 0.01;
                impl(endTime, maxResults, cb);
            }
        });
    };

    impl(endTime, maxResults, cb);
}

start({
    name: "Chrome",
    detectTabTitleChange: true,
    getLatestHistoryItem,
    loadRawSettings,
    _setNewTabUrl,
    _getContainerName
});
