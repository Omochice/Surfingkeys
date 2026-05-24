// This module is the messaging service. It deliberately keeps the raw,
// callback-based chrome.runtime API rather than the promise-based
// BrowserAdapter: RUNTIME is used fire-and-forget (no callback) in many places,
// and the polyfill's promise form would turn every such call's
// "message port closed" into an unhandled rejection. onMessage stays here too
// for the same callback contract.
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

/**
 * Custom-event channels dispatched as `surfingkeys:<type>` for content↔frontend
 * communication. `front`/`api`/`user`/`hints`/`observer` are the registered
 * {@link initSKFunctionListener} namespaces; the rest are one-off lifecycle
 * events listened to directly.
 */
export type SKEventType =
    | "front"
    | "api"
    | "user"
    | "hints"
    | "observer"
    | "userSettingsLoaded"
    | "settingsFromSnippetsLoaded"
    | "iframeBoot"
    | "ensureFrontEnd"
    | "defaultSettingsLoaded";

function dispatchSKEvent(type: SKEventType, args?: unknown, target: EventTarget = document): void {
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

/**
 * The live settings bag shared across every content-script module as
 * {@link runtime.conf}. The object literal below is the default value of each
 * field; user settings are merged in by {@link applySettings} (content.ts),
 * which copies only keys that already exist here. Adding a setting therefore
 * means adding it both to this interface and to the defaults — there is no
 * index signature on purpose, so an unknown `conf.foo` is a type error rather
 * than silently `any`.
 */
export interface RuntimeConf {
    /** Keys typed so far in the pending sequence; runtime state, not persisted. */
    lastKeys: string[];
    /** Hydrated from the `blocklistPattern` setting; disables Surfingkeys on matching URLs. */
    blocklistPattern: RegExp | undefined;
    /** Hydrated from the `lurkingPattern` setting; enables lurking mode on matching URLs. */
    lurkingPattern: RegExp | undefined;
    disabledOnActiveElementPattern: string | undefined;
    smartCase: boolean;
    caseSensitive: boolean;
    clickablePat: RegExp;
    clickableSelector: string;
    editableSelector: string;
    cursorAtEndOfInput: boolean;
    defaultSearchEngine: string;
    editableBodyCare: boolean;
    enableAutoFocus: boolean;
    enableEmojiInsertion: boolean;
    experiment: boolean;
    focusFirstCandidate: boolean;
    focusOnSaved: boolean;
    hintAlign: string;
    hintExplicit: boolean;
    hintShiftNonActive: boolean;
    historyMUOrder: boolean;
    language: string | undefined;
    lastQuery: string;
    modeAfterYank: string;
    nextLinkRegex: RegExp;
    digitForRepeat: boolean;
    omnibarMaxResults: number;
    omnibarHistoryCacheSize: number;
    omnibarPosition: string;
    omnibarSuggestion: boolean;
    omnibarSuggestionTimeout: number;
    omnibarTabsQuery: Record<string, unknown>;
    /** Patterns matched against the page URL to locate the page-number segment for prev/next link navigation. */
    pageUrlRegex: (string | RegExp)[];
    prevLinkRegex: RegExp;
    repeatThreshold: number;
    richHintsForKeystroke: number;
    scrollFallback: boolean;
    scrollStepSize: number;
    showModeStatus: boolean;
    smartPageBoundary: boolean;
    smoothScroll: boolean;
    startToShowEmoji: number;
    stealFocusOnLoad: boolean;
    tabIndicesSeparator: string;
    tabsThreshold: number;
    verticalTabs: boolean;
    textAnchorPat: RegExp;
    /** Frame origins for which `getFrameId` skips content-script initialization. */
    ignoredFrameHosts: string[];
    scrollFriction: number;
    /** Caret-mode viewport as `[left, top, width, height]`; `null` until a caret is placed. */
    caretViewport: number[] | null;
    /** Window origins where a mouse text selection is turned into a search query. */
    mouseSelectToQuery: string[];
}

/**
 * The persisted settings bag exchanged with the background over the
 * `getSettings`/`updateSettings`/`settingsUpdated` messages and rendered by the
 * options page. It is deliberately distinct from {@link RuntimeConf}: this is
 * the **wire/storage** shape, so regex options arrive as their source strings
 * (hydrated into RegExp by `applySettings`/`ensureRegex` in content.ts) and it
 * carries UI/meta fields that are not part of the live config. The index
 * signature is honest — the background merges arbitrary user-snippet settings
 * and its own bookkeeping keys — while the named fields are the ones the
 * content scripts and options page actually read.
 */
export interface StoredSettings {
    showAdvanced?: boolean;
    isMV3?: boolean;
    isUserScriptsAvailable?: boolean;
    localPath?: string;
    snippets?: string;
    basicMappings?: Record<string, string>;
    disabledSearchAliases?: Record<string, string>;
    findHistory?: string[];
    error?: string;
    theme?: string;
    [key: string]: unknown;
}

const conf: RuntimeConf = {
    lastKeys: [],
    // local part from settings
    blocklistPattern: undefined,
    lurkingPattern: undefined,
    disabledOnActiveElementPattern: undefined,
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
    language: undefined,
    lastQuery: "",
    modeAfterYank: "",
    nextLinkRegex: /(\b(next)\b)|下页|下一页|后页|下頁|下一頁|後頁|>>|»/i,
    digitForRepeat: true,
    omnibarMaxResults: 10,
    omnibarHistoryCacheSize: 100,
    omnibarPosition: "middle",
    omnibarSuggestion: true,
    omnibarSuggestionTimeout: 200,
    omnibarTabsQuery: {},
    pageUrlRegex: [],
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
    caretViewport: null,
    mouseSelectToQuery: [],
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
