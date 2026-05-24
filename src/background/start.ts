import { filterByTitleOrUrl } from "../common/utils.js";

// Browser-extension globals. The typed BrowserAdapter (task #13) will replace
// these once cross-browser API access is centralized; background is almost
// entirely chrome.* glue, so it is treated as an untyped boundary here.
declare const chrome: any;

function request(
    url: string,
    onReady: (content: string) => void,
    headers?: any,
    data?: any,
    onException?: (exp: any) => void,
): void {
    headers = headers || {};
    const CHARTSET_RE = /(?:charset|encoding)\s*=\s*['"]? *([\w-]+)/i;

    fetch(url, {
        method: data !== undefined ? "POST" : "GET",
        headers,
        body: data,
    })
        .then((res) => {
            const cs = res.headers.get("content-type")
                ? res.headers.get("content-type")!.match(CHARTSET_RE)
                : [];

            return Promise.all([
                Promise.resolve(cs && cs.length > 1 ? cs[1] : "utf-8"),
                res.arrayBuffer(),
            ]);
        })
        .then((res) => {
            const decoder = new TextDecoder(res[0] as string);
            const content = decoder.decode(res[1] as ArrayBuffer);
            onReady(content);
        })
        .catch((exp) => {
            onException && onException(exp);
        });
}

function dictFromArray(arry: any[], val: any): Record<string, any> {
    const dict: Record<string, any> = {};
    arry.forEach((h) => {
        dict[h] = val;
    });
    return dict;
}

function extendObject(target: any, ss: any): void {
    for (const k in ss) {
        target[k] = ss[k];
    }
}

function getSubSettings(set: any, keys: any): any {
    let subset: any;
    if (!keys) {
        // if null/undefined/""
        subset = set;
    } else {
        if (!(keys instanceof Array)) {
            keys = [keys];
        }
        subset = {};
        keys.forEach((k: string) => {
            subset[k] = set[k];
        });
    }
    return subset;
}

function _save(storage: any, data: any, cb?: () => void): void {
    if (storage === chrome.storage.sync) {
        // don't store snippets from localPath into sync storage, since sync storage has its quota.
        if (data.localPath) {
            delete data.snippets;
            delete data.localPath;
        }
        if (Object.keys(data).length > 1) {
            storage.set(data, cb);
        }
    } else {
        if (data.localPath) {
            delete data.snippets;
            // try to fetch snippets from localPath and cache it in local storage.
            request(data.localPath, (resp) => {
                data.snippets = resp;
                storage.set(data, cb);
            });
        } else {
            storage.set(data, cb);
        }
    }
}

const Gist = (() => {
    const self: any = {};

    function _initGist(token: string, magic_word: string, onGistReady: (gist: string) => void) {
        request(
            "https://api.github.com/gists",
            (res) => {
                const gists = JSON.parse(res);
                let gist = "";
                gists.forEach((g: any) => {
                    if (
                        Object.prototype.hasOwnProperty.call(g, "description") &&
                        g["description"] === magic_word &&
                        Object.prototype.hasOwnProperty.call(g.files, magic_word)
                    ) {
                        gist = g.id;
                    }
                });
                if (gist === "") {
                    request(
                        "https://api.github.com/gists",
                        (res2) => {
                            const ng = JSON.parse(res2);
                            onGistReady(ng.id);
                        },
                        {
                            Authorization: "token " + token,
                        },
                        `{ "description": "${magic_word}", "public": false, "files": { "${magic_word}": { "content": "${magic_word}" } } }`,
                    );
                } else {
                    onGistReady(gist);
                }
            },
            {
                Authorization: "token " + token,
            },
        );
    }

    let _token: string;
    let _gist = "";
    let _comments: any[] = [];
    self.initGist = (token: string, onGistReady?: (gist: string) => void) => {
        if (_token === token && _gist !== "") {
            return _gist;
        } else {
            _token = token;
            _initGist(_token, "cloudboard", (gist) => {
                _gist = gist;
                onGistReady && onGistReady(_gist);
            });
        }
    };

    function _newComment(text: string, cb?: (res: string) => void) {
        request(
            `https://api.github.com/gists/${_gist}/comments`,
            (res) => {
                cb && cb(res);
            },
            {
                Authorization: "token " + _token,
            },
            `{"body": "${encodeURIComponent(text)}"}`,
        );
    }
    function _readComment(cid: string, cb: (resp: any) => void) {
        request(
            `https://api.github.com/gists/${_gist}/comments/${cid}`,
            (res) => {
                const comment = JSON.parse(res);
                cb({ status: 0, content: decodeURIComponent(comment.body) });
            },
            {
                Authorization: "token " + _token,
            },
        );
    }
    function _listComment(cb: (comments: any[]) => void) {
        request(
            `https://api.github.com/gists/${_gist}/comments`,
            (res) => {
                _comments = JSON.parse(res).map((c: any) => {
                    return c.id;
                });
                cb(_comments);
            },
            {
                Authorization: "token " + _token,
            },
        );
    }
    function _writeComment(cid: string, clip: string, cb?: (res: string) => void) {
        request(
            `https://api.github.com/gists/${_gist}/comments/${cid}`,
            (res) => {
                cb && cb(res);
            },
            {
                Authorization: "token " + _token,
            },
            `{"body": "${encodeURIComponent(clip)}"}`,
        );
    }
    self.readComment = (nr: number, cb: (resp: any) => void) => {
        if (_gist === "") {
            cb({ status: 1, content: "Please call initGist first!" });
        } else if (nr >= _comments.length) {
            _listComment((cmts) => {
                if (nr < cmts.length) {
                    _readComment(cmts[nr], cb);
                } else {
                    cb({ status: 1, content: "Register not exists!" });
                }
            });
        } else {
            _readComment(_comments[nr], cb);
        }
    };
    self.editComment = (nr: number, clip: string, cb: (resp: any) => void) => {
        if (_gist === "") {
            cb({ status: 1, content: "Please call initGist first!" });
        } else if (nr >= _comments.length) {
            _listComment((cmts) => {
                if (nr < cmts.length) {
                    _writeComment(cmts[nr], clip, cb);
                } else {
                    let toCreate = nr - cmts.length + 1;
                    const cbAfterCreated = () => {
                        toCreate--;
                        if (toCreate > 0) {
                            _newComment(".", cbAfterCreated);
                        } else if (toCreate === 0) {
                            _newComment(clip, cb);
                        }
                    };
                    cbAfterCreated();
                }
            });
        } else {
            _writeComment(_comments[nr], clip, cb);
        }
    };

    return self;
})();

function start(browser: any): void {
    const self: any = {};

    const isMV3 = chrome.runtime.getManifest().manifest_version === 3;

    let tabHistory: any[] = [];
    let tabHistoryIndex = 0;
    let chromelikeNewTabPosition = 0;
    let historyTabAction = false;

    // data by tab id
    const tabActivated: Record<string, any> = {};
    const tabMessages: Record<string, any> = {};
    const tabURLs: Record<string, any> = {};

    const newTabUrl = browser._setNewTabUrl();

    const conf: Record<string, any> = {
        focusAfterClosed: "right",
        tabsMRUOrder: true,
        newTabPosition: "default",
        showTabIndices: false,
        interceptedErrors: [],
    };

    let bookmarkFolders: any[] = [];
    function getFolders(tree: any, root: string) {
        let cd = root;
        if (
            tree.title !== "" &&
            (!Object.prototype.hasOwnProperty.call(tree, "url") || tree.url === undefined)
        ) {
            cd += "/" + tree.title;
            bookmarkFolders.push({ id: tree.id, title: cd + "/" });
        }
        if (Object.prototype.hasOwnProperty.call(tree, "children")) {
            for (let i = 0; i < tree.children.length; ++i) {
                getFolders(tree.children[i], cd);
            }
        }
    }

    function createBookmark(page: any, onCreated: (ret: any) => void) {
        if (page.path.length) {
            chrome.bookmarks.create(
                {
                    parentId: page.folder,
                    title: page.path.shift(),
                },
                (newFolder: any) => {
                    page.folder = newFolder.id;
                    createBookmark(page, onCreated);
                },
            );
        } else {
            chrome.bookmarks.create(
                {
                    parentId: page.folder,
                    title: page.title,
                    url: page.url,
                },
                (ret: any) => {
                    onCreated(ret);
                },
            );
        }
    }

    function loadSettings(keys: any, cb: (set: any) => void) {
        const tmpSet = {
            blocklist: {},
            marks: {},
            findHistory: [],
            cmdHistory: [],
            sessions: {},
        };

        browser.loadRawSettings(
            keys,
            (set: any) => {
                if (set.localPath) {
                    request(
                        appendNonce(set.localPath),
                        (resp) => {
                            set.snippets = resp;
                            cb(set);
                        },
                        undefined,
                        undefined,
                        () => {
                            // failed to read snippets from localPath
                            set.error = "Failed to read snippets from " + set.localPath;
                            cb(set);
                        },
                    );
                } else {
                    cb(set);
                }
            },
            tmpSet,
        );
    }

    function removeTab(tabId: number) {
        delete tabActivated[tabId];
        delete tabMessages[tabId];
        delete tabURLs[tabId];
        tabHistory = tabHistory.filter((e) => {
            return e !== tabId;
        });
        if (_queueURLs.length) {
            chrome.tabs.create({
                active: false,
                url: _queueURLs.shift(),
            });
        }

        _updateTabIndices();
    }
    chrome.tabs.onRemoved.addListener(removeTab);
    function _setScrollPos_bg(tabId: number) {
        if (Object.prototype.hasOwnProperty.call(tabMessages, tabId)) {
            const message = tabMessages[tabId];
            sendTabMessage(tabId, 0, {
                subject: "setScrollPos",
                scrollLeft: message.scrollLeft,
                scrollTop: message.scrollTop,
            });
            delete tabMessages[tabId];
        }
    }

    function sendTabMessage(tabId: number, frameId: number, message: any) {
        const opts = frameId === -1 ? undefined : { frameId: frameId };
        // use catch to suppress Uncaught (in promise) Error on sending message to unsupported tabs like chrome://
        const p = chrome.tabs.sendMessage(tabId, message, opts);
        if (p) {
            p.catch(() => {});
        }
    }
    let _lastActiveTabId: number | null = null;
    function _tabActivated(tabId: number) {
        if (_lastActiveTabId !== tabId) {
            if (_lastActiveTabId !== null) {
                sendTabMessage(_lastActiveTabId, 0, {
                    subject: "tabDeactivated",
                });
            }
            sendTabMessage(tabId, 0, {
                subject: "tabActivated",
            });
            _lastActiveTabId = tabId;
        }
    }
    chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: any, tab: any) => {
        if (changeInfo.status === "complete") {
            if (tab.active) {
                _tabActivated(tabId);
            }
        }
        if (browser.detectTabTitleChange && changeInfo.title) {
            sendTabMessage(tabId, 0, {
                subject: "titleChanged",
                changeInfo,
            });
        }
    });
    chrome.windows.onFocusChanged.addListener(() => {
        getActiveTab((tab: any) => {
            _tabActivated(tab.id);
        });
    });

    chrome.tabs.onCreated.addListener(() => {
        _updateTabIndices();
    });
    chrome.tabs.onMoved.addListener(() => {
        _updateTabIndices();
    });
    chrome.tabs.onActivated.addListener((activeInfo: any) => {
        if (!historyTabAction && activeInfo.tabId != tabHistory[tabHistory.length - 1]) {
            if (tabHistory.length > 10) {
                tabHistory.shift();
            }
            if (tabHistoryIndex != tabHistory.length - 1) {
                tabHistory.splice(tabHistoryIndex + 1, tabHistory.length - 1);
            }
            tabHistory.push(activeInfo.tabId);
            tabHistoryIndex = tabHistory.length - 1;
        }
        tabActivated[activeInfo.tabId] = new Date().getTime();
        _tabActivated(activeInfo.tabId);
        historyTabAction = false;
        chromelikeNewTabPosition = 0;

        _updateTabIndices();
    });
    chrome.tabs.onDetached.addListener(() => {
        _updateTabIndices();
    });
    chrome.tabs.onAttached.addListener(() => {
        _updateTabIndices();
    });

    function getActiveTab(cb: (tab: any) => void) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
            tabs.length > 0 && cb(tabs[0]);
        });
    }
    chrome.commands.onCommand.addListener((command: string) => {
        switch (command) {
            case "restartext":
                chrome.tabs.query({}, (tabs: any[]) => {
                    tabs.forEach((tab) => {
                        chrome.tabs.reload(tab.id);
                    });
                    chrome.runtime.reload();
                });
                break;
            case "previousTab":
            case "nextTab":
                getActiveTab((tab: any) => {
                    let index = command === "previousTab" ? tab.index - 1 : tab.index + 1;
                    chrome.tabs.query({ windowId: tab.windowId }, (tabs: any[]) => {
                        index = ((index % tabs.length) + tabs.length) % tabs.length;
                        chrome.tabs.update(tabs[index].id, { active: true });
                    });
                });
                break;
            case "closeTab":
                getActiveTab((tab: any) => {
                    chrome.tabs.remove(tab.id);
                });
                break;
            default:
                break;
        }
    });

    self.pendingPorts = [];
    function _response(message: any, sendResponse: (result: any) => void, result: any) {
        const idx = self.pendingPorts.indexOf(message);
        if (idx !== -1) {
            self.pendingPorts.splice(idx, 1);
        }
        sendResponse(result);
    }
    function handleMessage(_message: any, _sender: any, _sendResponse: any) {
        if (Object.prototype.hasOwnProperty.call(self, _message.action)) {
            const result = self[_message.action](_message, _sender, _sendResponse);
            if (_message.needResponse) {
                if (result) {
                    _sendResponse(result);
                    _message.needResponse = false;
                } else {
                    self.pendingPorts.push(_message);
                    // An asynchronous response will be sent using sendResponse later.
                }
                return _message.needResponse;
            }
        } else {
            console.log("[unexpected runtime message] " + JSON.stringify(_message));
        }
    }
    chrome.runtime.onMessage.addListener(handleMessage);
    if (isMV3) {
        chrome.runtime.onUserScriptMessage.addListener((m: any, s: any, r: any) => {
            m.fromUserScript = true;
            handleMessage(m, s, r);
        });
        chrome.runtime.onInstalled.addListener(() => {
            chrome.userScripts.configureWorld({
                csp: "script-src 'self' 'unsafe-eval'",
                messaging: true,
            });
        });
    }

    function _updateSettings(diffSettings: any, afterSet?: () => void) {
        diffSettings.savedAt = new Date().getTime();
        _save(chrome.storage.local, diffSettings, () => {
            _save(chrome.storage.sync, diffSettings);
            if (afterSet) {
                afterSet();
            }
        });
    }

    function _broadcastSettings(data: any) {
        chrome.tabs.query({}, (tabs: any[]) => {
            tabs.forEach((tab) => {
                sendTabMessage(tab.id, -1, {
                    subject: "settingsUpdated",
                    settings: data,
                });
            });
        });
    }

    function _updateAndPostSettings(diffSettings: any, afterSet?: () => void) {
        _broadcastSettings(diffSettings);
        _updateSettings(diffSettings, afterSet);
    }

    function _updateTabIndices() {
        if (conf.showTabIndices) {
            chrome.tabs.query({ currentWindow: true }, (tabs: any[]) => {
                tabs.forEach((tab) => {
                    sendTabMessage(tab.id, 0, {
                        subject: "tabIndexChange",
                        index: tab.index + 1,
                    });
                });
            });
        }
    }

    function getSenderUrl(sender: any) {
        // use the tab's url if sender is a frame with blank url.
        return sender.frameId !== 0 && sender.url === "about:blank" ? sender.tab.url : sender.url;
    }
    function _getState(set: any, url: any, blocklistPattern: any, lurkingPattern: any) {
        if (set.blocklist[".*"]) {
            return "disabled";
        }
        if (url) {
            if (set.blocklist[url.origin]) {
                return "disabled";
            }
            if (blocklistPattern) {
                blocklistPattern = new RegExp(blocklistPattern.source, blocklistPattern.flags);
                if (blocklistPattern.test(url.href)) {
                    return "disabled";
                }
            }
            if (lurkingPattern) {
                lurkingPattern = new RegExp(lurkingPattern.source, lurkingPattern.flags);
                if (lurkingPattern.test(url.href)) {
                    return "lurking";
                }
            }
        }
        return "enabled";
    }
    self.toggleBlocklist = (message: any, sender: any, sendResponse: any) => {
        loadSettings("blocklist", (data: any) => {
            let origin = ".*";
            const senderOrigin = sender.origin || new URL(getSenderUrl(sender)).origin;
            if (
                chrome.runtime.getURL("/").toLowerCase().indexOf(senderOrigin.toLowerCase()) !==
                    0 &&
                senderOrigin !== "null"
            ) {
                origin = senderOrigin;
            }
            if (Object.prototype.hasOwnProperty.call(data.blocklist, origin)) {
                delete data.blocklist[origin];
            } else {
                data.blocklist[origin] = 1;
            }
            _updateAndPostSettings({ blocklist: data.blocklist }, () => {
                sendResponse({
                    state: _getState(
                        data,
                        sender.tab ? new URL(getSenderUrl(sender)) : null,
                        message.blocklistPattern,
                        message.lurkingPattern,
                    ),
                    blocklist: data.blocklist,
                    url: origin,
                });
            });
        });
    };
    self.toggleMouseQuery = (message: any, sender: any, _sendResponse: any) => {
        loadSettings("mouseSelectToQuery", (data: any) => {
            if (sender.tab && sender.tab.url.indexOf(chrome.runtime.getURL("/")) !== 0) {
                const mouseSelectToQuery = data.mouseSelectToQuery || [];
                const idx = mouseSelectToQuery.indexOf(message.origin);
                if (idx === -1) {
                    mouseSelectToQuery.push(message.origin);
                } else {
                    mouseSelectToQuery.splice(idx, 1);
                }
                _updateAndPostSettings({ mouseSelectToQuery: mouseSelectToQuery });
            }
        });
    };
    self.getState = (message: any, sender: any, sendResponse: any) => {
        loadSettings(["blocklist"], (data: any) => {
            if (sender.tab) {
                _response(message, sendResponse, {
                    state: _getState(
                        data,
                        new URL(getSenderUrl(sender)),
                        message.blocklistPattern,
                        message.lurkingPattern,
                    ),
                });
            }
        });
    };

    self.addVIMark = (message: any, _sender: any, _sendResponse: any) => {
        loadSettings("marks", (data: any) => {
            extendObject(data.marks, message.mark);
            _updateAndPostSettings({ marks: data.marks });
        });
    };
    self.jumpVIMark = (message: any, sender: any, sendResponse: any) => {
        loadSettings("marks", (data: any) => {
            const marks = data.marks;
            if (Object.prototype.hasOwnProperty.call(marks, message.mark)) {
                const markInfo = marks[message.mark];
                chrome.tabs.query({}, (tabs: any[]) => {
                    tabs = tabs.filter((t) => {
                        return t.url === markInfo.url;
                    });

                    if (tabs.length === 0) {
                        markInfo.tab = {
                            tabbed: true,
                            active: true,
                        };
                        self.openLink(markInfo, sender, sendResponse);
                    } else {
                        if (markInfo.scrollLeft || markInfo.scrollTop) {
                            tabMessages[tabs[0].id] = {
                                scrollLeft: markInfo.scrollLeft,
                                scrollTop: markInfo.scrollTop,
                            };
                        }
                        if (tabs[0].id === sender.tab.id) {
                            _setScrollPos_bg(tabs[0].id);
                        } else {
                            chrome.tabs.update(tabs[0].id, {
                                active: true,
                            });
                        }
                    }
                });
            }
        });
    };

    function appendNonce(url: string) {
        if (/https?:\/\//.test(url)) {
            url = url.replace(/\?$/, "");
            const u = new URL(url);
            const con = u.search ? "&" : "?";
            url = `${url}${con}nonce=${new Date().getTime()}`;
        }
        return url;
    }

    function _loadSettingsFromUrl(url: string, cb: (status: any) => void) {
        request(
            appendNonce(url),
            (resp) => {
                _updateAndPostSettings({ localPath: url, snippets: resp });
                registerUserScript(resp, () => {
                    cb({ status: "Succeeded", snippets: resp });
                });
            },
            undefined,
            undefined,
            () => {
                cb({ status: "Failed" });
            },
        );
    }

    self.resetSettings = (message: any, _sender: any, sendResponse: any) => {
        chrome.storage.local.clear();
        chrome.storage.sync.clear();
        loadSettings(null, (data: any) => {
            _response(message, sendResponse, {
                settings: data,
            });
            _broadcastSettings(data);
        });
    };
    self.loadSettingsFromUrl = (message: any, _sender: any, sendResponse: any) => {
        _loadSettingsFromUrl(message.url, (status: any) => {
            _response(message, sendResponse, status);
        });
    };
    function _filterByTitleOrUrl(tabs: any[], query: string) {
        tabs = tabs.filter((b) => {
            return b.url;
        });
        return filterByTitleOrUrl(tabs, query, false);
    }
    self.getRecentlyClosed = (message: any, _sender: any, sendResponse: any) => {
        chrome.sessions.getRecentlyClosed({}, (sessions: any[]) => {
            let tabs: any[] = [];
            for (let i = 0; i < sessions.length; i++) {
                const s = sessions[i];
                if (Object.prototype.hasOwnProperty.call(s, "window")) {
                    tabs = tabs.concat(s.window.tabs);
                } else if (Object.prototype.hasOwnProperty.call(s, "tab")) {
                    tabs.push(s.tab);
                }
            }
            tabs = _filterByTitleOrUrl(tabs, message.query);
            _response(message, sendResponse, {
                urls: tabs,
            });
        });
    };
    self.getTopSites = (message: any, _sender: any, sendResponse: any) => {
        if (chrome.topSites) {
            chrome.topSites.get((urls: any[]) => {
                urls = _filterByTitleOrUrl(urls, message.query);
                _response(message, sendResponse, {
                    urls: urls,
                });
            });
        } else {
            _response(message, sendResponse, {
                urls: [],
            });
        }
    };

    function _getHistory(
        text: string,
        maxResults: number,
        cb: (items: any[]) => void,
        sortByMostUsed?: boolean,
    ) {
        browser.getLatestHistoryItem(text, maxResults, (items: any[]) => {
            if (sortByMostUsed) {
                items = items.sort((a, b) => {
                    return b.visitCount - a.visitCount;
                });
            }
            cb(items);
        });
    }
    self.getAllURLs = (message: any, _sender: any, sendResponse: any) => {
        chrome.bookmarks.search(message.query || {}, (bmItems: any[]) => {
            let urls = bmItems;
            const requestCount = message.maxResults || 100;
            const maxResults = requestCount - urls.length;
            if (maxResults > 0) {
                _getHistory(
                    message.query || "",
                    maxResults,
                    (historyItems) => {
                        urls = urls.concat(historyItems);
                        _response(message, sendResponse, {
                            urls: urls,
                        });
                    },
                    true,
                );
            } else {
                _response(message, sendResponse, {
                    urls: urls.slice(0, requestCount),
                });
            }
        });
    };
    self.getTabs = (message: any, sender: any, sendResponse: any) => {
        const tab = sender.tab;
        const queryInfo = message.queryInfo || {};
        chrome.tabs.query(queryInfo, (tabs: any[]) => {
            tabs = _filterByTitleOrUrl(tabs, message.filter);
            if (tabs.length > message.tabsThreshold && conf.tabsMRUOrder) {
                // only remove current tab when tabsMRUOrder is enabled.
                tabs = tabs.filter((b) => {
                    return b.id !== tab.id;
                });
                tabs.sort((x, y) => {
                    // Shift tabs without "last access" data to the end
                    const a = x.lastAccessed || tabActivated[x.id];
                    const b = y.lastAccessed || tabActivated[y.id];

                    if (!isFinite(a) && !isFinite(b)) {
                        return 0;
                    }

                    if (!isFinite(a)) {
                        return 1;
                    }

                    if (!isFinite(b)) {
                        return -1;
                    }

                    return b - a;
                });
            }
            _response(message, sendResponse, {
                tabs: tabs,
            });
        });
    };
    self.togglePinTab = (_message: any, _sender: any, _sendResponse: any) => {
        getActiveTab((tab: any) => {
            return chrome.tabs.update(tab.id, {
                pinned: !tab.pinned,
            });
        });
    };
    self.closeTabByIds = (message: any, _sender: any, _sendResponse: any) => {
        chrome.tabs.remove(message.tabIds);
    };
    function focusTab(windowId: number, tabId: number) {
        chrome.windows.update(
            windowId,
            {
                focused: true,
            },
            () => {
                chrome.tabs.update(tabId, {
                    active: true,
                });
            },
        );
    }
    self.focusTab = (message: any, sender: any, _sendResponse: any) => {
        if (message.windowId !== undefined && sender.tab.windowId !== message.windowId) {
            focusTab(message.windowId, message.tabId);
        } else {
            chrome.tabs.update(message.tabId, {
                active: true,
            });
        }
    };
    self.focusTabByIndex = (message: any, _sender: any, _sendResponse: any) => {
        const queryInfo = message.queryInfo || { currentWindow: true };
        chrome.tabs.query(queryInfo, (tabs: any[]) => {
            if (message.repeats > 0 && message.repeats <= tabs.length) {
                chrome.tabs.update(tabs[message.repeats - 1].id, {
                    active: true,
                });
            }
        });
    };
    self.goToLastTab = (_message: any, _sender: any, _sendResponse: any) => {
        if (tabHistory.length > 1) {
            const lastTab = tabHistory[tabHistory.length - 2];
            chrome.tabs.update(lastTab, {
                active: true,
            });
        }
    };
    self.historyTab = (message: any, _sender?: any, _sendResponse?: any) => {
        if (tabHistory.length > 0) {
            historyTabAction = true;
            if (Object.prototype.hasOwnProperty.call(message, "index")) {
                tabHistoryIndex = (parseInt(message.index) + tabHistory.length) % tabHistory.length;
            } else {
                tabHistoryIndex += message.backward ? -1 : 1;
                if (tabHistoryIndex < 0) {
                    tabHistoryIndex = 0;
                } else if (tabHistoryIndex >= tabHistory.length) {
                    tabHistoryIndex = tabHistory.length - 1;
                }
            }
            const tabId = tabHistory[tabHistoryIndex];
            chrome.tabs.update(tabId, {
                active: true,
            });
        }
    };
    // limit to between 0 and length
    function _fixTo(to: number, length: number) {
        if (to < 0) {
            to = 0;
        } else if (to >= length) {
            to = length;
        }
        return to;
    }
    // round base ahead if repeats reaches length
    function _roundBase(base: number, repeats: number, length: number) {
        if (repeats > length - base) {
            base -= repeats - (length - base);
        }
        return base;
    }
    function _nextTab(tab: any, step: number) {
        if (tab) {
            chrome.tabs.query(
                {
                    windowId: tab.windowId,
                },
                (tabs: any[]) => {
                    if (tab.index == 0 && step == -1) {
                        step = tabs.length - 1;
                    } else if (tab.index == tabs.length - 1 && step == 1) {
                        step = 1 - tabs.length;
                    }
                    const to = _fixTo(tab.index + step, tabs.length - 1);
                    chrome.tabs.update(tabs[to].id, {
                        active: true,
                    });
                },
            );
        } else {
            getActiveTab((t: any) => {
                _nextTab(t, step);
            });
        }
    }
    self.nextTab = (message: any, sender: any, _sendResponse: any) => {
        _nextTab(sender.tab, message.repeats);
    };
    self.previousTab = (message: any, sender: any, _sendResponse: any) => {
        _nextTab(sender.tab, -message.repeats);
    };
    function _roundRepeatTabs(tab: any, repeats: number, operation: (tabIds: any[]) => void) {
        if (tab) {
            chrome.tabs.query(
                {
                    windowId: tab.windowId,
                },
                (tabs: any[]) => {
                    const tabIds = tabs.map((e) => {
                        return e.id;
                    });
                    repeats = _fixTo(repeats, tabs.length);
                    const base = _roundBase(tab.index, repeats, tabs.length);
                    operation(tabIds.slice(base, base + repeats));
                },
            );
        } else {
            getActiveTab((t: any) => {
                _roundRepeatTabs(t, repeats, operation);
            });
        }
    }
    self.reloadTab = (message: any, sender: any, _sendResponse: any) => {
        _roundRepeatTabs(sender.tab, message.repeats, (tabIds) => {
            tabIds.forEach((tabId) => {
                chrome.tabs.reload(tabId, {
                    bypassCache: message.nocache,
                });
            });
        });
    };
    self.closeTab = (message: any, sender: any, _sendResponse: any) => {
        _roundRepeatTabs(sender.tab, message.repeats, (tabIds) => {
            chrome.tabs.remove(tabIds, () => {
                if (conf.focusAfterClosed === "left") {
                    _nextTab(sender.tab, -1);
                } else if (conf.focusAfterClosed === "last") {
                    self.historyTab({ backward: true });
                }
            });
        });
    };

    function _closeTab(s: any, n: number) {
        chrome.tabs.query({ currentWindow: true }, (tabs: any[]) => {
            const ids = tabs.map((e) => {
                return e.id;
            });
            chrome.tabs.remove(
                ids.slice(s.tab.index + (n < 0 ? n : 1), s.tab.index + (n < 0 ? 0 : 1 + n)),
            );
        });
    }

    self.closeTabLeft = (message: any, sender: any, _senderResponse: any) => {
        _closeTab(sender, -message.repeats);
    };
    self.closeTabRight = (message: any, sender: any, _senderResponse: any) => {
        _closeTab(sender, message.repeats);
    };
    self.closeTabsToLeft = (_message: any, sender: any, _senderResponse: any) => {
        _closeTab(sender, -sender.tab.index);
    };
    self.closeTabsToRight = (_message: any, sender: any, _senderResponse: any) => {
        chrome.tabs.query({ currentWindow: true }, (tabs: any[]) => {
            _closeTab(sender, tabs.length - sender.tab.index);
        });
    };
    self.tabOnly = (_message: any, sender: any, _sendResponse: any) => {
        chrome.tabs.query({ currentWindow: true }, (tabs: any[]) => {
            const ids = tabs
                .filter((t) => {
                    return t.id != sender.tab.id && !t.pinned;
                })
                .map((t) => {
                    return t.id;
                });
            chrome.tabs.remove(ids);
        });
    };

    self.closeAudibleTab = (_message: any, _sender: any, _sendResponse: any) => {
        chrome.tabs.query({ audible: true }, (tabs: any[]) => {
            if (tabs) {
                chrome.tabs.remove(tabs[0].id);
            }
        });
    };
    self.muteTab = (_message: any, sender: any, _sendResponse: any) => {
        const tab = sender.tab;
        chrome.tabs.update(tab.id, {
            muted: !tab.mutedInfo.muted,
        });
    };
    self.openLast = (_message: any, _sender: any, _sendResponse: any) => {
        chrome.sessions.restore();
    };
    self.duplicateTab = (message: any, sender: any, _sendResponse: any) => {
        chrome.tabs.duplicate(sender.tab.id, () => {
            if (message.active === false) {
                chrome.tabs.update(sender.tab.id, { active: true });
            }
        });
    };
    let previousWindowChoice = -1;
    self.getWindows = (message: any, _sender: any, sendResponse: any) => {
        chrome.tabs.query({ currentWindow: false }, (tabs: any[]) => {
            const windows: Record<string, any> = {};
            tabs.forEach((t) => {
                const tabsInWindow = windows[t.windowId] || [];
                tabsInWindow.push({ title: t.title, url: t.url });
                windows[t.windowId] = tabsInWindow;
            });
            _response(message, sendResponse, {
                windows: Object.keys(windows).map((w) => {
                    return {
                        id: w,
                        tabs: windows[w],
                        isPreviousChoice: parseInt(w) === previousWindowChoice,
                    };
                }),
            });
        });
    };
    self.moveToWindow = (message: any, sender: any, _sendResponse: any) => {
        if (message.windowId === -1) {
            chrome.windows.create({ tabId: sender.tab.id });
        } else {
            chrome.tabs.move(sender.tab.id, { windowId: message.windowId, index: -1 }, () => {
                focusTab(message.windowId, sender.tab.id);
            });
        }
        previousWindowChoice = message.windowId;
    };
    self.gatherWindows = (_message: any, sender: any, _sendResponse: any) => {
        const windowId = sender.tab.windowId;
        chrome.tabs.query({ currentWindow: false }, (tabs: any[]) => {
            tabs.forEach((tab) => {
                chrome.tabs.move(tab.id, { windowId, index: -1 });
            });
        });
    };
    self.gatherTabs = (message: any, sender: any, _sendResponse: any) => {
        const windowId = sender.tab.windowId;
        message.tabs.forEach((tab: any) => {
            chrome.tabs.move(tab.id, { windowId, index: -1 });
        });
    };
    self.getBookmarkFolders = (message: any, _sender: any, sendResponse: any) => {
        chrome.bookmarks.getTree((tree: any[]) => {
            bookmarkFolders = [];
            getFolders(tree[0], "");
            _response(message, sendResponse, {
                folders: bookmarkFolders,
            });
        });
    };
    self.createBookmark = (message: any, _sender: any, sendResponse: any) => {
        removeBookmark(message.page.url, () => {
            createBookmark(message.page, (ret) => {
                _response(message, sendResponse, {
                    bookmark: ret,
                });
            });
        });
    };
    function filterBookmarksByQuery(bookmarks: any[], query: string, caseSensitive: boolean) {
        return bookmarks.filter((b) => {
            let title = b.title;
            let url = b.url;
            if (!caseSensitive) {
                title = title.toLowerCase();
                url = url && url.toLowerCase();
                query = query.toLowerCase();
            }
            return title.indexOf(query) !== -1 || (url && url.indexOf(query) !== -1);
        });
    }
    self.getBookmarks = (message: any, _sender: any, sendResponse: any) => {
        if (message.parentId) {
            chrome.bookmarks.getSubTree(message.parentId, (tree: any[]) => {
                let bookmarks = tree[0].children;
                if (message.query && message.query.length) {
                    bookmarks = filterBookmarksByQuery(
                        bookmarks,
                        message.query,
                        message.caseSensitive,
                    );
                }
                _response(message, sendResponse, {
                    bookmarks: bookmarks,
                });
            });
        } else {
            if (message.query && message.query.length) {
                chrome.bookmarks.search(message.query, (tree: any[]) => {
                    _response(message, sendResponse, {
                        bookmarks: filterBookmarksByQuery(
                            tree,
                            message.query,
                            message.caseSensitive,
                        ),
                    });
                });
            } else {
                chrome.bookmarks.getTree((tree: any[]) => {
                    _response(message, sendResponse, {
                        bookmarks: tree[0].children,
                    });
                });
            }
        }
    };
    self.getHistory = (message: any, _sender: any, sendResponse: any) => {
        _getHistory(
            message.query || "",
            message.maxResults || 100,
            (tree) => {
                _response(message, sendResponse, {
                    history: tree,
                });
            },
            message.sortByMostUsed,
        );
    };
    self.addHistories = (message: any, _sender: any, _sendResponse: any) => {
        message.history.forEach((h: string) => {
            chrome.history.addUrl({ url: h });
        });
    };
    function normalizeURL(url: string) {
        if (
            !/^view-source:|^javascript:/.test(url) &&
            /^(?:https?:\/\/)?(?:[^@/\n]+@)?(?:www\.)?([^:/\n]+)/im.test(url)
        ) {
            if (!/^[\w-]+?:/i.test(url)) {
                url = "http://" + url;
            }
        }
        return url;
    }

    function openUrlInNewTab(currentTab: any, url: string, message: any) {
        let newTabPosition;
        if (currentTab) {
            switch (conf.newTabPosition) {
                case "left":
                    newTabPosition = currentTab.index;
                    break;
                case "right":
                    newTabPosition = currentTab.index + 1;
                    break;
                case "first":
                    newTabPosition = 0;
                    break;
                case "last":
                    break;
                default:
                    newTabPosition = currentTab.index + 1 + chromelikeNewTabPosition;
                    chromelikeNewTabPosition++;
                    break;
            }
        }
        chrome.tabs.create(
            {
                url: url,
                active: message.tab.active,
                index: newTabPosition,
                pinned: message.tab.pinned,
                openerTabId: currentTab.id,
            },
            (tab: any) => {
                if (message.scrollLeft || message.scrollTop) {
                    tabMessages[tab.id] = {
                        scrollLeft: message.scrollLeft,
                        scrollTop: message.scrollTop,
                    };
                }
            },
        );
    }

    self.openLink = (message: any, sender: any, _sendResponse: any) => {
        const url = normalizeURL(message.url);
        if (url.startsWith("javascript:")) {
            sendTabMessage(sender.tab.id, 0, {
                subject: "showBanner",
                message: "JavaScript URLs are not allowed in such operation.",
            });
        } else {
            if (message.tab.tabbed) {
                if (
                    (sender.frameId !== 0 &&
                        chrome.runtime.getURL("pages/frontend.html") === sender.url) ||
                    !sender.tab
                ) {
                    // if current call was made from Omnibar, the sender.tab may be stale,
                    // as sender was bound when port was created.
                    getActiveTab((tab: any) => {
                        openUrlInNewTab(tab, url, message);
                    });
                } else {
                    openUrlInNewTab(sender.tab, url, message);
                }
            } else {
                chrome.tabs.update(
                    {
                        url: url,
                        pinned: message.tab.pinned || sender.tab.pinned,
                    },
                    (tab: any) => {
                        if (message.scrollLeft || message.scrollTop) {
                            tabMessages[tab.id] = {
                                scrollLeft: message.scrollLeft,
                                scrollTop: message.scrollTop,
                            };
                        }
                    },
                );
            }
        }
    };
    self.viewSource = (message: any, sender: any, sendResponse: any) => {
        message.url = "view-source:" + sender.tab.url;
        self.openLink(message, sender, sendResponse);
    };
    function registerUserScript(snippets: any, callback?: () => void) {
        if (!isUserScriptsAvailable()) {
            callback && callback();
            return;
        }
        const userScriptId = "settingsSnippets";
        const invokeCallback = () => {
            if (chrome.runtime.lastError) {
                console.error("userScripts API error:", chrome.runtime.lastError);
            }
            callback && callback();
        };
        if (snippets) {
            chrome.userScripts.getScripts({ ids: [userScriptId] }, (r: any[]) => {
                if (chrome.runtime.lastError) {
                    console.error("userScripts.getScripts error:", chrome.runtime.lastError);
                    callback && callback();
                    return;
                }
                const code = `import('./api.js').then((module) => {module.default("${chrome.runtime.getURL("/")}", (api, settings) => {${snippets}\n})});`;
                const registerSettingSnippets = () => {
                    chrome.userScripts.register(
                        [
                            {
                                allFrames: true,
                                id: userScriptId,
                                matches: ["*://*/*", "file:///*"],
                                js: [{ code }],
                            },
                        ],
                        invokeCallback,
                    );
                };
                if (r.length > 0) {
                    if (r[0].js[0].code !== code) {
                        chrome.userScripts.unregister(
                            { ids: [userScriptId] },
                            registerSettingSnippets,
                        );
                    } else {
                        callback && callback();
                    }
                } else {
                    registerSettingSnippets();
                }
            });
        } else {
            chrome.userScripts.getScripts({ ids: [userScriptId] }, (r: any[]) => {
                if (chrome.runtime.lastError) {
                    console.error("userScripts.getScripts error:", chrome.runtime.lastError);
                    callback && callback();
                    return;
                }
                if (r.length > 0) {
                    chrome.userScripts.unregister({ ids: [userScriptId] }, invokeCallback);
                } else {
                    callback && callback();
                }
            });
        }
    }

    function onFullSettingsRequested(data: any, callback?: () => void) {
        data.isMV3 = isMV3;
        data.isUserScriptsAvailable = isUserScriptsAvailable();
        if (isMV3) {
            data.showAdvanced = data.isUserScriptsAvailable && data.showAdvanced;
        }

        if (data.isUserScriptsAvailable && data.showAdvanced) {
            registerUserScript(data.snippets, callback);
        } else if (data.isUserScriptsAvailable) {
            registerUserScript(null, callback);
        } else {
            callback && callback();
        }
    }
    self.getSettings = (message: any, _sender: any, sendResponse: any) => {
        let pf = loadSettings;
        if (message.key === "RAW") {
            pf = browser.loadRawSettings;
            message.key = "";
        }
        pf(message.key, (data: any) => {
            if (message.key === undefined) {
                onFullSettingsRequested(data);
            }

            _response(message, sendResponse, {
                settings: data,
            });
        });
    };
    function isUserScriptsAvailable() {
        try {
            if (chrome.userScripts) {
                return true;
            }
        } catch {
            return false;
        }
        return false;
    }
    self.updateSettings = (message: any, _sender: any, sendResponse: any) => {
        const error = "";
        if (message.scope === "snippets") {
            // For settings from snippets, don't broadcast the update
            // neither persist into storage
            for (const k in message.settings) {
                if (Object.prototype.hasOwnProperty.call(conf, k)) {
                    conf[k] = message.settings[k];
                }
            }
            return { error };
        } else {
            if (message.settings.showAdvanced && isMV3) {
                if (isUserScriptsAvailable()) {
                    chrome.userScripts.configureWorld({
                        csp: "script-src 'self' 'unsafe-eval'",
                        messaging: true,
                    });
                    _updateAndPostSettings(message.settings);
                    registerUserScript(message.settings.snippets, () => {
                        _response(message, sendResponse, { error });
                    });
                    return;
                } else {
                    return {
                        error: "Advanced mode is only available when Developer mode is turned on from chrome://extensions/.",
                    };
                }
            } else {
                _updateAndPostSettings(message.settings);
            }
        }
        return { error };
    };
    self.updateInputHistory = (message: any, _sender: any, sendResponse: any) => {
        let key: string | undefined = undefined;
        let value: any;
        for (const k in message) {
            key = k + "History";
            value = message[k];
            break;
        }
        if (key) {
            loadSettings(key, (data: any) => {
                let curr = data[key!] || [];
                const toUpdate: Record<string, any> = {};
                if (value.constructor.name === "Array") {
                    toUpdate[key!] = value;
                    _updateAndPostSettings(toUpdate);
                } else if (value.trim().length && value !== ".") {
                    curr = curr.filter((c: string) => {
                        return c.trim().length && c !== value && c !== ".";
                    });
                    curr.unshift(value);
                    if (curr.length > 50) {
                        curr.pop();
                    }
                    toUpdate[key!] = curr;
                    _updateAndPostSettings(toUpdate);
                }
                _response(message, sendResponse, {
                    history: curr,
                });
            });
        }
    };
    self.setSurfingkeysIcon = (message: any, sender: any, _sendResponse: any) => {
        let icon = "icons/48.png";
        if (message.status === "disabled") {
            icon = "icons/48-x.png";
        } else if (message.status === "lurking") {
            icon = "icons/48-l.png";
        }
        const browserAction = isMV3 ? chrome.action : chrome.browserAction;
        browserAction.setIcon({
            path: icon,
            tabId: sender.tab ? sender.tab.id : undefined,
        });
    };
    self.request = (message: any, _sender: any, sendResponse: any) => {
        request(
            message.url,
            (res) => {
                _response(message, sendResponse, {
                    text: res,
                });
            },
            message.headers,
            message.data,
            (e) => {
                _response(message, sendResponse, {
                    error: e.toString(),
                });
            },
        );
    };
    self.requestImage = (message: any, _sender: any, sendResponse: any) => {
        fetch(message.url, {
            method: "GET",
        })
            .then((res) => {
                return res.blob();
            })
            .then((blob) => {
                return createImageBitmap(blob);
            })
            .then((img) => {
                const canvas = new OffscreenCanvas(img.width, img.height);
                const ctx = canvas.getContext("2d")!;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.convertToBlob().then((blob) => {
                    const fr = new FileReader();
                    fr.onload = (e) => {
                        _response(message, sendResponse, {
                            text: e.target!.result,
                        });
                    };
                    fr.readAsDataURL(blob);
                });
            })
            .catch(() => {
                _response(message, sendResponse, {
                    text: "",
                });
            });
    };
    self.nextFrame = (message: any, sender: any, _sendResponse: any) => {
        const tid = sender.tab.id;
        chrome.scripting.executeScript(
            {
                target: {
                    allFrames: true,
                    tabId: tid,
                },
                func: () => {
                    return typeof (window as any).getFrameId === "function"
                        ? (window as any).getFrameId()
                        : 0;
                },
            },
            (framesInTab: any[]) => {
                framesInTab = framesInTab
                    .map((res) => {
                        return res.result;
                    })
                    .filter((frameId) => {
                        return frameId;
                    });

                if (framesInTab.length > 0) {
                    let i = 0;
                    for (i = 0; i < framesInTab.length; i++) {
                        if (framesInTab[i] === message.frameId) {
                            break;
                        }
                    }
                    i = i === framesInTab.length - 1 ? 0 : i + 1;
                    sendTabMessage(tid, -1, {
                        subject: "focusFrame",
                        frameId: framesInTab[i],
                    });
                }
            },
        );
    };
    self.moveTab = (message: any, sender: any, _sendResponse: any) => {
        chrome.tabs.query(
            {
                windowId: sender.tab.windowId,
            },
            (tabs: any[]) => {
                const to = _fixTo(sender.tab.index + message.step * message.repeats, tabs.length);
                chrome.tabs.move(sender.tab.id, {
                    index: to,
                });
            },
        );
    };
    function _quit() {
        chrome.windows.getAll(
            {
                populate: false,
            },
            (windows: any[]) => {
                windows.forEach((w) => {
                    chrome.windows.remove(w.id);
                });
            },
        );
    }
    self.quit = (_message: any, _sender: any, _sendResponse: any) => {
        _quit();
    };
    self.createSession = (message: any, _sender: any, _sendResponse: any) => {
        loadSettings("sessions", (data: any) => {
            chrome.tabs.query({}, (tabs: any[]) => {
                const tabGroup: Record<string, any[]> = {};
                tabs.forEach((tab) => {
                    if (tab && tab.index !== void 0) {
                        if (!Object.prototype.hasOwnProperty.call(tabGroup, tab.windowId)) {
                            tabGroup[tab.windowId] = [];
                        }
                        if (tab.url !== newTabUrl) {
                            tabGroup[tab.windowId].push(tab.url);
                        }
                    }
                });
                const tabg = [];
                for (const k in tabGroup) {
                    if (tabGroup[k].length) {
                        tabg.push(tabGroup[k]);
                    }
                }
                data.sessions[message.name] = {};
                data.sessions[message.name]["tabs"] = tabg;
                _updateAndPostSettings(
                    {
                        sessions: data.sessions,
                    },
                    message.quitAfterSaved ? _quit : undefined,
                );
            });
        });
    };
    self.openSession = (message: any, _sender: any, _sendResponse: any) => {
        loadSettings("sessions", (data: any) => {
            if (Object.prototype.hasOwnProperty.call(data.sessions, message.name)) {
                const urls = data.sessions[message.name]["tabs"];
                urls[0].forEach((url: string) => {
                    chrome.tabs.create({
                        url: url,
                        active: false,
                        pinned: false,
                    });
                });
                for (let i = 1; i < urls.length; i++) {
                    const a = urls[i];
                    chrome.windows.create({}, (win: any) => {
                        a.forEach((url: string) => {
                            chrome.tabs.create({
                                windowId: win.id,
                                url: url,
                                active: false,
                                pinned: false,
                            });
                        });
                    });
                }
                chrome.tabs.query(
                    {
                        url: newTabUrl,
                    },
                    (tabs: any[]) => {
                        chrome.tabs.remove(
                            tabs.map((t) => {
                                return t.id;
                            }),
                        );
                    },
                );
            }
        });
    };
    self.deleteSession = (message: any, _sender: any, _sendResponse: any) => {
        loadSettings("sessions", (data: any) => {
            delete data.sessions[message.name];
            _updateAndPostSettings({
                sessions: data.sessions,
            });
        });
    };
    self.closeDownloadsShelf = (message: any, _sender: any, _sendResponse: any) => {
        if (message.clearHistory) {
            chrome.downloads.erase({ urlRegex: ".*" });
        } else {
            chrome.downloads.setShelfEnabled(false);
            chrome.downloads.setShelfEnabled(true);
        }
    };
    self.getDownloads = (message: any, _sender: any, sendResponse: any) => {
        chrome.downloads.search(message.query, (items: any[]) => {
            _response(message, sendResponse, {
                downloads: items,
            });
        });
    };
    self.download = (message: any, _sender: any, _sendResponse: any) => {
        chrome.downloads.download({
            url: message.url,
            filename: message.filename,
            saveAs: message.saveAs,
        });
    };
    self.tabURLAccessed = (message: any, sender: any, _sendResponse: any) => {
        if (sender.tab) {
            const tabId = sender.tab.id;
            _setScrollPos_bg(tabId);
            if (!Object.prototype.hasOwnProperty.call(tabURLs, tabId)) {
                tabURLs[tabId] = {};
            }
            tabURLs[tabId][message.url] = message.title;
            return {
                active: sender.tab.active,
                index: conf.showTabIndices ? sender.tab.index + 1 : 0,
            };
        } else {
            return {};
        }
    };
    self.getTabURLs = (_message: any, sender: any, _sendResponse: any) => {
        const tabURL = tabURLs[sender.tab.id] || {};
        const urls = Object.keys(tabURL).map((u) => {
            return {
                url: u,
                title: tabURL[u],
            };
        });
        return {
            urls: urls,
        };
    };
    self.getTopURL = (_message: any, sender: any, _sendResponse: any) => {
        return {
            url: sender.tab ? sender.tab.url : "",
        };
    };

    self.setZoom = (message: any, sender: any, _sendResponse: any) => {
        const tabId = sender.tab.id;
        const zoomFactor = message.zoomFactor * message.repeats;
        if (zoomFactor == 0) {
            chrome.tabs.getZoomSettings(tabId, (settings: any) => {
                const defaultZoom = settings.defaultZoomFactor ? settings.defaultZoomFactor : 1;
                chrome.tabs.setZoom(tabId, defaultZoom);
            });
        } else {
            chrome.tabs.getZoom(tabId, (zf: number) => {
                chrome.tabs.setZoom(tabId, zf + zoomFactor);
            });
        }
    };
    function _removeURL(uid: string, cb: () => void) {
        const type = uid[0];
        uid = uid.substr(1);
        if (type === "B") {
            chrome.bookmarks.remove(uid, cb);
        } else if (type === "H") {
            chrome.history.deleteUrl({ url: uid }, cb);
        } else if (type === "T") {
            const parts = uid.split(":").map((u) => {
                return parseInt(u);
            });
            chrome.windows.update(
                parts[0],
                {
                    focused: true,
                },
                () => {
                    chrome.tabs.remove(parts[1], cb);
                },
            );
        } else if (type === "M") {
            loadSettings("marks", (data: any) => {
                delete data.marks[uid];
                _updateAndPostSettings({ marks: data.marks }, cb);
            });
        }
    }
    self.removeURL = (message: any, _sender: any, sendResponse: any) => {
        let removed = 0;
        let totalToRemoved = message.uid.length;
        let uid = message.uid;
        if (typeof message.uid === "string") {
            totalToRemoved = 1;
            uid = [message.uid];
        }
        function _done() {
            removed++;
            if (removed === totalToRemoved) {
                _response(message, sendResponse, {
                    response: "Done",
                });
            }
        }
        uid.forEach((u: string) => {
            _removeURL(u, _done);
        });
    };
    self.localData = (message: any, _sender: any, sendResponse: any) => {
        if (message.data.constructor === Object) {
            chrome.storage.local.set(message.data, () => {});
            // broadcast the change also, such as lastKeys
            // we would set lastKeys in sync to avoid breaching chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE
            _broadcastSettings(message.data);
        } else {
            // string or array of string keys
            chrome.storage.local.get(message.data, (data: any) => {
                _response(message, sendResponse, {
                    data: data,
                });
            });
        }
    };
    self.captureVisibleTab = (message: any, _sender: any, sendResponse: any) => {
        chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl: string) => {
            _response(message, sendResponse, {
                dataUrl: dataUrl,
            });
        });
    };
    self.getCaptureSize = (message: any, _sender: any, sendResponse: any) => {
        const img = document.createElement("img");
        img.onload = () => {
            _response(message, sendResponse, {
                width: img.width,
                height: img.height,
            });
        };
        chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl: string) => {
            img.src = dataUrl;
        });
    };
    self.deleteHistoryOlderThan = (message: any, _sender: any, _sendResponse: any) => {
        const days = message.days || 0;
        const hours = message.hours || 0;
        chrome.history.deleteRange(
            {
                startTime: 0,
                endTime: new Date().getTime() - (days * 86400 + hours * 3600) * 1000,
            },
            () => {},
        );
    };
    function removeBookmark(url: string, cb?: () => void) {
        chrome.bookmarks.search(
            {
                url: url,
            },
            (bookmarks: any[]) => {
                bookmarks.forEach((b) => {
                    chrome.bookmarks.remove(b.id);
                });
                cb && cb();
            },
        );
    }
    self.removeBookmark = (_message: any, sender: any, _sendResponse: any) => {
        removeBookmark(sender.tab.url);
    };
    self.getBookmark = (message: any, sender: any, sendResponse: any) => {
        chrome.bookmarks.search(
            {
                url: sender.tab.url,
            },
            (bookmarks: any[]) => {
                _response(message, sendResponse, {
                    bookmarks: bookmarks,
                });
            },
        );
    };

    self.initGist = (message: any, _sender: any, sendResponse: any) => {
        return Gist.initGist(message.token, (gist: string) => {
            _response(message, sendResponse, {
                gist: gist,
            });
        });
    };
    self.readComment = (message: any, _sender: any, sendResponse: any) => {
        Gist.readComment(message.index, (resp: any) => {
            _response(message, sendResponse, resp);
        });
    };
    self.editComment = (message: any, _sender: any, sendResponse: any) => {
        Gist.editComment(message.index, message.content, (resp: any) => {
            _response(message, sendResponse, { gistResp: resp });
        });
    };

    let _queueURLs: any[] = [];
    self.queueURLs = (message: any, _sender: any, _sendResponse: any) => {
        _queueURLs = _queueURLs.concat(message.urls);
    };
    self.getQueueURLs = (_message: any, _sender: any, _sendResponse: any) => {
        return {
            queueURLs: _queueURLs,
        };
    };
    self.clearQueueURLs = (_message: any, _sender: any, _sendResponse: any) => {
        _queueURLs = [];
    };

    self.openIncognito = (message: any, _sender: any, _sendResponse: any) => {
        chrome.windows.create({ url: message.url, incognito: true });
    };

    self.writeClipboard = (message: any, _sender: any, _sendResponse: any) => {
        navigator.clipboard.writeText(message.text);
    };
    self.getContainerName = browser._getContainerName(self, _response);
    chrome.runtime.setUninstallURL(
        "http://brookhong.github.io/2018/01/30/why-did-you-uninstall-surfingkeys.html",
    );
}

export { _save, dictFromArray, extendObject, getSubSettings, start };
