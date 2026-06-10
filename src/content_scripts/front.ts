import * as v from "valibot";

import { reportOnFail } from "../common/result";
import { markSurfingKeysElement } from "./common/domFlags";
import Mode from "./common/mode";
import { reportError } from "./common/report";
import { RUNTIME, dispatchSKEvent, runtime } from "./common/runtime";
import type Trie from "./common/trie";
import {
  createElementWithContent,
  generateQuickGuid,
  getAnnotations,
  getBrowserName,
  getDocumentOrigin,
  initSKFunctionListener,
  isInUIFrame,
  regExpReplacer,
  requireElement,
  tabOpenLink,
} from "./common/utils";
import createUiHost from "./uiframe";
import type { UiHost } from "./uiframe";

// Any page can postMessage to this window, so the inbound envelope is external
// data; validate its shape before dispatching. looseObject preserves unknown
// keys so each message reaches its handler (typed `any`) with all fields intact.
const frontMessageSchema = v.looseObject({
  action: v.optional(v.string()),
  id: v.optional(v.union([v.string(), v.number()])),
  query: v.optional(v.string()),
  type: v.optional(v.string()),
  pos: v.optional(v.unknown()),
  result: v.optional(v.unknown()),
  ack: v.optional(v.unknown()),
  origin: v.optional(v.string()),
});
const frontMessageEnvelopeSchema = v.looseObject({
  surfingkeys_content_data: v.optional(frontMessageSchema),
  dictorium_data: v.optional(frontMessageSchema),
});

type InsertLike = { mappings: Trie; enableEmojiInsertion(): void };
type NormalLike = {
  mappings: Trie;
  getLurkMode(): { mappings: Trie } | undefined;
  repeats?: string;
};
type VisualLike = {
  mappings: Trie;
  findSentenceOf(q: string): string;
  visualUpdate(q: string): void;
  visualClear(): void;
  visualEnter(q: string): void;
  emptySelection(): void;
};
type BrowserLike = {
  getBackFocusFromFrontend?: () => void;
  focusFrontend?: (ifr: HTMLIFrameElement) => void;
};

/** The anchor rectangle an inline-query bubble is positioned against. */
type QueryPos = { top: number; left: number; height: number; width: number };

/** A user-registered search-suggestion parser: turns a raw response into suggestion rows. */
type ListSuggestionFn = (response: unknown, opts: { url: string; query: string }) => unknown;

