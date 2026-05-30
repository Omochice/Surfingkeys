import { RUNTIME, dispatchSKEvent } from "../content_scripts/common/runtime";
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

function _isDomainApplicable(domain?: RegExp) {
  return !domain || domain.test(document.location.href) || domain.test(window.origin);
}

function cmap(
  new_keystroke: string,
  old_keystroke: string,
  domain?: RegExp,
  _new_annotation?: string,
) {
  if (_isDomainApplicable(domain)) {
    dispatchSKEvent("front", ["addMapkey", "Omnibar", new_keystroke, old_keystroke]);
  }
}

const userDefinedFunctions: Record<string, (...args: any[]) => void> = {};
function mapkey(keys: string, annotation: string | string[], jscode: any, options?: any) {
  if (!options || _isDomainApplicable(options.domain)) {
    const opt = options || {};
    userDefinedFunctions[`normal:${keys}`] = jscode;
    opt.codeHasParameter = jscode.length;
    dispatchSKEvent("api", ["mapkey", keys, annotation, opt]);
  }
}
function imapkey(keys: string, annotation: string | string[], jscode: any, options?: any) {
  if (!options || _isDomainApplicable(options.domain)) {
    userDefinedFunctions[`insert:${keys}`] = jscode;
    dispatchSKEvent("api", ["imapkey", keys, annotation, options]);
  }
}
function vmapkey(keys: string, annotation: string | string[], jscode: any, options?: any) {
  if (!options || _isDomainApplicable(options.domain)) {
    userDefinedFunctions[`visual:${keys}`] = jscode;
    dispatchSKEvent("api", ["vmapkey", keys, annotation, options]);
  }
}

const userDefinedCommands: Record<string, (...args: any[]) => void> = {};
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

const functionsToListSuggestions: Record<string, (...args: any[]) => any> = {};

let inlineQuery: any;
let hintsFunction: any;
let onClipboardReadFn: (resp: any) => void;
let userScriptTask: () => void = () => {};
let hintsCreationResolve: ((found: number) => void) | null;
initSKFunctionListener(
  "user",
  {
    callUserFunction: (keys: string, para: any) => {
      if (Object.prototype.hasOwnProperty.call(userDefinedFunctions, keys)) {
        const fn = userDefinedFunctions[keys];
        if (fn) {
          fn(para);
        }
      }
    },
    executeUserCommand: (name: string, args: any[]) => {
      if (Object.prototype.hasOwnProperty.call(userDefinedCommands, name)) {
        const cmd = userDefinedCommands[name];
        if (cmd) {
          cmd(...args);
        }
      }
    },
    getSearchSuggestions: async (url: string, response: any, request: any, callbackId: string) => {
      if (Object.prototype.hasOwnProperty.call(functionsToListSuggestions, url)) {
        const fn = functionsToListSuggestions[url];
        if (!fn) return;
        try {
          const ret = await fn(response, request);
          dispatchSKEvent("front", [callbackId, ret]);
        } catch (e) {
          console.error("Search suggestion callback error:", e);
          dispatchSKEvent("front", [callbackId, []]);
        }
      }
    },
    performInlineQuery: (query: string, callbackId: string) => {
      const url =
        typeof inlineQuery.url === "function" ? inlineQuery.url(query) : inlineQuery.url + query;
      httpRequest(
        {
          url,
          headers: inlineQuery.headers,
        },
        (res: any) => {
          if (res.error) {
            dispatchSKEvent("front", [callbackId, `${res.error} on ${url}`]);
          } else {
            dispatchSKEvent("front", [callbackId, inlineQuery.parseResult(res)]);
          }
        },
      );
    },
    runUserScript: () => {
      userScriptTask();
    },
    onClipboardRead: (resp: any) => {
      onClipboardReadFn(resp);
    },
    onHintClicked: (shiftKey: boolean, element: any) => {
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
  callback_to_parse_suggestion?: any,
  only_this_site_key?: string,
  options?: any,
) {
  if (![...alias].every((c) => c.charCodeAt(0) <= 0x7f)) {
    throw `Invalid alias ${alias}, which must be ASCII characters.`;
  }
  functionsToListSuggestions[suggestion_url!] = callback_to_parse_suggestion;
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

function createCssSelectorForElements(cssSelector: string, elements: any): number {
  if (elements instanceof HTMLElement) {
    elements = [elements];
  } else if (elements instanceof Array) {
    elements = elements.filter((m) => m instanceof HTMLElement);
  } else {
    elements = [];
  }
  elements.forEach((m: HTMLElement) => {
    m.classList.add(cssSelector);
  });
  return elements.length;
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
    read: (cb: (resp: any) => void) => {
      onClipboardReadFn = cb;
      dispatchSKEvent("api", ["clipboard:read"]);
    },
  },
  Hints: {
    click: (links: any, force?: boolean) => {
      if (typeof links !== "string") {
        const hintsClicking = "surfingkeys--hints--clicking";
        if (createCssSelectorForElements(hintsClicking, links) === 0) {
          return;
        }
        links = `.${hintsClicking}`;
      }
      dispatchSKEvent("api", ["hints:click", links, force]);
    },
    create: (cssSelector: any, onHintKey: any, attrs?: any) => {
      if (typeof cssSelector !== "string") {
        const hintsCreating = "surfingkeys--hints--creating";
        if (createCssSelectorForElements(hintsCreating, cssSelector) === 0) {
          return false;
        }
        cssSelector = `.${hintsCreating}`;
      }
      hintsFunction = onHintKey;
      const promise = new Promise<number>((resolve) => {
        hintsCreationResolve = resolve;
      });
      dispatchSKEvent("api", ["hints:create", cssSelector, "user", attrs]);
      return promise;
    },
    dispatchMouseClick: (element: any) => {
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
    registerInlineQuery: (args: any) => {
      inlineQuery = args;
      dispatchSKEvent("api", ["front:registerInlineQuery"]);
    },
    openOmnibar: (args: any) => {
      dispatchSKEvent("api", ["front:openOmnibar", args]);
    },
    showBanner,
    showPopup,
  },
};

export default (extensionRootUrl: string, uf: (api: any, settings: any) => void) => {
  EXTENSION_ROOT_URL = extensionRootUrl;
  if (isInUIFrame()) return;
  userScriptTask = () => {
    const settings = {};
    let error = "";
    try {
      uf(api, settings);
    } catch (e) {
      error = String(e);
    }
    applyUserSettings({ settings, error });
  };
  if (window === top) {
    userScriptTask();
  }
};
