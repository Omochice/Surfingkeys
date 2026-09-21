import { Result } from "@praha/byethrow";
import { userCodeError } from "@sk/common/result";
import { dispatchSKEvent } from "@sk/core/events";
import {
  applyUserSettings,
  getBrowserName,
  getClickableElements,
  initSKFunctionListener,
  isElementPartiallyInViewport,
  showBanner,
  showPopup,
} from "@sk/core/utils";
import { httpRequest, tabOpenLink } from "@sk/messaging/messagingActions";
import { RUNTIME } from "@sk/messaging/runtime";

import type {
  DomainOptions,
  InlineQuery,
  MapkeyOptions,
  RemapInModeOptions,
  RemapOptions,
  SearchSelectedWithOptions,
  UserScriptApi,
  UserScriptSettings,
} from "./types/api";

let EXTENSION_ROOT_URL = "";
function isInUIFrame() {
  return (
    !document.location.href.startsWith("chrome://") &&
    document.location.href.indexOf(EXTENSION_ROOT_URL) === 0
  );
}

function isDomainApplicable(domain?: RegExp) {
  return !domain || domain.test(document.location.href) || domain.test(window.origin);
}

function cmap(newKeystroke: string, oldKeystroke: string, options?: DomainOptions) {
  if (isDomainApplicable(options?.domain)) {
    dispatchSKEvent("front", ["addMapkey", "Omnibar", newKeystroke, oldKeystroke]);
  }
}

function cunmap(keystroke: string, options?: DomainOptions) {
  if (isDomainApplicable(options?.domain)) {
    dispatchSKEvent("front", ["removeMapkey", "Omnibar", keystroke]);
  }
}

const userDefinedFunctions: Record<string, (...args: unknown[]) => void> = {};
// eslint-disable-next-line typescript/no-explicit-any -- user keypress handler of arbitrary signature
function mapkey(keys: string, annotation: string | string[], jscode: any, options?: MapkeyOptions) {
  if (!options || isDomainApplicable(options.domain)) {
    const opt = options || {};
    userDefinedFunctions[`normal:${keys}`] = jscode;
    opt.codeHasParameter = jscode.length;
    dispatchSKEvent("api", ["mapkey", keys, annotation, opt]);
  }
}
function imapkey(
  keys: string,
  annotation: string | string[],
  // eslint-disable-next-line typescript/no-explicit-any -- user keypress handler of arbitrary signature
  jscode: any,
  options?: MapkeyOptions,
) {
  if (!options || isDomainApplicable(options.domain)) {
    userDefinedFunctions[`insert:${keys}`] = jscode;
    dispatchSKEvent("api", ["imapkey", keys, annotation, options]);
  }
}
function vmapkey(
  keys: string,
  annotation: string | string[],
  // eslint-disable-next-line typescript/no-explicit-any -- user keypress handler of arbitrary signature
  jscode: any,
  options?: MapkeyOptions,
) {
  if (!options || isDomainApplicable(options.domain)) {
    userDefinedFunctions[`visual:${keys}`] = jscode;
    dispatchSKEvent("api", ["vmapkey", keys, annotation, options]);
  }
}

const userDefinedCommands: Record<string, (...args: unknown[]) => void> = {};
// eslint-disable-next-line typescript/no-explicit-any -- user command callback of arbitrary signature
function addCommand(name: string, description: string, action: (...args: any[]) => void) {
  userDefinedCommands[name] = action;
  dispatchSKEvent("front", ["addCommand", name, description]);
}

function map(newKeystroke: string, oldKeystroke: string, options?: RemapOptions) {
  dispatchSKEvent("api", ["map", newKeystroke, oldKeystroke, options]);
}
function imap(newKeystroke: string, oldKeystroke: string, options?: RemapInModeOptions) {
  dispatchSKEvent("api", ["imap", newKeystroke, oldKeystroke, options]);
}
function lmap(newKeystroke: string, oldKeystroke: string, options?: DomainOptions) {
  dispatchSKEvent("api", ["lmap", newKeystroke, oldKeystroke, options]);
}
function vmap(newKeystroke: string, oldKeystroke: string, options?: RemapInModeOptions) {
  dispatchSKEvent("api", ["vmap", newKeystroke, oldKeystroke, options]);
}

const functionsToListSuggestions: Record<string, (response: unknown, request: unknown) => unknown> =
  {};

