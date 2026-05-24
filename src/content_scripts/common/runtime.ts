// Browser-extension global. The typed BrowserAdapter (task #13) will replace
// this narrow declaration once cross-browser API access is centralized.
declare const chrome: {
    runtime: {
        sendMessage(message: unknown, callback?: (response: any) => void): void;
        onMessage: {
            addListener(
                callback: (
                    msg: any,
                    sender: unknown,
                    sendResponse: (response?: unknown) => void,
                ) => void,
            ): void;
        };
    };
};

function dispatchSKEvent(type: string, args?: unknown, target: EventTarget = document): void {
    target.dispatchEvent(new CustomEvent(`surfingkeys:${type}`, { detail: args }));
}

interface RuntimeFn {
    (
        action: string,
        args?: Record<string, unknown> | null,
        callback?: (response: any) => void,
    ): void;
    /** Pending repeat count shared with the mode system; set per key action. */
    repeats: number;
}

/**
 * Call background `action` with `args`, the `callback` will be executed with response from background.
 *
 * @param {string} action a background action to be called.
 * @param {object} args the parameters to be passed to the background action.
 * @param {function} callback a function to be executed with the result from the background action.
 *
 * @example
 *
 * RUNTIME('getTabs', {queryInfo: {currentWindow: true}}, response => {
 *   console.log(response);
 * });
 */
const RUNTIME = function (
    action: string,
    args?: Record<string, unknown> | null,
    callback?: (response: any) => void,
): void {
    const actionsRepeatBackground = [
        "closeTab",
        "nextTab",
        "previousTab",
        "moveTab",
        "reloadTab",
        "setZoom",
        "closeTabLeft",
        "closeTabRight",
        "focusTabByIndex",
    ];
    const a: Record<string, unknown> = args || {};
    a.action = action;
    if (actionsRepeatBackground.indexOf(action) !== -1) {
        // if the action can only be repeated in background, pass repeats to background with args,
        // and set RUNTIME.repeats 1, so that it won't be repeated in foreground's _handleMapKey
        a.repeats = RUNTIME.repeats;
        RUNTIME.repeats = 1;
    }
    try {
        a.needResponse = callback !== undefined;
        chrome.runtime.sendMessage(a, callback);
    } catch (e) {
        dispatchSKEvent("front", ["showPopup", "[runtime exception] " + e]);
    }
} as RuntimeFn;

type MessageHandler = (
    msg: any,
    sender: unknown,
    sendResponse: (response?: unknown) => void,
) => void;

const _handlers: Record<string, MessageHandler> = {};

const conf = {
    lastKeys: "",
    // local part from settings
    blocklistPattern: undefined as RegExp | undefined,
    lurkingPattern: undefined as RegExp | undefined,
    disabledOnActiveElementPattern: undefined as string | undefined,
    smartCase: true,
    caseSensitive: false,
    clickablePat: /(https?:\/\/|thunder:\/\/|magnet:)\S+/gi,
    clickableSelector: "",
    editableSelector: "div.CodeMirror-scroll,div.ace_content",
    cursorAtEndOfInput: true,
    defaultSearchEngine: "g",
    editableBodyCare: true,
    enableAutoFocus: true,
    enableEmojiInsertion: false,
    experiment: false,
    focusFirstCandidate: false,
    focusOnSaved: true,
    hintAlign: "center",
    hintExplicit: false,
    hintShiftNonActive: false,
    historyMUOrder: true,
    language: undefined as string | undefined,
    lastQuery: "",
    modeAfterYank: "",
    nextLinkRegex: /(\b(next)\b)|下页|下一页|后页|下頁|下一頁|後頁|>>|»/i,
    digitForRepeat: true,
    omnibarMaxResults: 10,
    omnibarHistoryCacheSize: 100,
    omnibarPosition: "middle",
    omnibarSuggestion: true,
    omnibarSuggestionTimeout: 200,
    omnibarTabsQuery: {} as Record<string, unknown>,
    pageUrlRegex: [] as (string | RegExp)[],
    prevLinkRegex: /(\b(prev|previous)\b)|上页|上一页|前页|上頁|上一頁|前頁|<<|«/i,
    repeatThreshold: 9,
    richHintsForKeystroke: 1000,
    scrollFallback: false,
    scrollStepSize: 70,
    showModeStatus: false,
    smartPageBoundary: false,
    smoothScroll: true,
    startToShowEmoji: 2,
    stealFocusOnLoad: true,
    tabIndicesSeparator: "|",
    tabsThreshold: 100,
    verticalTabs: true,
    textAnchorPat: /(^[\n\r\s]*\S{3,}|\b\S{4,})/g,
    ignoredFrameHosts: ["https://tpc.googlesyndication.com"],
    scrollFriction: 0,
    caretViewport: null as number[] | null,
    mouseSelectToQuery: [] as string[],
};

const getTopURLPromise = new Promise<string>((resolve) => {
    if (window === top) {
        resolve(window.location.href);
    } else {
        RUNTIME("getTopURL", null, (rs) => {
            resolve(rs.url);
        });
    }
});

chrome.runtime.onMessage.addListener((msg, sender, response) => {
    _handlers[msg.subject]?.(msg, sender, response);
});

const runtime = {
    conf,
    on(message: string, cb: MessageHandler): void {
        _handlers[message] = cb;
    },
    bookMessage(message: string, cb: MessageHandler): boolean {
        if (_handlers[message]) {
            return false;
        }
        _handlers[message] = cb;
        return true;
    },
    releaseMessage(message: string): void {
        delete _handlers[message];
    },
    getTopURL(cb: (url: string) => void): void {
        getTopURLPromise.then(cb);
    },
    postTopMessage(msg: unknown): void {
        getTopURLPromise.then((topUrl) => {
            if (window === top) {
                // Firefox use "resource://pdf.js" as window.origin for pdf viewer
                topUrl = window.location.origin;
            }
            if (topUrl === "null" || new URL(topUrl).origin === "file://") {
                topUrl = "*";
            }
            top!.postMessage(msg, topUrl);
        });
    },
    getCaseSensitive(query: string): boolean {
        return conf.caseSensitive || (conf.smartCase && /[A-Z]/.test(query));
    },
};

export { RUNTIME, dispatchSKEvent, runtime };
