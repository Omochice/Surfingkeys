import { filterByTitleOrUrl } from "../common/utils.js";
import { createBookmarkHandlers } from "./bookmarks.js";
import { createHistoryHandlers } from "./history.js";
import { request } from "./request.js";
import { createSettings } from "./settings.js";
import { createTabHistory } from "./tabHistory.js";

// Browser-extension globals. The typed BrowserAdapter (task #13) will replace
// these once cross-browser API access is centralized; background is almost
// entirely chrome.* glue, so it is treated as an untyped boundary here.
declare const chrome: any;

/**
 * A background message handler, dispatched by `message.action`. Returning a
 * truthy value sends it as the synchronous response; returning falsy while
 * `message.needResponse` is set defers to an asynchronous `sendResponse`.
 * Extracted background units export a `Record<string, MessageHandler>` map that
 * the composition root registers into the dispatch registry.
 */
export type MessageHandler = (
    message: any,
    sender?: any,
    sendResponse?: (result: any) => void,
) => any;

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
    const handlers: Record<string, MessageHandler> = {};

    const isMV3 = chrome.runtime.getManifest().manifest_version === 3;

    const tabHistory = createTabHistory();
    let chromelikeNewTabPosition = 0;

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

    function removeTab(tabId: number) {
        delete tabActivated[tabId];
        delete tabMessages[tabId];
        delete tabURLs[tabId];
        tabHistory.remove(tabId);
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
        tabHistory.record(activeInfo.tabId);
        tabActivated[activeInfo.tabId] = new Date().getTime();
        _tabActivated(activeInfo.tabId);
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

    const pendingPorts: any[] = [];
    function _response(message: any, sendResponse: (result: any) => void, result: any) {
        const idx = pendingPorts.indexOf(message);
        if (idx !== -1) {
            pendingPorts.splice(idx, 1);
        }
        sendResponse(result);
    }
    function handleMessage(_message: any, _sender: any, _sendResponse: any) {
        if (Object.prototype.hasOwnProperty.call(handlers, _message.action)) {
            const result = handlers[_message.action](_message, _sender, _sendResponse);
            if (_message.needResponse) {
                if (result) {
                    _sendResponse(result);
                    _message.needResponse = false;
                } else {
                    pendingPorts.push(_message);
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

    Object.assign(handlers, createBookmarkHandlers(_response));
    Object.assign(handlers, createHistoryHandlers(_response, browser, _filterByTitleOrUrl));

    const settings = createSettings({
        _response,
        conf,
        browser,
        sendTabMessage,
        tabMessages,
        setScrollPos: _setScrollPos_bg,
        handlers,
        newTabUrl,
        quit: _quit,
    });
    Object.assign(handlers, settings.handlers);

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

    function _filterByTitleOrUrl(tabs: any[], query: string) {
        tabs = tabs.filter((b) => {
            return b.url;
        });
        return filterByTitleOrUrl(tabs, query, false);
    }
    handlers.getTabs = (message: any, sender: any, sendResponse: any) => {
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
    handlers.togglePinTab = (_message: any, _sender: any, _sendResponse: any) => {
        getActiveTab((tab: any) => {
            return chrome.tabs.update(tab.id, {
                pinned: !tab.pinned,
            });
        });
    };
    handlers.closeTabByIds = (message: any, _sender: any, _sendResponse: any) => {
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
    handlers.focusTab = (message: any, sender: any, _sendResponse: any) => {
        if (message.windowId !== undefined && sender.tab.windowId !== message.windowId) {
            focusTab(message.windowId, message.tabId);
        } else {
            chrome.tabs.update(message.tabId, {
                active: true,
            });
        }
    };
    handlers.focusTabByIndex = (message: any, _sender: any, _sendResponse: any) => {
        const queryInfo = message.queryInfo || { currentWindow: true };
        chrome.tabs.query(queryInfo, (tabs: any[]) => {
            if (message.repeats > 0 && message.repeats <= tabs.length) {
                chrome.tabs.update(tabs[message.repeats - 1].id, {
                    active: true,
                });
            }
        });
    };
    handlers.goToLastTab = (_message: any, _sender: any, _sendResponse: any) => {
        const lastTab = tabHistory.previousTab();
        if (lastTab !== undefined) {
            chrome.tabs.update(lastTab, {
                active: true,
            });
        }
    };
    handlers.historyTab = (message: any, _sender?: any, _sendResponse?: any) => {
        const tabId = tabHistory.navigate(message);
        if (tabId !== undefined) {
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
    handlers.nextTab = (message: any, sender: any, _sendResponse: any) => {
        _nextTab(sender.tab, message.repeats);
    };
    handlers.previousTab = (message: any, sender: any, _sendResponse: any) => {
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
    handlers.reloadTab = (message: any, sender: any, _sendResponse: any) => {
        _roundRepeatTabs(sender.tab, message.repeats, (tabIds) => {
            tabIds.forEach((tabId) => {
                chrome.tabs.reload(tabId, {
                    bypassCache: message.nocache,
                });
            });
        });
    };
    handlers.closeTab = (message: any, sender: any, _sendResponse: any) => {
        _roundRepeatTabs(sender.tab, message.repeats, (tabIds) => {
            chrome.tabs.remove(tabIds, () => {
                if (conf.focusAfterClosed === "left") {
                    _nextTab(sender.tab, -1);
                } else if (conf.focusAfterClosed === "last") {
                    handlers.historyTab({ backward: true });
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

    handlers.closeTabLeft = (message: any, sender: any, _senderResponse: any) => {
        _closeTab(sender, -message.repeats);
    };
    handlers.closeTabRight = (message: any, sender: any, _senderResponse: any) => {
        _closeTab(sender, message.repeats);
    };
    handlers.closeTabsToLeft = (_message: any, sender: any, _senderResponse: any) => {
        _closeTab(sender, -sender.tab.index);
    };
    handlers.closeTabsToRight = (_message: any, sender: any, _senderResponse: any) => {
        chrome.tabs.query({ currentWindow: true }, (tabs: any[]) => {
            _closeTab(sender, tabs.length - sender.tab.index);
        });
    };
    handlers.tabOnly = (_message: any, sender: any, _sendResponse: any) => {
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

    handlers.closeAudibleTab = (_message: any, _sender: any, _sendResponse: any) => {
        chrome.tabs.query({ audible: true }, (tabs: any[]) => {
            if (tabs) {
                chrome.tabs.remove(tabs[0].id);
            }
        });
    };
    handlers.muteTab = (_message: any, sender: any, _sendResponse: any) => {
        const tab = sender.tab;
        chrome.tabs.update(tab.id, {
            muted: !tab.mutedInfo.muted,
        });
    };
    handlers.openLast = (_message: any, _sender: any, _sendResponse: any) => {
        chrome.sessions.restore();
    };
    handlers.duplicateTab = (message: any, sender: any, _sendResponse: any) => {
        chrome.tabs.duplicate(sender.tab.id, () => {
            if (message.active === false) {
                chrome.tabs.update(sender.tab.id, { active: true });
            }
        });
    };
    let previousWindowChoice = -1;
    handlers.getWindows = (message: any, _sender: any, sendResponse: any) => {
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
    handlers.moveToWindow = (message: any, sender: any, _sendResponse: any) => {
        if (message.windowId === -1) {
            chrome.windows.create({ tabId: sender.tab.id });
        } else {
            chrome.tabs.move(sender.tab.id, { windowId: message.windowId, index: -1 }, () => {
                focusTab(message.windowId, sender.tab.id);
            });
        }
        previousWindowChoice = message.windowId;
    };
    handlers.gatherWindows = (_message: any, sender: any, _sendResponse: any) => {
        const windowId = sender.tab.windowId;
        chrome.tabs.query({ currentWindow: false }, (tabs: any[]) => {
            tabs.forEach((tab) => {
                chrome.tabs.move(tab.id, { windowId, index: -1 });
            });
        });
    };
    handlers.gatherTabs = (message: any, sender: any, _sendResponse: any) => {
        const windowId = sender.tab.windowId;
        message.tabs.forEach((tab: any) => {
            chrome.tabs.move(tab.id, { windowId, index: -1 });
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

    handlers.openLink = (message: any, sender: any, _sendResponse: any) => {
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
    handlers.viewSource = (message: any, sender: any, sendResponse: any) => {
        message.url = "view-source:" + sender.tab.url;
        handlers.openLink(message, sender, sendResponse);
    };
    handlers.setSurfingkeysIcon = (message: any, sender: any, _sendResponse: any) => {
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
    handlers.request = (message: any, _sender: any, sendResponse: any) => {
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
    handlers.requestImage = (message: any, _sender: any, sendResponse: any) => {
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
    handlers.nextFrame = (message: any, sender: any, _sendResponse: any) => {
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
    handlers.moveTab = (message: any, sender: any, _sendResponse: any) => {
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
    handlers.quit = (_message: any, _sender: any, _sendResponse: any) => {
        _quit();
    };
    handlers.closeDownloadsShelf = (message: any, _sender: any, _sendResponse: any) => {
        if (message.clearHistory) {
            chrome.downloads.erase({ urlRegex: ".*" });
        } else {
            chrome.downloads.setShelfEnabled(false);
            chrome.downloads.setShelfEnabled(true);
        }
    };
    handlers.getDownloads = (message: any, _sender: any, sendResponse: any) => {
        chrome.downloads.search(message.query, (items: any[]) => {
            _response(message, sendResponse, {
                downloads: items,
            });
        });
    };
    handlers.download = (message: any, _sender: any, _sendResponse: any) => {
        chrome.downloads.download({
            url: message.url,
            filename: message.filename,
            saveAs: message.saveAs,
        });
    };
    handlers.tabURLAccessed = (message: any, sender: any, _sendResponse: any) => {
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
    handlers.getTabURLs = (_message: any, sender: any, _sendResponse: any) => {
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
    handlers.getTopURL = (_message: any, sender: any, _sendResponse: any) => {
        return {
            url: sender.tab ? sender.tab.url : "",
        };
    };

    handlers.setZoom = (message: any, sender: any, _sendResponse: any) => {
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
            settings.loadSettings("marks", (data: any) => {
                delete data.marks[uid];
                settings.updateAndPostSettings({ marks: data.marks }, cb);
            });
        }
    }
    handlers.removeURL = (message: any, _sender: any, sendResponse: any) => {
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
    handlers.localData = (message: any, _sender: any, sendResponse: any) => {
        if (message.data.constructor === Object) {
            chrome.storage.local.set(message.data, () => {});
            // broadcast the change also, such as lastKeys
            // we would set lastKeys in sync to avoid breaching chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE
            settings.broadcastSettings(message.data);
        } else {
            // string or array of string keys
            chrome.storage.local.get(message.data, (data: any) => {
                _response(message, sendResponse, {
                    data: data,
                });
            });
        }
    };
    handlers.captureVisibleTab = (message: any, _sender: any, sendResponse: any) => {
        chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl: string) => {
            _response(message, sendResponse, {
                dataUrl: dataUrl,
            });
        });
    };
    handlers.getCaptureSize = (message: any, _sender: any, sendResponse: any) => {
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
    handlers.initGist = (message: any, _sender: any, sendResponse: any) => {
        return Gist.initGist(message.token, (gist: string) => {
            _response(message, sendResponse, {
                gist: gist,
            });
        });
    };
    handlers.readComment = (message: any, _sender: any, sendResponse: any) => {
        Gist.readComment(message.index, (resp: any) => {
            _response(message, sendResponse, resp);
        });
    };
    handlers.editComment = (message: any, _sender: any, sendResponse: any) => {
        Gist.editComment(message.index, message.content, (resp: any) => {
            _response(message, sendResponse, { gistResp: resp });
        });
    };

    let _queueURLs: any[] = [];
    handlers.queueURLs = (message: any, _sender: any, _sendResponse: any) => {
        _queueURLs = _queueURLs.concat(message.urls);
    };
    handlers.getQueueURLs = (_message: any, _sender: any, _sendResponse: any) => {
        return {
            queueURLs: _queueURLs,
        };
    };
    handlers.clearQueueURLs = (_message: any, _sender: any, _sendResponse: any) => {
        _queueURLs = [];
    };

    handlers.openIncognito = (message: any, _sender: any, _sendResponse: any) => {
        chrome.windows.create({ url: message.url, incognito: true });
    };

    handlers.writeClipboard = (message: any, _sender: any, _sendResponse: any) => {
        navigator.clipboard.writeText(message.text);
    };
    handlers.getContainerName = browser._getContainerName(handlers, _response);
    chrome.runtime.setUninstallURL(
        "http://brookhong.github.io/2018/01/30/why-did-you-uninstall-surfingkeys.html",
    );
}

export { start };