let inlineQuery: InlineQuery | undefined;
let hintsFunction: ((element: HTMLElement, shiftKey: boolean) => void) | undefined;
let onClipboardReadFn: (resp: unknown) => void;
let userScriptTask: () => void = () => {};
let hintsCreationResolve: ((found: number) => void) | null;
initSKFunctionListener(
  "user",
  {
    callUserFunction: (keys: string, para: unknown) => {
      if (Object.hasOwn(userDefinedFunctions, keys)) {
        const fn = userDefinedFunctions[keys];
        if (fn) {
          fn(para);
        }
      }
    },
    executeUserCommand: (name: string, args: unknown[]) => {
      if (Object.hasOwn(userDefinedCommands, name)) {
        const cmd = userDefinedCommands[name];
        if (cmd) {
          cmd(...args);
        }
      }
    },
    getSearchSuggestions: async (
      url: string,
      response: unknown,
      request: unknown,
      callbackId: string,
    ) => {
      if (Object.hasOwn(functionsToListSuggestions, url)) {
        const fn = functionsToListSuggestions[url];
        if (!fn) return;
        const r = await Result.try({
          try: () => fn(response, request),
          catch: (cause) => userCodeError("callback", cause),
        });
        if (Result.isSuccess(r)) {
          dispatchSKEvent("front", [callbackId, r.value]);
        } else {
          // This bundle runs in the page's MAIN world, where no extension API is reachable, so the
          // storage-gated logger cannot be used here.
          console.error("Search suggestion callback error:", r.error.cause);
          dispatchSKEvent("front", [callbackId, []]);
        }
      }
    },
    performInlineQuery: (query: string, callbackId: string) => {
      const iq = inlineQuery;
      if (!iq) {
        return;
      }
      const url = typeof iq.url === "function" ? iq.url(query) : iq.url + query;
      httpRequest(
        {
          url,
          headers: iq.headers,
        },
        (res: { error?: unknown }) => {
          if (res.error) {
            dispatchSKEvent("front", [callbackId, `${res.error} on ${url}`]);
          } else {
            dispatchSKEvent("front", [callbackId, iq.parseResult(res)]);
          }
        },
      );
    },
    runUserScript: () => {
      userScriptTask();
    },
    onClipboardRead: (resp: unknown) => {
      onClipboardReadFn(resp);
    },
    onHintClicked: (shiftKey: boolean, element: HTMLElement) => {
      if (typeof hintsFunction === "function") {
        hintsFunction(element, shiftKey);
      }
    },
    onHintCreated: (found: number) => {
      if (hintsCreationResolve) {
        hintsCreationResolve(found);
        hintsCreationResolve = null;
      }
    },
  },
  true,
);

function addSearchAlias(
  alias: string,
  prompt: string,
  searchUrl: string,
  searchLeaderKey?: string,
  suggestionUrl?: string,
  callbackToParseSuggestion?: (response: unknown, request: unknown) => unknown,
  onlyThisSiteKey?: string,
  options?: Record<string, unknown>,
) {
  if (![...alias].every((c) => c.charCodeAt(0) <= 0x7f)) {
    throw `Invalid alias ${alias}, which must be ASCII characters.`;
  }
  if (suggestionUrl != null && callbackToParseSuggestion != null) {
    functionsToListSuggestions[suggestionUrl] = callbackToParseSuggestion;
  }
  dispatchSKEvent("api", [
    "addSearchAlias",
    alias,
    prompt,
    searchUrl,
    searchLeaderKey,
    suggestionUrl,
    "user",
    onlyThisSiteKey,
    options,
  ]);
}

function createCssSelectorForElements(cssSelector: string, elements: unknown): number {
  let list: HTMLElement[] = [];
  if (elements instanceof HTMLElement) {
    list = [elements];
  } else if (Array.isArray(elements)) {
    list = elements.filter((m): m is HTMLElement => m instanceof HTMLElement);
  }
  list.forEach((m) => {
    m.classList.add(cssSelector);
  });
  return list.length;
}

