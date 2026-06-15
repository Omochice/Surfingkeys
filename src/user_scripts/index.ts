import { Result } from "@praha/byethrow";

import { userCodeError } from "../common/result";
import { dispatchSKEvent } from "../content_scripts/common/events";
import { RUNTIME } from "../content_scripts/common/runtime";
import {
  applyUserSettings,
  getBrowserName,
  getClickableElements,
  httpRequest,
  initSKFunctionListener,
  isElementPartiallyInViewport,
  showBanner,
  showPopup,
  tabOpenLink,
} from "../content_scripts/common/utils";

let EXTENSION_ROOT_URL = "";
function isInUIFrame() {
  return (
    !document.location.href.startsWith("chrome://") &&
    document.location.href.indexOf(EXTENSION_ROOT_URL) === 0
  );
}

/** Options accepted by the mapkey family: a domain filter plus arbitrary forwarded flags. */
type MapkeyOptions = { domain?: RegExp; codeHasParameter?: number; [key: string]: unknown };

function isDomainApplicable(domain?: RegExp) {
  return !domain || domain.test(document.location.href) || domain.test(window.origin);
}

function cmap(
  new_keystroke: string,
  old_keystroke: string,
  domain?: RegExp,
  _new_annotation?: string,
) {
  if (isDomainApplicable(domain)) {
    dispatchSKEvent("front", ["addMapkey", "Omnibar", new_keystroke, old_keystroke]);
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

function map(
  new_keystroke: string,
  old_keystroke: string,
  domain?: RegExp,
  new_annotation?: string,
) {
  dispatchSKEvent("api", ["map", new_keystroke, old_keystroke, domain, new_annotation]);
}
function imap(
  new_keystroke: string,
  old_keystroke: string,
  domain?: RegExp,
  new_annotation?: string,
) {
  dispatchSKEvent("api", ["imap", new_keystroke, old_keystroke, domain, new_annotation]);
}
function lmap(
  new_keystroke: string,
  old_keystroke: string,
  domain?: RegExp,
  new_annotation?: string,
) {
  dispatchSKEvent("api", ["lmap", new_keystroke, old_keystroke, domain, new_annotation]);
}
function vmap(
  new_keystroke: string,
  old_keystroke: string,
  domain?: RegExp,
  new_annotation?: string,
) {
  dispatchSKEvent("api", ["vmap", new_keystroke, old_keystroke, domain, new_annotation]);
}

const functionsToListSuggestions: Record<string, (response: unknown, request: unknown) => unknown> =
  {};

/** A user-registered inline-query dictionary service. */
type InlineQuery = {
  url: string | ((query: string) => string);
  headers?: Record<string, string>;
  parseResult: (res: unknown) => unknown;
};

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
  search_url: string,
  search_leader_key?: string,
  suggestion_url?: string,
  callback_to_parse_suggestion?: (response: unknown, request: unknown) => unknown,
  only_this_site_key?: string,
  options?: Record<string, unknown>,
) {
  if (![...alias].every((c) => c.charCodeAt(0) <= 0x7f)) {
    throw `Invalid alias ${alias}, which must be ASCII characters.`;
  }
  if (suggestion_url != null && callback_to_parse_suggestion != null) {
    functionsToListSuggestions[suggestion_url] = callback_to_parse_suggestion;
  }
  dispatchSKEvent("api", [
    "addSearchAlias",
    alias,
    prompt,
    search_url,
    search_leader_key,
    suggestion_url,
    "user",
    only_this_site_key,
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
  unmap: (keystroke: string, domain?: RegExp) => {
    dispatchSKEvent("api", ["unmap", keystroke, domain]);
  },
  iunmap: (keystroke: string, domain?: RegExp) => {
    dispatchSKEvent("api", ["iunmap", keystroke, domain]);
  },
  vunmap: (keystroke: string, domain?: RegExp) => {
    dispatchSKEvent("api", ["vunmap", keystroke, domain]);
  },
  unmapAllExcept: (keystrokes: string[], domain?: RegExp) => {
    dispatchSKEvent("api", ["unmapAllExcept", keystrokes, domain]);
  },
  removeSearchAlias: (alias: string, search_leader_key?: string, only_this_site_key?: string) => {
    dispatchSKEvent("api", ["removeSearchAlias", alias, search_leader_key, only_this_site_key]);
  },
  searchSelectedWith: (
    se: string,
    onlyThisSite?: boolean,
    interactive?: boolean,
    alias?: string,
  ) => {
    dispatchSKEvent("api", ["searchSelectedWith", se, onlyThisSite, interactive, alias]);
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
};

/** The Surfingkeys API object handed to user snippet functions. */
type UserScriptApi = typeof api;

const initUserScripts = (
  extensionRootUrl: string,
  uf: (api: UserScriptApi, settings: Record<string, unknown>) => void,
) => {
  EXTENSION_ROOT_URL = extensionRootUrl;
  if (isInUIFrame()) return;
  userScriptTask = () => {
    const settings = {};
    const r = Result.try({
      try: (): void => {
        uf(api, settings);
      },
      catch: (cause) => userCodeError("snippet", cause),
    });
    applyUserSettings({
      settings,
      error: Result.isFailure(r) ? String(r.error.cause) : "",
    });
  };
  if (window === top) {
    userScriptTask();
  }
};

export default initUserScripts;