function createFront(
  insert: InsertLike,
  normal: NormalLike,
  _hints: unknown,
  visual: VisualLike,
  browser: BrowserLike,
) {
  // Structural self: the dynamic front stub is built up with dozens of expando methods across this
  // factory and consumed untyped across the postMessage boundary; typing it needs a full rewrite.
  // eslint-disable-next-line typescript/no-explicit-any
  const self: any = {};

  const _uiUserSettings: Record<string, unknown>[] = [];
  function applyUserSettings() {
    for (const cmd of _uiUserSettings) {
      self.command(cmd);
    }
  }

  let frontendPromise: Promise<UiHost> | undefined;

  function newFrontEnd() {
    frontendPromise = new Promise<UiHost>((resolve) => {
      createUiHost(browser, (res) => {
        resolve(res);
        applyUserSettings();
      });
    });
  }

  const _callbacks: Record<string, (msg: unknown) => unknown> = {};
  self.command = (args: Record<string, unknown>, successById?: (msg: unknown) => unknown) => {
    args["toFrontend"] = true;
    args["origin"] = getDocumentOrigin();
    const id = generateQuickGuid();
    args["id"] = id;
    if (successById) {
      args["ack"] = true;
      _callbacks[id] = successById;
    }
    if (window !== top) {
      runtime.postTopMessage({ surfingkeys_uihost_data: args });
    } else {
      if (!frontendPromise) {
        // no need to create frontend iframe if the action is to hide key stroke
        // and frontend UI must be created after document.body is ready(#2132)
        if (args["action"] === "hideKeystroke" || document.body === null) {
          return;
        }
        newFrontEnd();
      }
      frontendPromise?.then(() => {
        runtime.postTopMessage({ surfingkeys_uihost_data: args });
      });
    }
  };

  function applyUICommand(cmd: Record<string, unknown>) {
    _uiUserSettings.push(cmd);
    if (frontendPromise) {
      frontendPromise.then(() => {
        self.command(cmd);
      });
    }
  }

  const _listSuggestions: Record<string, ListSuggestionFn> = {};
  self.addSearchAlias = (
    alias: string,
    prompt: string,
    url: string,
    suggestionURL?: string,
    listSuggestion?: ListSuggestionFn,
    options?: Record<string, unknown>,
  ) => {
    if (suggestionURL && listSuggestion) {
      _listSuggestions[suggestionURL] = listSuggestion;
    }
    applyUICommand({
      action: "addSearchAlias",
      alias: alias,
      prompt: prompt,
      url: url,
      suggestionURL: suggestionURL,
      options: options,
    });
  };
  self.removeSearchAlias = (alias: string) => {
    applyUICommand({
      action: "removeSearchAlias",
      alias: alias,
    });
  };
  self.setHintsCharacters = (chars: string) => {
    applyUICommand({
      action: "setHintsCharacters",
      characters: chars,
    });
  };

  // Dispatch registry: handlers are stored with their own concrete message types then invoked with a
  // parsed message; an `unknown` parameter would reject those typed handlers (contravariance).
  // eslint-disable-next-line typescript/no-explicit-any
  const _actions: Record<string, (message: any) => any> = {};
  let skCallbacks: Record<string, (res: unknown) => void> = {};

  self.performInlineQueryOnSelection = (word: string) => {
    const b = document.getSelection()!.getRangeAt(0).getClientRects()[0];
    self.performInlineQuery(word, b, (pos: QueryPos, queryResult: unknown) => {
      if (queryResult) {
        dispatchSKEvent("front", [
          "showBubble",
          {
            top: pos.top,
            left: pos.left,
            height: pos.height,
            width: pos.width,
          },
          queryResult,
          false,
        ]);
      }
    });
  };
  function querySelectedWord() {
    const selection = document.getSelection()!;
    const word = selection.toString().trim();
    if (word && !/[\W_]/.test(word) && word.length && selection.type === "Range") {
      self.performInlineQueryOnSelection(word);
    }
  }

  _actions["updateInlineQuery"] = (message: unknown) => {
    const { word } = v.parse(v.object({ word: v.optional(v.string()) }), message);
    if (word) {
      self.performInlineQueryOnSelection(word);
    } else {
      querySelectedWord();
    }
  };

  _actions["getSearchSuggestions"] = (message: {
    url: string;
    response: unknown;
    requestUrl: string;
    query: string;
  }) => {
    let ret = null;
    if (Object.hasOwn(_listSuggestions, message.url)) {
      const listSuggestion = _listSuggestions[message.url];
      if (typeof listSuggestion === "function") {
        ret = listSuggestion(message.response, {
          url: message.requestUrl,
          query: message.query,
        });
      } else {
        ret = new Promise((resolve) => {
          const callbackId = generateQuickGuid();
          skCallbacks[callbackId] = (res) => {
            resolve(res);
          };

          dispatchSKEvent("user", [
            "getSearchSuggestions",
            message.url,
            message.response,
            {
              url: message.requestUrl,
              query: message.query,
            },
            callbackId,
          ]);
        });
      }
    }
    return ret;
  };

  self.executeCommand = (cmd: string) => {
    self.command({
      action: "executeCommand",
      cmdline: cmd,
    });
  };

  const frameElement = createElementWithContent("div", "Hi, I'm here now!", {
    id: "sk_frame",
  });
  markSurfingKeysElement(frameElement);
  function highlightElement(sn: {
    rect: { top: number; left: number; width: number; height: number };
    duration?: number;
  }) {
    document.documentElement.append(frameElement);
    const rect = sn.rect;
    frameElement.style.top = rect.top + "px";
    frameElement.style.left = rect.left + "px";
    frameElement.style.width = rect.width + "px";
    frameElement.style.height = rect.height + "px";
    frameElement.style.display = "";
    setTimeout(() => {
      frameElement.remove();
    }, sn.duration);
  }

  function getAllAnnotations() {
    const mappings: Trie[] = [normal.mappings, visual.mappings, insert.mappings];
    const lurk = normal.getLurkMode();
    if (lurk) {
      mappings.unshift(lurk.mappings);
    }
    return mappings.map(getAnnotations).flat();
  }

  self.showUsage = () => {
    self.command({
      action: "showUsage",
      metas: getAllAnnotations(),
    });
  };

  self.getUsage = (cb: (data: unknown) => void) => {
    self.command(
      {
        action: "getUsage",
        metas: getAllAnnotations(),
      },
      (response: { data: unknown }) => {
        cb(response.data);
      },
    );
  };

  function hidePopup() {
    self.command({
      action: "hidePopup",
    });
  }

  self.chooseTab = () => {
    if (normal.repeats !== "") {
      reportOnFail(RUNTIME("focusTabByIndex"), reportError);
    } else {
      self.command({
        action: "chooseTab",
      });
    }
  };

  /**
   * Open the omnibar.
   *
   * @param {object} args `type` the sub type for the omnibar, which can be `Bookmarks`,
   *   `AddBookmark`, `History`, `URLs`, `RecentlyClosed`, `TabURLs`, `Tabs`, `Windows`, `VIMarks`,
   *   `SearchEngine`, `Commands`, `OmniQuery` and `UserURLs`.
   * @name Front.openOmnibar
   */
  self.openOmnibar = (args: Record<string, unknown>) => {
    args["action"] = "openOmnibar";
    self.command(args);
  };

  let _inlineQuery = false;
  // Called as both (result) and (pos, result) across the messaging paths.
  let _showQueryResult: ((...args: unknown[]) => void) | undefined;
  self.performInlineQuery = (
    query: string,
    pos: QueryPos,
    showQueryResult: (pos: QueryPos, res: unknown) => void,
  ) => {
    if (document.dictEnabled != null) {
      if (window.location.href.startsWith("chrome://dictorium-query/")) {
        if (window === top) {
          window.location.href = `chrome://dictorium-query/${query}`;
        } else {
          window.postMessage(
            {
              dictorium_data: { type: "DictoriumReload", word: query },
            },
            window.location.origin,
          );
        }
      } else {
        window.postMessage(
          {
            dictorium_data: {
              type: "OpenDictoriumQuery",
              word: query,
              sentence: "",
              pos: pos,
              source: window.location.href,
            },
          },
          window.location.origin,
        );
      }
      hidePopup();
    } else if (_inlineQuery) {
      query = query.toLocaleLowerCase();
      reportOnFail(RUNTIME("updateInputHistory", { OmniQuery: query }), reportError);

      const callbackId = generateQuickGuid();
      skCallbacks[callbackId] = (res) => {
        showQueryResult(pos, res);
      };
      dispatchSKEvent("user", ["performInlineQuery", query, callbackId]);
    } else if (isInUIFrame()) {
      _showQueryResult = (result) => {
        showQueryResult(pos, result);
      };
      requireElement<HTMLIFrameElement>("#proxyFrame").contentWindow!.postMessage(
        {
          surfingkeys_content_data: {
            action: "performInlineQuery",
            pos: pos,
            query: query,
          },
        },
        "*",
      );
    } else {
      tabOpenLink("https://github.com/brookhong/Surfingkeys/wiki/Register-inline-query");
      hidePopup();
    }
  };

  /**
   * Register an inline query.
   *
   * @param {object} args `url`: string or function, the dictionary service url or a function to
   *   return the dictionary service url, `parseResult`: function, a function to parse result from
   *   dictionary service and return a HTML string to render explanation, `headers`:
   *   object[optional], in case your dictionary service needs authentication.
   * @name Front.registerInlineQuery
   */
  self.registerInlineQuery = () => {
    _inlineQuery = true;
  };
  self.openOmniquery = (args: { query?: string; style?: string }) => {
    self.openOmnibar({ type: "OmniQuery", extra: args.query, style: args.style });
  };

  const _keyHints: {
    accumulated: string;
    candidates: Record<string, { annotation?: string | string[] | undefined }>;
    key: string;
  } = {
    accumulated: "",
    candidates: {},
    key: "",
  };

  self.showStatus = (msgs: unknown, duration?: number) => {
    // when showModeStatus is on, showStatus will cause uiHost injected too early
    // which could break some host scripts from sites in Firefox.
    const waitForHostScripts = getBrowserName() === "Firefox" ? 1000 : 0;
    setTimeout(() => {
      self.command({
        action: "showStatus",
        contents: msgs,
        duration: duration,
      });
    }, waitForHostScripts);
  };
  self.toggleStatus = (visible: boolean) => {
    self.command({
      action: "toggleStatus",
      visible: visible,
    });
  };

  let onDialogResponseOk: (() => void) | null = null;
  _actions["dialogResponse"] = (message: unknown) => {
    const { result } = v.parse(v.object({ result: v.optional(v.string()) }), message);
    if (result === "Ok" && onDialogResponseOk) {
      onDialogResponseOk();
    } else {
      onDialogResponseOk = null;
    }
  };

  skCallbacks = initSKFunctionListener("front", {
    showPopup: (content: string) => {
      self.command({
        action: "showPopup",
        content,
      });
    },
    showDialog: (question: string, onOk: () => void) => {
      self.command({
        action: "showDialog",
        question,
      });
      onDialogResponseOk = onOk;
    },
    applySettingsFromSnippets: (us: Record<string, unknown>) => {
      applyUICommand({
        action: "applyUserSettings",
        userSettings: us,
      });
      const cloneUS: Record<string, unknown> = JSON.parse(JSON.stringify(us, regExpReplacer));
      const conf: Record<string, unknown> = runtime.conf;
      // overrides local settings from snippets
      for (const k in cloneUS) {
        if (Object.hasOwn(runtime.conf, k)) {
          conf[k] = cloneUS[k];
          delete cloneUS[k];
        }
      }
      if (runtime.conf.enableEmojiInsertion) {
        insert.enableEmojiInsertion();
      }
      if (Object.keys(cloneUS).length > 0 && window === top) {
        // left settings are for background, need not broadcast the update, neither persist into storage
        reportOnFail(
          RUNTIME("updateSettings", {
            scope: "snippets",
            settings: cloneUS,
          }),
          reportError,
        );
      }
      dispatchSKEvent("settingsFromSnippetsLoaded");
    },
    querySelectedWord,
    addMapkey: (mode: string, new_keystroke: string, old_keystroke: string) => {
      applyUICommand({
        action: "addMapkey",
        mode: mode,
        new_keystroke: new_keystroke,
        old_keystroke: old_keystroke,
      });
    },
    addVimMap: (lhs: string, rhs: string, ctx: unknown) => {
      applyUICommand({
        action: "addVimMap",
        lhs: lhs,
        rhs: rhs,
        ctx: ctx,
      });
    },
    addVimKeyMap: (vimKeyMap: unknown) => {
      applyUICommand({
        action: "addVimKeyMap",
        vimKeyMap,
      });
    },
    addCommand: (name: string, description: string) => {
      applyUICommand({
        action: "addCommand",
        name: name,
        description: description,
      });
    },
    highlightElement,
    hidePopup,
    openFinder: () => {
      self.command({
        action: "openFinder",
      });
    },
    showBanner: (msg: string, linger_time?: number) => {
      self.command({
        action: "showBanner",
        content: msg,
        linger_time: linger_time,
      });
    },
    showBubble: (
      pos: QueryPos & { winWidth?: number; winHeight?: number; winX?: number; winY?: number },
      msg: string,
      noPointerEvents: boolean,
    ) => {
      if (msg.length > 0) {
        pos.winWidth = window.innerWidth;
        pos.winHeight = window.innerHeight;
        pos.winX = 0;
        pos.winY = 0;
        if (window.frameElement) {
          pos.winX = (window.frameElement as HTMLElement).offsetLeft;
          pos.winY = (window.frameElement as HTMLElement).offsetTop;
        }
        self.command({
          action: "showBubble",
          content: msg,
          position: pos,
          noPointerEvents: noPointerEvents,
        });
      }
    },
    hideBubble: () => {
      self.command({
        action: "hideBubble",
      });
    },
    hideKeystroke: () => {
      _keyHints.accumulated = "";
      _keyHints.candidates = {};
      self.command({
        action: "hideKeystroke",
      });
    },
    showKeystroke: (key: string, mode: { mappings: Trie }) => {
      _keyHints.accumulated += key;
      _keyHints.key = key;
      _keyHints.candidates = {};

      const root = mode.mappings.find(_keyHints.accumulated);
      if (root) {
        root
          .getMetas(() => true)
          .forEach((m) => {
            _keyHints.candidates[m.word] = {
              annotation: m.annotation,
            };
          });
      }

      self.command({
        action: "showKeystroke",
        keyHints: _keyHints,
      });
    },
    openOmnibar: self.openOmnibar,
    showStatus: self.showStatus,
    toggleStatus: self.toggleStatus,
  });

  _actions["omnibar_query_entered"] = (response: { query: string }) => {
    reportOnFail(RUNTIME("updateInputHistory", { OmniQuery: response.query }), reportError);
    self.performInlineQuery(
      response.query,
      {
        top: 0,
        left: 80,
        height: 0,
        width: 100,
      },
      (_pos: QueryPos, queryResult: unknown) => {
        const words: unknown[] = Array.isArray(queryResult) ? queryResult : [queryResult];
        if (getBrowserName() === "Chrome") {
          const sentence = visual.findSentenceOf(response.query);
          if (sentence.length > 0) {
            words.push(sentence);
          }
        }

        self.command({
          action: "updateOmnibarResult",
          words: words,
        });
      },
    );
  };

  _actions["getBackFocus"] = () => {
    window.focus();
    if (window === top && frontendPromise) {
      frontendPromise.then((uiHost) => {
        const active = document.activeElement;
        if (uiHost.shadowRoot?.contains(active) && active instanceof HTMLElement) {
          // fix for Firefox, blur from iframe for frontend after Omnibar closed.
          active.blur();
        }
      });
    }
  };

  _actions["getPageText"] = () => {
    return document.body.innerText;
  };

  let _pendingQuery: ReturnType<typeof setTimeout> | undefined;
  function clearPendingQuery() {
    if (_pendingQuery) {
      clearTimeout(_pendingQuery);
      _pendingQuery = undefined;
    }
  }

  _actions["visualUpdate"] = (message: { query: string }) => {
    clearPendingQuery();
    _pendingQuery = setTimeout(() => {
      visual.visualUpdate(message.query);
      self.command({
        action: "visualUpdated",
      });
    }, 500);
  };

  _actions["visualClear"] = () => {
    clearPendingQuery();
    visual.visualClear();
  };

  _actions["visualEnter"] = (message: { query: string }) => {
    clearPendingQuery();
    visual.visualEnter(message.query);
  };

  _actions["emptySelection"] = () => {
    visual.emptySelection();
  };

  _actions["executeUserCommand"] = (message: { name: string; args: unknown }) => {
    dispatchSKEvent("user", ["executeUserCommand", message.name, message.args]);
  };

  let _active = window === top;
  _actions["deactivated"] = () => {
    _active = false;
  };

  _actions["activated"] = () => {
    _active = true;
  };

  runtime.on("focusFrame", (msg) => {
    if (msg.frameId === window.frameId) {
      window.focus();
      document.body.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "center",
      });
      highlightElement({
        duration: 500,
        rect: {
          top: 0,
          left: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        },
      });
    }
  });

  window.addEventListener(
    "message",
    (event) => {
      const parsed = v.safeParse(frontMessageEnvelopeSchema, event.data);
      if (!parsed.success) {
        return;
      }
      const _message = parsed.output.surfingkeys_content_data ?? parsed.output.dictorium_data;
      if (_message == null) {
        return;
      }
      if (_message.action === "performInlineQuery") {
        self.performInlineQuery(
          _message.query ?? "",
          _message.pos,
          (pos: QueryPos, queryResult: unknown) => {
            (event.source as Window).postMessage(
              {
                surfingkeys_content_data: {
                  action: "performInlineQueryResult",
                  pos: pos,
                  result: queryResult,
                },
              },
              event.origin,
            );
          },
        );
      } else if (_message.action === "performInlineQueryResult") {
        _showQueryResult!(_message.pos, _message.result);
      } else if (_message.action === "frontendDestroyed") {
        frontendPromise = undefined;
      } else if (_active) {
        const id = _message.id;
        const f = id == null ? undefined : _callbacks[id];
        if (f) {
          // returns true to make callback stay for coming response.
          if (!f(_message) && id != null) {
            delete _callbacks[id];
          }
        } else if (_message.action && Object.hasOwn(_actions, _message.action)) {
          const action = _actions[_message.action];
          let ret = action ? action(_message) : undefined;
          if (_message.ack && ret) {
            if (!ret.then) {
              ret = Promise.resolve(ret);
            }
            ret.then((data: unknown) =>
              runtime.postTopMessage({
                surfingkeys_uihost_data: {
                  data,
                  toFrontend: true,
                  origin: _message.origin,
                  id: _message.id,
                },
              }),
            );
          }
        }
      } else if (_message.action === "activated") {
        const activated = _actions["activated"];
        if (activated) {
          activated(_message);
        }
      } else if (_message.type === "DictoriumViewReady") {
        // make inline query also work on dictorium frame continuously
        const activated = _actions["activated"];
        if (activated) {
          activated(_message);
        }
      }
      if (!parsed.output.dictorium_data) {
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  let uiHostDetaching: ReturnType<typeof setTimeout> | undefined;
  self.attach = () => {
    if (uiHostDetaching) {
      clearTimeout(uiHostDetaching);
      uiHostDetaching = undefined;
    }
    if (!frontendPromise) {
      newFrontEnd();
    }
    Mode.showStatus();
  };

  self.detach = () => {
    if (frontendPromise) {
      frontendPromise.then((uiHost) => {
        uiHostDetaching = setTimeout(() => {
          uiHost.tryDetach();
        }, 3000);
      });
    }
  };

  return self;
}

export default createFront;