const api = {
  RUNTIME,
  addSearchAlias,
  addCommand,
  cmap,
  cunmap,
  imap,
  imapkey,
  isElementPartiallyInViewport,
  getBrowserName,
  getClickableElements,
  lmap,
  vmap,
  vmapkey,
  map,
  mapkey,
  unmap: (keystroke: string, options?: DomainOptions) => {
    dispatchSKEvent("api", ["unmap", keystroke, options]);
  },
  iunmap: (keystroke: string, options?: DomainOptions) => {
    dispatchSKEvent("api", ["iunmap", keystroke, options]);
  },
  vunmap: (keystroke: string, options?: DomainOptions) => {
    dispatchSKEvent("api", ["vunmap", keystroke, options]);
  },
  unmapAllExcept: (keystrokes: string[], options?: DomainOptions) => {
    dispatchSKEvent("api", ["unmapAllExcept", keystrokes, options]);
  },
  removeSearchAlias: (alias: string, searchLeaderKey?: string, onlyThisSiteKey?: string) => {
    dispatchSKEvent("api", ["removeSearchAlias", alias, searchLeaderKey, onlyThisSiteKey]);
  },
  searchSelectedWith: (searchUrl: string, options?: SearchSelectedWithOptions) => {
    dispatchSKEvent("api", ["searchSelectedWith", searchUrl, options]);
  },
  tabOpenLink,
  Clipboard: {
    write: (text: string) => {
      dispatchSKEvent("api", ["clipboard:write", text]);
    },
    read: (cb: (resp: unknown) => void) => {
      onClipboardReadFn = cb;
      dispatchSKEvent("api", ["clipboard:read"]);
    },
  },
  Hints: {
    click: (links: unknown, force?: boolean) => {
      let selector: unknown = links;
      if (typeof links !== "string") {
        const hintsClicking = "surfingkeys--hints--clicking";
        if (createCssSelectorForElements(hintsClicking, links) === 0) {
          return;
        }
        selector = `.${hintsClicking}`;
      }
      dispatchSKEvent("api", ["hints:click", selector, force]);
    },
    create: (
      cssSelector: unknown,
      onHintKey: (element: HTMLElement, shiftKey: boolean) => void,
      attrs?: Record<string, unknown>,
    ) => {
      let selector: unknown = cssSelector;
      if (typeof cssSelector !== "string") {
        const hintsCreating = "surfingkeys--hints--creating";
        if (createCssSelectorForElements(hintsCreating, cssSelector) === 0) {
          return false;
        }
        selector = `.${hintsCreating}`;
      }
      hintsFunction = onHintKey;
      const promise = new Promise<number>((resolve) => {
        hintsCreationResolve = resolve;
      });
      dispatchSKEvent("api", ["hints:create", selector, "user", attrs]);
      return promise;
    },
    dispatchMouseClick: (element: HTMLElement) => {
      dispatchSKEvent("hints", ["dispatchMouseClick"], element);
    },
    style: (css: string, mode?: string) => {
      dispatchSKEvent("api", ["hints:style", css, mode]);
    },
    setCharacters: (chars: string) => {
      dispatchSKEvent("api", ["hints:setCharacters", chars]);
    },
    setNumeric: () => {
      dispatchSKEvent("api", ["hints:setNumeric"]);
    },
  },
  Normal: {
    feedkeys: (keys: string) => {
      dispatchSKEvent("api", ["normal:feedkeys", keys]);
    },
    jumpVIMark: (mark: string) => {
      dispatchSKEvent("api", ["normal:jumpVIMark", mark]);
    },
    passThrough: (timeout?: number) => {
      dispatchSKEvent("api", ["normal:passThrough", timeout]);
    },
    scroll: (type: string) => {
      dispatchSKEvent("api", ["normal:scroll", type]);
    },
  },
  Visual: {
    style: (element: string, style: string) => {
      dispatchSKEvent("api", ["visual:style", element, style]);
    },
  },
  Front: {
    registerInlineQuery: (args: InlineQuery) => {
      inlineQuery = args;
      dispatchSKEvent("api", ["front:registerInlineQuery"]);
    },
    openOmnibar: (args: Record<string, unknown>) => {
      dispatchSKEvent("api", ["front:openOmnibar", args]);
    },
    showBanner,
    showPopup,
  },
} satisfies UserScriptApi;

const initUserScripts = (
  extensionRootUrl: string,
  uf: (api: UserScriptApi, settings: UserScriptSettings) => void,
) => {
  EXTENSION_ROOT_URL = extensionRootUrl;
  if (isInUIFrame()) return;
  userScriptTask = () => {
    const settings: UserScriptSettings = {};
    const r = Result.try({
      try: (): void => {
        uf(api, settings);
      },
      catch: (cause) => userCodeError("snippet", cause),
    });
    applyUserSettings(
      {
        settings,
        error: Result.isFailure(r) ? String(r.error.cause) : "",
      },
      // Same MAIN-world constraint as above. applyUserSettings only emits errors, hence the fixed
      // console method.
      (_level, ...args) => {
        console.error(...args);
      },
    );
  };
  // A snippet's api calls only reach listeners the content script installs, so it decides when the
  // snippet runs.
  dispatchSKEvent("userScriptReady");
};

export default initUserScripts;
