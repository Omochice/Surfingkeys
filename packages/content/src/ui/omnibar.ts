import { Result } from "@praha/byethrow";
import { attachFaviconToImgSrc } from "@sk/adapter/platform-utils";
import { decodeError, reportOnFail, unwrapOr } from "@sk/common/result";
import { filterByTitleOrUrl, regexFromString } from "@sk/common/utils";
import { debounce } from "@sk/core/debounce";
import type { DebouncedFunction } from "@sk/core/debounce";
import KeyboardUtils from "@sk/core/keyboardUtils";
import { createKeymap } from "@sk/core/keymap";
import { ModeHandle } from "@sk/core/mode";
import { reportError } from "@sk/core/report";
import { isSpecialKeyOf } from "@sk/core/specialKeys";
import Trie from "@sk/core/trie";
import {
  constructSearchURL,
  createElementWithContent,
  getBrowserName,
  htmlEncode,
  parseAnnotation,
  requireElement,
  scrollIntoViewIfNeeded,
  showBanner,
  toggleQuote,
  timeStampString,
  tryDecodeURI,
  tryDecodeURIComponent,
} from "@sk/core/utils";
import { RUNTIME, runtime } from "@sk/messaging/runtime";
import { createEffect, createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";

import { parseCommandLine } from "./commandLine";
import { Prompt } from "./components/Prompt";
import type { PromptValue } from "./components/Prompt";
import { ResultList } from "./components/ResultList";
import { ResultPage } from "./components/ResultPage";
import { SearchInput } from "./components/SearchInput";
import { buildFolderResult, buildOmnibarResult, orderItemsForDisplay } from "./omnibarResult";
import type { OmnibarResult } from "./omnibarResult";

/** A bookmark folder row as returned by the background `getBookmarkFolders`/`listBookmarkFolders`. */
type BookmarkFolder = { id: string; title?: string };

/** A configured search engine alias. */
type SearchAlias = { prompt: PromptValue; url: string; suggestionURL: string };

/** A tab row as returned by the background `getTabs`; only title/url are read by the omnibar. */
type TabItem = { title?: string; url?: string };

/** A window row as returned by the background `getWindows`. */
type WindowItem = { id: string; isPreviousChoice?: boolean; tabs: TabItem[] };

/** A history row as returned by the history query functions feeding OpenURLs. */
type HistoryItem = { title?: string; url?: string; visitCount?: number; lastVisitTime?: number };

/**
 * The broad shape `createURLItem`/`listURLs` accept: a bookmark, history entry, tab or folder row.
 * Every field is optional because the source determines which are present; the renderer branches on
 * `Object.hasOwn` to decide the row type.
 */
type URLItem = {
  title?: string;
  url?: string;
  uid?: string;
  id?: string | number;
  parentId?: string | number;
  lastVisitTime?: number;
  visitCount?: number;
  dateAdded?: number;
  windowId?: number;
  width?: number;
  favIconUrl?: string;
  type?: string;
  html?: string;
};

/** A search-engine suggestion: a raw-HTML row, a URL row, or a bare query string. */
type SearchSuggestion = string | { html: string } | { url: string };

/** A registered `:`-command: its callback plus the help metadata parseAnnotation derives. */
type CommandMeta = {
  code: (args: string[]) => void;
  feature_group?: number | undefined;
  annotation?: string | string[] | undefined;
};

/**
 * A per-type omnibar handler (OpenBookmarks, OpenTabs, SearchEngine, …). Every hook is optional —
 * the controller probes each before calling — and handlers carry their own extra state on top of
 * this shared shape. `activeTab`/`tabbed` are written by the controller right before `onEnter`.
 */
type OmnibarHandler = {
  prompt?: PromptValue | undefined;
  focusFirstCandidate?: boolean;
  omnibarPosition?: "top" | "middle" | "bottom";
  activeTab?: boolean;
  tabbed?: boolean;
  // Method syntax (rather than arrow properties) so a handler may declare a narrower onOpen extra or
  // onKeydown event than the controller's call site; the registry is intentionally bivariant here.
  onOpen?(extra?: unknown): void;
  onClose?(): void;
  onInput?(): void;
  onEnter?(): boolean | undefined;
  onKeydown?(event: KeyboardEvent): boolean;
  onReset?(): void;
  onTabKey?(): void;
  getResults?(): void;
  rotateInput?(backward: boolean): void;
};

/** The SearchEngine handler additionally exposes its alias registry and the active alias' urls. */
type SearchEngineHandler = OmnibarHandler & {
  aliases: Record<string, SearchAlias>;
  url?: string | undefined;
  suggestionURL?: string | undefined;
};

/**
 * OpenBookmarks tracks the folder breadcrumb it descended through and a typed getBookmarks
 * callback.
 */
type OpenBookmarksHandler = OmnibarHandler & {
  inFolder: {
    prompt?: PromptValue | undefined;
    folderId?: string | undefined;
    focused: number;
  }[];
  onResponse?(response: { bookmarks: { url?: string }[] }): void;
};

/** The bookmark page AddBookmark builds up before creating the bookmark. */
type BookmarkPage = {
  url?: string | undefined;
  title?: string | undefined;
  folder?: string | undefined;
  path?: string[] | undefined;
};

/** AddBookmark carries the page being edited. */
type AddBookmarkHandler = OmnibarHandler & { page?: BookmarkPage };

/** OpenURLs debounces its onInput, so it keeps the cancelable variant. */
type OpenURLsHandler = OmnibarHandler & { onInput?: DebouncedFunction };

/**
 * The omnibar API surface the per-type handlers drive (a subset of the controller `self`). Handlers
 * receive this as their `omnibar` argument. `cachedPromise` is a shared slot the controller clears
 * on close; each handler resolves it with its own type and reads it back through a local typed
 * promise.
 */
type Omnibar = {
  input: HTMLInputElement;
  resultsDiv: HTMLElement;
  cachedPromise?: Promise<unknown>;
  command?: (cmd: string, annotation: string, jscode: (args: string[]) => void) => void;
  results: () => OmnibarResult[];
  focusedIndex: () => number;
  focusedResult: () => OmnibarResult | undefined;
  focusItem: (index: number) => void;
  setPrompt: (val: PromptValue) => void;
  setQuery: (val: string) => void;
  setPlaceholder: (val: string) => void;
  triggerInput: () => void;
  getItems: () => unknown;
  getHistoryCacheSize: () => number;
  highlight: (rxp: RegExp | null, str: string) => string;
  createURLItem: (b: URLItem, rxp: RegExp | null) => OmnibarResult;
  createItemFromRawHtml: (arg: {
    html: string;
    props?: Partial<OmnibarResult["data"]>;
  }) => OmnibarResult;
  detectAndInsertURLItem: (
    str: string,
    toList: (string | { title?: string; url?: string; html?: string })[],
  ) => void;
  listURLs: (items: readonly URLItem[], showFolder: boolean) => void;
  listResults: <T>(
    items: readonly T[] | null | undefined,
    renderItem: (b: T) => OmnibarResult | null | undefined,
  ) => void;
  listWords: (words: string[]) => void;
  listBookmarkFolders: (
    cb?: (
      response: { folders: { id: string; title?: string }[] },
      folders: Record<string, { id: string; title?: string }>,
    ) => void,
  ) => void;
  openFocused: (handler: OmnibarHandler) => boolean | undefined;
};

/**
 * The slice of the front the omnibar talks to. `actions` is assignment-only here (the front
 * dispatches them), so a `never` parameter accepts handlers of any message shape without `any`;
 * contentCommand is generic over its response so each caller types its own callback. It is declared
 * as a method so its callback parameter is checked bivariantly, which lets the front's
 * unknown-typed implementation satisfy it.
 */
type OmnibarFront = {
  hidePopup: () => void;
  openOmnibar: (args: OmnibarShowArgs) => void;
  postMessage: (msg: Record<string, unknown>) => void;
  topOrigin: string;
  actions: Record<string, (message: never) => void>;
  contentCommand<R = unknown>(args: Record<string, unknown>, successById?: (msg: R) => void): void;
};

/** The open spec the front passes through `ui.onShow`: which handler to use plus its open options. */
type OmnibarShowArgs = {
  type: string;
  tabbed?: boolean;
  pref?: string;
  extra?: unknown;
};

/** The omnibar root element, carrying the onShow/onHide expandos the front drives it through. */
type OmnibarElement = HTMLElement & {
  onShow: (args: OmnibarShowArgs) => void;
  onHide: () => void;
};

/**
 * The full omnibar controller. It wraps a private {@link ModeHandle} rather than being one, exposing
 * the handler-facing {@link Omnibar} surface plus the members the front and the command registry
 * reach. `name` / `mappings` feed the frontend modes registry; the handle's stack-push and event
 * dispatch stay internal to createOmnibar.
 */
type OmnibarMode = Omnibar & {
  name: string;
  mappings: Trie;
  expandAlias(alias: string, val: string): boolean;
  collapseAlias(): boolean;
  getPageSize(): number;
  html(content: string): void;
  isUrl(input: string): boolean | RegExpMatchArray | null;
  addHandler(name: string, hdl: OmnibarHandler): void;
};

function createOmnibar(front: OmnibarFront, clipboard: { write(text: string): void }): OmnibarMode {
  const mode = new ModeHandle("Omnibar");

  mode
    .addEventListener("keydown", (event) => {
      if (event.sk_keyName?.length) {
        keymap.handleKey(event);
      }
      event.sk_suppressed = true;
    })
    .addEventListener("mousedown", (event) => {
      const target = event.target;
      if (!(target instanceof Node) || !ui.contains(target)) {
        front.hidePopup();
      }
      event.sk_suppressed = true;
    });

  const mappings = new Trie();
  const keymap = createKeymap(() => mappings);

  // The result list is a reactive store driven by a Solid <ResultList>; the
  // focused row is an index rather than a `.focused` DOM class, and the
  // per-row data the handlers read lives on the store item, not on the <li>.
  const [results, setResults] = createSignal<OmnibarResult[]>([]);
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [resultPage, setResultPage] = createSignal("");
  const [prompt, setPrompt] = createSignal<PromptValue>("");
  const [query, setQuery] = createSignal("");
  const [inputVisible, setInputVisible] = createSignal(true);
  const [placeholder, setPlaceholder] = createSignal("");
  // Exposed (through the assembled mode below) so the per-type handlers can
  // read the focused row from the store instead of querying the DOM.
  const focusedResult = (): OmnibarResult | undefined => {
    const i = focusedIndex();
    return i >= 0 ? results()[i] : undefined;
  };

  function getPosition() {
    let p = runtime.conf.omnibarPosition;
    if (handler && handler.omnibarPosition) {
      p = handler.omnibarPosition;
    }
    return p;
  }

  let savedFocused = -1;
  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-d>"), {
    annotation: "Delete focused item from bookmark or history",
    feature_group: 8,
    code: function () {
      const fi = focusedResult();
      const idx = focusedIndex();
      if (fi && fi.data.uid) {
        reportOnFail(
          RUNTIME("removeURL", { uid: fi.data.uid }, (ret: { response: string }) => {
            if (ret.response !== "Done") {
              return;
            }
            const remaining = results().slice();
            remaining.splice(idx, 1);
            setResults(remaining);
            const bottom = getPosition() === "bottom";
            const newIdx = bottom ? idx - 1 : idx;
            if (newIdx >= 0 && newIdx < remaining.length) {
              self.focusItem(newIdx);
            } else {
              savedFocused = bottom ? 0 : remaining.length;
              self.triggerInput();
            }
          }),
          reportError,
        );
      }
    },
  });

  function reopen(cb: () => void) {
    front.hidePopup();
    setTimeout(cb, 100);
  }

  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-j>"), {
    annotation: "Toggle Omnibar's position",
    feature_group: 8,
    code: function () {
      const savedInput = self.input.value;
      runtime.conf.omnibarPosition =
        runtime.conf.omnibarPosition === "bottom" ? "middle" : "bottom";
      reopen(() => {
        savedAargs.pref = savedInput;
        front.openOmnibar(savedAargs);
      });
    },
  });

  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-.>"), {
    annotation: "Show results of next page",
    feature_group: 8,
    code: function () {
      if (urlItems) {
        if (start * runtime.conf.omnibarMaxResults < urlItems.length) {
          start++;
        } else {
          start = 1;
        }
        listResultPage();
      }
    },
  });

  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-,>"), {
    annotation: "Show results of previous page",
    feature_group: 8,
    code: function () {
      if (urlItems) {
        if (start > 1) {
          start--;
        } else {
          start = Math.ceil(urlItems.length / runtime.conf.omnibarMaxResults);
        }
        listResultPage();
      }
    },
  });

  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-c>"), {
    annotation: "Copy selected item url or all listed item urls",
    feature_group: 8,
    code: function () {
      // hide Omnibar.input, so that we could use clipboard_holder to make copy
      setInputVisible(false);

      const fi = focusedResult();
      let text;
      if (fi && fi.data.copy) {
        text = fi.data.copy;
      } else if (fi && fi.data.url) {
        text = fi.data.url;
      } else if (pageItems) {
        text = pageItems
          .map((p: { url?: string }) => {
            return p.url;
          })
          .join("\n");
      }
      clipboard.write(text ?? "");

      setInputVisible(true);
    },
  });

  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-D>"), {
    annotation: "Delete all listed items from bookmark or history",
    feature_group: 8,
    code: function () {
      const uids = results()
        .map((r) => r.data.uid)
        .filter((u) => u);
      if (uids.length) {
        reportOnFail(
          RUNTIME("removeURL", { uid: uids }, (ret: { response: string }) => {
            if (ret.response === "Done") {
              if (handler && handler.getResults) {
                handler.getResults();
              }
              self.triggerInput();
            }
          }),
          reportError,
        );
      }
    },
  });

  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-r>"), {
    annotation: "Re-sort history by visitCount or lastVisitTime",
    feature_group: 8,
    code: function () {
      if (handler && handler.onReset) {
        handler.onReset();
      }
    },
  });

  mappings.add(KeyboardUtils.encodeKeystroke("<Esc>"), {
    annotation: "Close Omnibar",
    feature_group: 8,
    code: function () {
      front.hidePopup();
    },
  });

  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-m>"), {
    annotation: "Create vim-like mark for selected item",
    feature_group: 8,
    code: function (mark: string) {
      const fi = focusedResult();
      if (fi) {
        Normal.addVIMark(mark, fi.data.url);
      }
    },
  });

  const handlers: Record<string, OmnibarHandler> = {};
  let bookmarkFolders: Record<string, BookmarkFolder> | null;

  let lastInput = "";
  // Initialised to an empty object so that listResults can safely read
  // handler.focusFirstCandidate before onShow assigns the real handler. The
  // value is always overwritten by ui.onShow before any user-facing operation.
  let handler: OmnibarHandler = {};
  let lastHandler: OmnibarHandler | null = null;
  // Whether Enter should open in a new tab, taken from the open spec on each show.
  let tabbed: boolean = true;
  const ui = requireElement<OmnibarElement>("#sk_omnibar");

  const triggerInput = (): void => {
    onInput();
  };

  let collapsingPoint: string | undefined;
  const expandAlias = (alias: string, val: string): boolean => {
    let eaten = false;
    if (handler !== searchEngine && alias.length && Object.hasOwn(searchEngine.aliases, alias)) {
      lastHandler = handler;
      handler = searchEngine;
      Object.assign(searchEngine, searchEngine.aliases[alias]);
      setResults([]);
      setFocusedIndex(-1);
      setPrompt(handler.prompt ?? "");
      setResultPage("");
      urlItems = null;
      collapsingPoint = val;
      setQuery(val);
      if (val.length) {
        self.triggerInput();
      }
      eaten = true;
    }
    return eaten;
  };

  const collapseAlias = (): boolean => {
    let eaten = false;
    const val = self.input.value;
    if (lastHandler && handler !== lastHandler && (val === collapsingPoint || val === "")) {
      handler = lastHandler;
      lastHandler = null;
      setPrompt(handler.prompt ?? "");
      if (val.length) {
        setQuery(val.slice(0, -1));
      }
      self.triggerInput();
      eaten = true;
    }
    return eaten;
  };

  const focusItem = (index: number): void => {
    if (index >= 0 && index < results().length) {
      setFocusedIndex(index);
    }
  };

  function rotateResult(backward: boolean) {
    const total = results().length;
    if (total > 0) {
      let lastFocused = focusedIndex();
      lastFocused = lastFocused === -1 ? total : lastFocused;
      const toFocus = (backward ? lastFocused + total : lastFocused + total + 2) % (total + 1);
      if (toFocus < total) {
        setFocusedIndex(toFocus);
        handler.onTabKey && handler.onTabKey();
      } else {
        // the slot past the last item returns focus to the typed input
        setFocusedIndex(-1);
        setQuery(lastInput);
      }
    }
  }

  const promptSpan = requireElement("#sk_omnibarSearchArea>span.prompt");
  const resultPageSpan = requireElement("#sk_omnibarSearchArea>span.resultPage");
  const resultsDiv = requireElement("#sk_omnibarSearchResult");

  render(
    () =>
      Prompt({
        get value() {
          return prompt();
        },
      }),
    promptSpan,
  );
  render(
    () =>
      ResultPage({
        get text() {
          return resultPage();
        },
      }),
    resultPageSpan,
  );

  // The search input is created via createRoot so the rendered <input> element
  // can be inserted at the exact position the layout (the `#sk_omnibarSearchArea>input`
  // CSS selector) requires: between span.prompt and span.resultPage. The ref
  // captures the DOM node, exposed below as the mode's `input`, so the
  // controller's imperative ops (focus, selectionStart, setSelectionRange,
  // dispatchEvent) keep working.
  let inputElement: HTMLInputElement | undefined;
  createRoot(() => {
    const inputEl = SearchInput({
      get value() {
        return query();
      },
      get visible() {
        return inputVisible();
      },
      get placeholder() {
        return placeholder();
      },
      onInput: (val: string) => {
        setQuery(val);
        onInput();
      },
      onKeyDown: (evt: KeyboardEvent) => {
        onKeyDown(evt);
      },
      ref: (el: HTMLInputElement) => {
        inputElement = el;
      },
    });
    if (inputEl instanceof Node) {
      ui.querySelector("#sk_omnibarSearchArea")!.insertBefore(inputEl, resultPageSpan);
    }
  });

  function onResultSelect(index: number) {
    const d = results()[index]?.data;
    if (!d) {
      return;
    }
    if (d.url) {
      reportOnFail(
        RUNTIME("openLink", { tab: { tabbed: true, active: true }, url: d.url }),
        reportError,
      );
    } else {
      setQuery(d.query ?? "");
      self.input.focus();
    }
  }
  render(
    () =>
      ResultList({
        get items() {
          return results();
        },
        get focusedIndex() {
          return focusedIndex();
        },
        onSelect: onResultSelect,
      }),
    resultsDiv,
  );
  // Scroll the focused row into view once Solid has applied the focused class.
  createEffect(() => {
    if (focusedIndex() < 0) {
      return;
    }
    const fi = resultsDiv.querySelector<HTMLElement>("li.focused");
    if (fi) {
      const fiRect = fi.getBoundingClientRect();
      const resultsRect = resultsDiv.getBoundingClientRect();
      if (fiRect.top < resultsRect.top || fiRect.bottom > resultsRect.bottom) {
        fi.scrollIntoView(fiRect.top < resultsRect.top);
      }
    }
  });

  function onInput() {
    if (lastInput !== self.input.value) {
      lastInput = self.input.value;
    }
    handler.onInput?.();
  }
  function onKeyDown(evt: KeyboardEvent) {
    if (handler.onKeydown?.(evt)) {
      return;
    }
    if (isSpecialKeyOf("<Esc>", evt.sk_keyName ?? "")) {
      front.hidePopup();
      evt.preventDefault();
    } else if (evt.keyCode === KeyboardUtils.keyCodes["enter"]) {
      handler.activeTab = !evt.ctrlKey;
      handler.tabbed = tabbed !== evt.shiftKey;
      handler.onEnter?.() && front.hidePopup();
    } else if (evt.keyCode === KeyboardUtils.keyCodes["space"]) {
      const cursor = self.input.selectionStart;
      const textBeforeCursor = self.input.value.slice(0, cursor ?? 0);
      const newQuery = self.input.value.slice(cursor ?? 0);
      self.expandAlias(textBeforeCursor, newQuery) && evt.preventDefault();
    } else if (evt.keyCode === KeyboardUtils.keyCodes["backspace"]) {
      self.collapseAlias() && evt.preventDefault();
    }
  }

  mappings.add(KeyboardUtils.encodeKeystroke("<Tab>"), {
    annotation: "Forward cycle through the candidates.",
    feature_group: 8,
    code: function () {
      rotateResult(getPosition() === "bottom");
    },
  });
  mappings.add(KeyboardUtils.encodeKeystroke("<Shift-Tab>"), {
    annotation: "Backward cycle through the candidates.",
    feature_group: 8,
    code: function () {
      rotateResult(getPosition() !== "bottom");
    },
  });
  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-n>"), {
    annotation: "Forward cycle through the input history.",
    feature_group: 8,
    code: function () {
      if (handler && handler.rotateInput) {
        handler.rotateInput(getPosition() === "bottom");
      } else {
        rotateResult(getPosition() === "bottom");
      }
    },
  });
  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-p>"), {
    annotation: "Backward cycle through the input history.",
    feature_group: 8,
    code: function () {
      if (handler && handler.rotateInput) {
        handler.rotateInput(getPosition() !== "bottom");
      } else {
        rotateResult(getPosition() !== "bottom");
      }
    },
  });
  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-'>"), {
    annotation: "Toggle quotes in an input element",
    feature_group: 8,
    code: toggleQuote,
  });

  const highlight = (rxp: RegExp | null, str: string): string => {
    if (str.slice(0, 11) === "data:image/") {
      str = str.slice(0, 1024);
    }
    return rxp === null
      ? str
      : str.replace(rxp, (m) => {
          return "<span class=omnibar_highlight>" + m + "</span>";
        });
  };

  const createURLItem = (b: URLItem, rxp: RegExp | null): OmnibarResult => {
    const url = b.url ?? "";
    const title = b.title && b.title !== "" ? b.title : unwrapOr(tryDecodeURI(url), url);
    let type = "🔥";
    let additional = "";
    let uid = b.uid;
    if (Object.hasOwn(b, "lastVisitTime")) {
      type = "🕜";
      additional = `<span class=omnibar_timestamp># ${timeStampString(b.lastVisitTime ?? 0)}</span>`;
      additional += `<span class=omnibar_visitcount> (${b.visitCount})</span>`;
      uid = "H" + url;
    } else if (Object.hasOwn(b, "dateAdded")) {
      type = "⭐";
      additional = `<span class=omnibar_folder>@ ${bookmarkFolders?.[b.parentId ?? ""]?.title || ""}</span> <span class=omnibar_timestamp># ${timeStampString(b.dateAdded ?? 0)}</span>`;
      uid = "B" + b.id;
    } else if (Object.hasOwn(b, "width")) {
      type = "🔖";
      uid = "T" + b.windowId + ":" + b.id;
      // } else if(b.type && /^\p{Emoji}$/u.test(b.type)) {
    } else if (b.type && b.type.length === 2 && b.type.charCodeAt(0) > 255) {
      type = b.type;
    }
    let li = createElementWithContent("li", `<div class="icon">${type}</div>`);
    if (Object.hasOwn(b, "favIconUrl")) {
      li = createElementWithContent("li", `<img class="icon"/>`);
      const img = li.querySelector("img");
      if (img) {
        attachFaviconToImgSrc(
          b.favIconUrl != null ? { url, favIconUrl: b.favIconUrl } : { url },
          img,
        );
      }
    }
    li.appendChild(
      createElementWithContent(
        "div",
        `<div class="title">${self.highlight(rxp, htmlEncode(title))} ${additional}</div><div class="url">${self.highlight(rxp, htmlEncode(unwrapOr(tryDecodeURIComponent(url), url)))}</div>`,
        { class: "text-container" },
      ),
    );
    return buildOmnibarResult(li, { uid, url: b.url });
  };

  const createItemFromRawHtml = ({
    html,
    props,
  }: {
    html: string;
    props?: Partial<OmnibarResult["data"]>;
  }): OmnibarResult => {
    const li = createElementWithContent("li", html);
    // User suggestion handlers pass their data fields (url, copy, ...) via `props`; route them
    // into the result's data instead of assigning them as expandos on the <li>.
    return buildOmnibarResult(li, typeof props === "object" ? props : {});
  };

  const detectAndInsertURLItem = (
    str: string,
    toList: (string | { title?: string; url?: string; html?: string })[],
  ): void => {
    const urlPat = /^(?:https?:\/\/)?(?:[^@/\n]+@)?(?:www\.)?([^:/\n\s]+)\.([^:/\n\s]+)/i;
    const urlPat1 = /^https?:\/\/(?:[^@/\n]+@)?([^:/\n\s]+)/i;
    if (urlPat.test(str)) {
      let url = str;
      if (!/^https?:\/\//.test(str)) {
        url = "http://" + str;
      }
      toList.unshift({
        title: str,
        url: url,
      });
    } else if (urlPat1.test(str)) {
      toList.unshift({
        title: str,
        url: str,
      });
    }
  };

  let start: number;
  let urlItems: readonly URLItem[] | null;
  let showFolderFlag: boolean;
  let pageItems: URLItem[];

  const getPageSize = (): number => {
    return runtime.conf.omnibarMaxResults;
  };

  const getHistoryCacheSize = (): number => {
    return runtime.conf.omnibarHistoryCacheSize;
  };

  const listURLs = (items: readonly URLItem[], showFolder: boolean): void => {
    start = 1;
    urlItems = items;
    showFolderFlag = showFolder;
    listResultPage();
    if (savedFocused !== -1) {
      self.focusItem(savedFocused);
      savedFocused = -1;
    }
  };
  const getItems = (): readonly URLItem[] | null => {
    return urlItems;
  };

  function listResultPage() {
    if (urlItems == null) {
      return;
    }
    const si = (start - 1) * runtime.conf.omnibarMaxResults;
    let ei = si + runtime.conf.omnibarMaxResults;
    ei = ei > urlItems.length ? urlItems.length : ei;
    let total: number | string = urlItems.length;
    if (total === runtime.conf.omnibarHistoryCacheSize) {
      total = total + "+";
    }
    setResultPage(`${si + 1} - ${ei} / ${total}`);
    pageItems = urlItems.slice(si, ei);
    const query = self.input.value.trim();
    let rxp: RegExp | null = null;
    if (query.length) {
      rxp = regexFromString(query, runtime.getCaseSensitive(query), true);
    }
    self.listResults(pageItems, (b: URLItem) => {
      if (Object.hasOwn(b, "html")) {
        return self.createItemFromRawHtml({ html: b.html ?? "" });
      } else if (Object.hasOwn(b, "url") && b.url != null) {
        if (getBrowserName() === "Firefox" && /^(place|data):/i.test(b.url)) {
          return null;
        }
        return self.createURLItem(b, rxp);
      } else if (showFolderFlag) {
        const li = createElementWithContent(
          "li",
          `<div class="title">▷ ${self.highlight(rxp, b.title ?? "")}</div>`,
        );
        return buildOmnibarResult(li, {
          folder_name: b.title,
          folderId: b.id == null ? undefined : String(b.id),
        });
      }
      return undefined;
    });
  }

  let savedAargs: OmnibarShowArgs;
  ui.onShow = (args: OmnibarShowArgs) => {
    handler = handlers[args.type] ?? {};
    savedAargs = args;
    ui.classList.remove("sk_omnibar_middle");
    ui.classList.remove("sk_omnibar_bottom");
    ui.classList.add("sk_omnibar_" + getPosition());
    if (getPosition() === "bottom") {
      resultsDiv.remove();
      document.querySelector("#sk_omnibarSearchArea")!.before(resultsDiv);
    } else {
      resultsDiv.remove();
      ui.append(resultsDiv);
    }

    tabbed = args.tabbed != null ? args.tabbed : true;
    self.input.focus();
    mode.enter();
    if (args.pref) {
      setQuery(args.pref);
    }
    resultsDiv.className = "";
    handler.onOpen && handler.onOpen(args.extra);
    lastHandler = handler;
    setPrompt(handler.prompt ?? "");
    setResultPage("");
    ui.scrollTop = 0;
  };

  ui.onHide = () => {
    // clear cache
    delete self.cachedPromise;
    // delete only deletes properties of an object and
    // cannot normally delete a variable declared using var, whatever the scope.
    urlItems = null;
    bookmarkFolders = null;

    lastInput = "";
    setQuery("");
    setPlaceholder("");
    setResults([]);
    setFocusedIndex(-1);
    lastHandler = null;
    handler?.onClose?.();
    mode.exit();
    // Reset to an empty object (not null) so a late async callback reading
    // handler.* after the popup closes hits a harmless no-op rather than a
    // null-deref. onShow always reassigns the real handler before next use.
    handler = {};
  };

  const isUrl = (input: string): boolean | RegExpMatchArray | null => {
    if (/\s+/.test(input)) {
      return false;
    }

    if (/^https?:\/\//.test(input)) {
      return true;
    }

    const regex =
      /^(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)$/;

    return input.match(regex);
  };

  const openFocused = (handler: OmnibarHandler): boolean | undefined => {
    const fi = focusedResult();
    let url;
    if (fi) {
      url = fi.data.url;
    } else {
      url = self.input.value;
      if (!self.isUrl(url)) {
        url = (searchEngine.aliases[runtime.conf.defaultSearchEngine]?.url ?? "") + url;
      }
    }
    let type = "";
    let uid = "";
    if (fi && fi.data.uid) {
      uid = fi.data.uid;
      type = uid[0] ?? "";
      uid = uid.slice(1);
    }
    if (type === "T") {
      const parts = uid.split(":");
      reportOnFail(
        RUNTIME("focusTab", {
          windowId: Number.parseInt(parts[0] ?? ""),
          tabId: Number.parseInt(parts[1] ?? ""),
        }),
        reportError,
      );
    } else if (url && url.length) {
      reportOnFail(
        RUNTIME("openLink", {
          tab: {
            tabbed: handler.tabbed,
            active: handler.activeTab,
          },
          url: url,
        }),
        reportError,
      );
    }
    return handler.activeTab;
  };

  const listResults = <T>(
    items: readonly T[] | null | undefined,
    renderItem: (b: T) => OmnibarResult | null | undefined,
  ): void => {
    if (!items || items.length === 0) {
      setResults([]);
      setFocusedIndex(-1);
      return;
    }
    const displayItems = orderItemsForDisplay(items, getPosition() === "bottom");
    // Each renderItem returns a fully-formed OmnibarResult (display HTML plus the data the
    // handlers and key bindings read from the store); collect them for <ResultList> to render
    // reactively. No data is read back off the <li> any more.
    const built: OmnibarResult[] = [];
    displayItems.forEach((b) => {
      const result = renderItem(b);
      if (result) {
        built.push(result);
      }
    });
    setResults(built);
    if (runtime.conf.focusFirstCandidate || handler?.focusFirstCandidate) {
      setFocusedIndex(getPosition() === "bottom" ? built.length - 1 : 0);
    } else {
      setFocusedIndex(-1);
    }
    if (getPosition() === "bottom" && built.length > 0) {
      const lis = resultsDiv.querySelectorAll("#sk_omnibarSearchResult>ul>li");
      if (lis.length) {
        // querySelectorAll returns a NodeList, which has no Array#at; use NodeList#item.
        scrollIntoViewIfNeeded(lis.item(lis.length - 1));
      }
    }
  };

  const listWords = (words: string[]): void => {
    self.listResults(words, (w: string) => {
      const li = createElementWithContent("li", `⌕ ${w}`);
      return buildOmnibarResult(li, { query: w });
    });
  };

  const html = (content: string): void => {
    // Show a single raw-HTML row through the store so the Solid mount that
    // owns resultsDiv is not clobbered by a direct innerHTML write.
    setResults([{ html: content, data: { text: "" } }]);
    setFocusedIndex(-1);
  };

  const addHandler = (name: string, hdl: OmnibarHandler): void => {
    if (!hdl.onEnter) {
      hdl.onEnter = () => self.openFocused(hdl);
    }
    handlers[name] = hdl;
  };

  const listBookmarkFolders = (
    cb?: (
      response: { folders: { id: string; title?: string }[] },
      folders: Record<string, { id: string; title?: string }>,
    ) => void,
  ): void => {
    reportOnFail(
      RUNTIME(
        "getBookmarkFolders",
        null,
        (response: { folders: { id: string; title?: string }[] }) => {
          const folders: Record<string, BookmarkFolder> = {};
          response.folders.forEach((f) => {
            folders[f.id] = f;
          });
          bookmarkFolders = folders;
          cb && cb(response, folders);
        },
      ),
      reportError,
    );
  };

  // The Solid mounts above run synchronously, so the search input ref has
  // fired by now; fail loudly if the layout changed underneath us.
  if (inputElement == null) {
    throw new Error("omnibar search input failed to render");
  }

  const self: OmnibarMode = {
    // `mode` stays private: createOmnibar drives it through ui.onShow / ui.onHide (mode.enter /
    // mode.exit) and the listeners registered above. `name` is copied so the frontend modes registry
    // can read it without the controller being a ModeHandle.
    name: mode.name,
    mappings,
    input: inputElement,
    resultsDiv,
    setPrompt,
    setQuery,
    setPlaceholder,
    results,
    focusedIndex,
    focusedResult,
    focusItem,
    triggerInput,
    expandAlias,
    collapseAlias,
    highlight,
    createURLItem,
    createItemFromRawHtml,
    detectAndInsertURLItem,
    getPageSize,
    getHistoryCacheSize,
    listURLs,
    getItems,
    isUrl,
    openFocused,
    listResults,
    listWords,
    html,
    addHandler,
    listBookmarkFolders,
  };

  const searchEngine = SearchEngine(self, front);

  self.addHandler("Bookmarks", OpenBookmarks(self));
  self.addHandler("AddBookmark", AddBookmark(self));
  self.addHandler(
    "History",
    OpenURLs("history", self, () => {
      return new Promise((resolve) => {
        reportOnFail(
          RUNTIME(
            "getHistory",
            {
              maxResults: self.getHistoryCacheSize(),
              query: self.input.value,
              sortByMostUsed: runtime.conf.historyMUOrder,
            },
            (response: { history: { title?: string; url?: string }[] }) => {
              resolve(response.history);
            },
          ),
          reportError,
        );
      });
    }),
  );
  self.addHandler(
    "URLs",
    OpenURLs("", self, () => {
      return new Promise((resolve) => {
        reportOnFail(
          RUNTIME(
            "getTabs",
            { queryInfo: runtime.conf.omnibarTabsQuery },
            (response: { tabs: { title?: string; url?: string }[] }) => {
              let results: readonly { title?: string; url?: string }[] = response.tabs;
              reportOnFail(
                RUNTIME(
                  "getTopSites",
                  null,
                  (response2: { urls: { title?: string; url?: string }[] }) => {
                    results = results.concat(response2.urls);
                    results = filterByTitleOrUrl(
                      results,
                      self.input.value,
                      runtime.getCaseSensitive(self.input.value),
                    );
                    self.listBookmarkFolders(() => {
                      reportOnFail(
                        RUNTIME(
                          "getAllURLs",
                          {
                            maxResults: self.getHistoryCacheSize() - results.length,
                            query: self.input.value,
                          },
                          (response3: { urls: { title?: string; url?: string }[] }) => {
                            results = results.concat(response3.urls);
                            resolve(results);
                          },
                        ),
                        reportError,
                      );
                    });
                  },
                ),
                reportError,
              );
            },
          ),
          reportError,
        );
      });
    }),
  );
  self.addHandler(
    "RecentlyClosed",
    OpenURLs("Recently closed", self, () => {
      return new Promise((resolve) => {
        reportOnFail(
          RUNTIME(
            "getRecentlyClosed",
            null,
            (response: { urls: { title?: string; url?: string }[] }) => {
              resolve(
                filterByTitleOrUrl(
                  response.urls,
                  self.input.value,
                  runtime.getCaseSensitive(self.input.value),
                ),
              );
            },
          ),
          reportError,
        );
      });
    }),
  );
  self.addHandler(
    "TabURLs",
    OpenURLs("Tab History", self, () => {
      return new Promise((resolve) => {
        reportOnFail(
          RUNTIME("getTabURLs", null, (response: { urls: { title?: string; url?: string }[] }) => {
            resolve(
              filterByTitleOrUrl(
                response.urls,
                self.input.value,
                runtime.getCaseSensitive(self.input.value),
              ),
            );
          }),
          reportError,
        );
      });
    }),
  );
  self.addHandler("Tabs", OpenTabs(self));
  self.addHandler("CloseTabs", CloseTabs(self));
  self.addHandler("Windows", OpenWindows(self, front));
  self.addHandler("VIMarks", OpenVIMarks(self));
  self.addHandler("SearchEngine", searchEngine);
  self.addHandler("Commands", Commands(self, front));
  self.addHandler("OmniQuery", OmniQuery(self, front));
  self.addHandler("UserURLs", OpenUserURLs(self));

  front.actions["updateOmnibarResult"] = (message: { words: string[] }) => {
    self.listWords(message.words);
  };
  return self;
}

function OpenBookmarks(omnibar: Omnibar): OpenBookmarksHandler {
  const self: OpenBookmarksHandler = {
    prompt: "bookmark",
    inFolder: [],
  };

  let folderOnly = false;
  let currentFolderId: string | undefined;
  let lastFocused = 0;

  function onFolderUp() {
    const fl = self.inFolder.pop();
    if (!fl) {
      return;
    }
    if (fl.folderId) {
      currentFolderId = fl.folderId;
      reportOnFail(
        RUNTIME("getBookmarks", { parentId: currentFolderId }, self.onResponse),
        reportError,
      );
    } else {
      currentFolderId = undefined;
      reportOnFail(RUNTIME("getBookmarks", null, self.onResponse), reportError);
    }
    self.prompt = fl.prompt;
    omnibar.setPrompt(self.prompt ?? "");
    lastFocused = fl.focused;
  }

  self.onEnter = () => {
    let ret: boolean | undefined = false;
    const fi = omnibar.focusedResult();
    const folderId = fi?.data.folderId;
    if (folderId && !self.activeTab) {
      reportOnFail(
        RUNTIME(
          "getBookmarks",
          { parentId: folderId },
          (response: { bookmarks: { url?: string }[] }) => {
            const subItems = response.bookmarks;
            for (const m of subItems) {
              if (m.url) {
                reportOnFail(
                  RUNTIME("openLink", {
                    tab: {
                      tabbed: true,
                      active: false,
                    },
                    url: m.url,
                  }),
                  reportError,
                );
              }
            }
          },
        ),
        reportError,
      );
      self.inFolder.push({
        prompt: self.prompt,
        folderId: currentFolderId,
        focused: omnibar.focusedIndex(),
      });
      localStorage.setItem("surfingkeys.lastOpenBookmark", JSON.stringify(self.inFolder));
    } else if (folderId) {
      self.inFolder.push({
        prompt: self.prompt,
        folderId: currentFolderId,
        focused: omnibar.focusedIndex(),
      });
      self.prompt = fi.data.folder_name;
      omnibar.setPrompt(self.prompt ?? "");
      omnibar.setQuery("");
      currentFolderId = folderId;
      lastFocused = 0;
      reportOnFail(
        RUNTIME("getBookmarks", { parentId: currentFolderId }, self.onResponse),
        reportError,
      );
    } else {
      ret = omnibar.openFocused(self);
      if (ret) {
        self.inFolder.push({
          prompt: self.prompt,
          folderId: currentFolderId,
          focused: omnibar.focusedIndex(),
        });
        localStorage.setItem("surfingkeys.lastOpenBookmark", JSON.stringify(self.inFolder));
      }
    }
    return ret;
  };

  self.onOpen = () => {
    omnibar.listBookmarkFolders(() => {
      const lastBookmarkFolder = localStorage.getItem("surfingkeys.lastOpenBookmark");
      if (lastBookmarkFolder) {
        self.inFolder = JSON.parse(lastBookmarkFolder);
        onFolderUp();
      } else {
        reportOnFail(RUNTIME("getBookmarks", null, self.onResponse), reportError);
      }
      if (omnibar.input.value !== "") {
        self.onInput?.();
      }
    });
  };

  self.onClose = () => {
    self.inFolder = [];
    self.prompt = "bookmark";
    currentFolderId = undefined;
  };

  self.onKeydown = function (event: KeyboardEvent) {
    let eaten = false;
    if (event.keyCode === KeyboardUtils.keyCodes["comma"]) {
      folderOnly = !folderOnly;
      self.prompt = folderOnly ? "bookmark folder" : "bookmark";
      omnibar.setPrompt(self.prompt);
      reportOnFail(
        RUNTIME(
          "getBookmarks",
          { parentId: currentFolderId, query: omnibar.input.value },
          self.onResponse,
        ),
        reportError,
      );
      eaten = true;
    } else if (
      event.keyCode === KeyboardUtils.keyCodes["backspace"] &&
      self.inFolder.length &&
      !omnibar.input.value.length
    ) {
      onFolderUp();
      eaten = true;
    } else if (event.ctrlKey && event.shiftKey && KeyboardUtils.isWordChar(event)) {
      const fi = omnibar.focusedResult();
      if (fi) {
        const mark_char = String.fromCharCode(event.keyCode);
        Normal.addVIMark(mark_char, fi.data.url);
        eaten = true;
      }
    }
    return eaten;
  };
  self.onInput = () => {
    const query = omnibar.input.value;
    reportOnFail(
      RUNTIME(
        "getBookmarks",
        {
          parentId: currentFolderId,
          caseSensitive: runtime.getCaseSensitive(query),
          query,
        },
        self.onResponse,
      ),
      reportError,
    );
  };
  self.onResponse = (response: { bookmarks: { url?: string }[] }) => {
    let items = response.bookmarks;
    if (folderOnly) {
      items = items.filter((b) => {
        return !Object.hasOwn(b, "url") || b.url == null;
      });
    }
    omnibar.listURLs(items, true);

    if (omnibar.focusedIndex() < 0) {
      omnibar.focusItem(lastFocused);
    }
  };

  return self;
}

function AddBookmark(omnibar: Omnibar): AddBookmarkHandler {
  const self: AddBookmarkHandler = {
    focusFirstCandidate: true,
    prompt: "add bookmark",
  };
  let folders: BookmarkFolder[];

  self.onOpen = (arg: BookmarkPage) => {
    self.page = arg;
    omnibar.listBookmarkFolders((response: { folders: BookmarkFolder[] }) => {
      folders = response.folders;
      omnibar.listResults(folders.slice(), (f: BookmarkFolder) => {
        return buildFolderResult(f.title ?? "", f.id);
      });
      reportOnFail(
        RUNTIME("getBookmark", null, (resp: { bookmarks: { parentId?: string | number }[] }) => {
          if (resp.bookmarks.length) {
            const b = resp.bookmarks[0];
            omnibar.setPrompt("edit bookmark");
            const idx = omnibar
              .results()
              .findIndex((r: OmnibarResult) => r.data.folder === String(b?.parentId));
            if (idx !== -1) {
              omnibar.focusItem(idx);
            }
          }

          //restore the last used bookmark folder input
          const lastBookmarkFolder = localStorage.getItem("surfingkeys.lastAddedBookmark");
          if (lastBookmarkFolder) {
            omnibar.setQuery(lastBookmarkFolder);

            //make the input selected, so if user don't want to use it,
            //just input to overwrite the previous value
            omnibar.input.select();

            // trigger omnibar input matching
            self.onInput?.();
          }
        }),
        reportError,
      );
    });
  };

  self.onTabKey = () => {
    const fi = omnibar.focusedResult();
    if (fi) {
      omnibar.setQuery(fi.data.text.slice(2));
    }
  };

  self.onEnter = () => {
    const page = self.page;
    if (!page) {
      return false;
    }
    page.path = [];
    const fi = omnibar.focusedResult();
    let folderName: string | undefined;
    if (fi) {
      page.folder = fi.data.folder;
      folderName = fi.data.text.slice(2);
    } else {
      const segments = omnibar.input.value.split("/");
      const title = segments.pop();
      if (title != null && title.length) {
        page.title = title;
      }
      const parts = segments.filter((p) => {
        return p.length > 0;
      });
      for (let l = parts.length; l > 0; l--) {
        const tf = folders.find((f) => {
          return f.title === `/${parts.slice(0, l).join("/")}/`;
        });
        if (tf) {
          page.folder = tf.id;
          page.path = parts.slice(l);
          folderName = "/" + parts.join("/");
          break;
        }
      }
      const firstFolder = folders[0];
      if (page.folder == null && firstFolder) {
        page.folder = firstFolder.id;
        page.path = parts;
        folderName = `${firstFolder.title ?? ""}${parts.join("/")}`;
      }
    }
    reportOnFail(
      RUNTIME("createBookmark", { page: page }, () => {
        showBanner(`Bookmark created at ${folderName}.`, 3000);
      }),
      reportError,
    );
    localStorage.setItem("surfingkeys.lastAddedBookmark", omnibar.input.value);
    return true;
  };

  self.onInput = () => {
    const query = omnibar.input.value;
    const caseSensitive = runtime.getCaseSensitive(query);
    const matches = folders.filter((b) => {
      const title = b.title ?? "";
      return caseSensitive
        ? title.includes(query)
        : title.toLowerCase().includes(query.toLowerCase());
    });
    omnibar.listResults(matches, (f: BookmarkFolder) => {
      return buildFolderResult(f.title ?? "", f.id);
    });
  };

  return self;
}

function OpenURLs(
  prompt: PromptValue,
  omnibar: Omnibar,
  queryFn: () => Promise<readonly HistoryItem[]>,
): OpenURLsHandler {
  const self: OpenURLsHandler = { prompt };
  let sequenceNumber: number;

  const queryAndList = () => {
    const myseq = ++sequenceNumber;
    queryFn().then((urls) => {
      if (myseq === sequenceNumber) {
        const val = omnibar.input.value;
        // detectAndInsertURLItem prepends to the list, so copy the readonly query result first.
        const list = [...urls];
        omnibar.detectAndInsertURLItem(val, list);
        omnibar.listURLs(list, false);
      }
    });
  };
  self.onOpen = (arg?: string) => {
    if (arg) {
      omnibar.setQuery(arg);
    }
    sequenceNumber = 0;
    queryAndList();
  };
  self.onInput = debounce(queryAndList, 200);
  self.onClose = () => {
    self.onInput?.cancel();
  };

  self.onReset = () => {
    runtime.conf.historyMUOrder = !runtime.conf.historyMUOrder;
    queryFn().then((historyItems) => {
      const compare = runtime.conf.historyMUOrder
        ? (a: HistoryItem, b: HistoryItem) => (b.visitCount ?? 0) - (a.visitCount ?? 0)
        : (a: HistoryItem, b: HistoryItem) => (b.lastVisitTime ?? 0) - (a.lastVisitTime ?? 0);
      omnibar.listURLs(historyItems.toSorted(compare), false);
    });
  };
  return self;
}

function OpenTabs(omnibar: Omnibar): OmnibarHandler {
  const self: OmnibarHandler = {
    focusFirstCandidate: true,
  };

  let getTabsArgs: {
    queryInfo?: { currentWindow: boolean };
    filter?: string;
    tabsThreshold?: number;
  } = {};
  // A locally-typed view of the shared cache slot so onInput reads typed tabs.
  let tabsPromise: Promise<TabItem[]> | undefined;
  self.getResults = () => {
    tabsPromise = new Promise<TabItem[]>((resolve) => {
      getTabsArgs.tabsThreshold = Math.min(
        runtime.conf.tabsThreshold,
        Math.ceil(window.innerWidth / 26),
      );
      reportOnFail(
        RUNTIME(
          "getTabs",
          getTabsArgs,
          (response: { tabs: { title?: string; url?: string }[] }) => {
            resolve(response.tabs);
          },
        ),
        reportError,
      );
    });
    omnibar.cachedPromise = tabsPromise;
  };
  self.onOpen = (args?: { action?: string; filter?: string }) => {
    if (args && args.action === "gather") {
      self.prompt = "Gather filtered tabs into current window";
      self.onEnter = () => {
        reportOnFail(
          RUNTIME("gatherTabs", {
            tabs: omnibar.getItems(),
          }),
          reportError,
        );
        return true;
      };
      getTabsArgs = { queryInfo: { currentWindow: false } };
    } else {
      self.prompt = "tabs";
      self.onEnter = () => omnibar.openFocused(self);
      getTabsArgs = {};
      if (args && typeof args.filter === "string") {
        getTabsArgs.filter = args.filter;
      }
    }
    self.getResults?.();
    self.onInput?.();
  };
  self.onInput = () => {
    tabsPromise?.then((cached) => {
      const filtered = filterByTitleOrUrl(
        cached,
        omnibar.input.value,
        runtime.getCaseSensitive(omnibar.input.value),
      );
      omnibar.listURLs(filtered, false);
    });
  };
  return self;
}

function CloseTabs(omnibar: Omnibar): OmnibarHandler {
  const self: OmnibarHandler = {
    focusFirstCandidate: true,
  };

  // A locally-typed view of the shared cache slot so onInput reads typed tabs.
  let tabsPromise: Promise<TabItem[]> | undefined;
  self.onOpen = () => {
    self.prompt = "close tabs";
    tabsPromise = new Promise<TabItem[]>((resolve) => {
      reportOnFail(
        RUNTIME(
          "getTabs",
          { queryInfo: { currentWindow: true } },
          (response: { tabs: { title?: string; url?: string }[] }) => {
            resolve(response.tabs);
          },
        ),
        reportError,
      );
    });
    omnibar.cachedPromise = tabsPromise;
    self.onInput?.();
  };
  self.onInput = () => {
    tabsPromise?.then((cached) => {
      const filtered = filterByTitleOrUrl(
        cached,
        omnibar.input.value,
        runtime.getCaseSensitive(omnibar.input.value),
      );
      filtered.forEach((tab: TabItem) => {
        const r = Result.try({
          try: () => new URL(tab.url ?? ""),
          catch: (cause) => decodeError(tab.url ?? "", cause),
        });
        if (Result.isSuccess(r)) {
          tab.url = r.value.origin + r.value.pathname;
        }
      });
      omnibar.listURLs(filtered, false);
    });
  };
  self.onEnter = () => {
    const tabIds: number[] = [];
    omnibar.results().forEach((r: OmnibarResult) => {
      const uid = r.data.uid;
      if (uid && uid[0] === "T") {
        const parts = uid.slice(1).split(":");
        tabIds.push(Number.parseInt(parts[1] ?? ""));
      }
    });
    if (tabIds.length > 0) {
      reportOnFail(RUNTIME("closeTabByIds", { tabIds: tabIds }), reportError);
    }
    return true;
  };
  return self;
}

function OpenWindows(omnibar: Omnibar, front: OmnibarFront): OmnibarHandler {
  const self: OmnibarHandler = {
    prompt: "Move current tab to window",
  };

  // A locally-typed view of the shared cache slot so onInput reads typed windows.
  let windowsPromise: Promise<WindowItem[]> | undefined;
  self.getResults = () => {
    windowsPromise = new Promise<WindowItem[]>((resolve) => {
      reportOnFail(
        RUNTIME("getWindows", { query: "" }, (response: { windows: WindowItem[] }) => {
          resolve(response.windows);
        }),
        reportError,
      );
    });
    omnibar.cachedPromise = windowsPromise;
  };
  self.onEnter = () => {
    const fi = omnibar.focusedResult();
    let windowId = -1;
    if (fi && fi.data.windowId != null) {
      windowId = fi.data.windowId;
    }
    reportOnFail(RUNTIME("moveToWindow", { windowId }), reportError);
    return true;
  };
  self.onOpen = () => {
    omnibar.setPlaceholder("Press enter without focusing an item to move to a new window.");
    self.getResults?.();
    self.onInput?.();
  };
  self.onInput = () => {
    windowsPromise?.then((cached) => {
      if (cached.length === 0) {
        reportOnFail(RUNTIME("moveToWindow", { windowId: -1 }), reportError);
        front.hidePopup();
      }
      let filtered = cached;
      const query = omnibar.input.value;
      let rxp: RegExp | null = null;
      if (query && query.length) {
        rxp = regexFromString(query, runtime.getCaseSensitive(query), false);
        filtered = cached.filter((w: WindowItem) => {
          for (const t of w.tabs) {
            if (rxp!.test(t.title ?? "") || rxp!.test(t.url ?? "")) {
              return true;
            }
          }
          return false;
        });
      }
      rxp = regexFromString(query, runtime.getCaseSensitive(query), true);
      omnibar.listResults(filtered, (w: WindowItem) => {
        const li = createElementWithContent("li");
        li.classList.add("window");
        if (w.isPreviousChoice) {
          li.classList.add("focused");
        }
        w.tabs.forEach((t: TabItem) => {
          const div = createElementWithContent("div", "", { class: "tab_in_window" });
          div.appendChild(
            createElementWithContent("div", omnibar.highlight(rxp, t.title ?? ""), {
              class: "title",
            }),
          );
          div.appendChild(
            createElementWithContent("div", omnibar.highlight(rxp, new URL(t.url ?? "").origin), {
              class: "url",
            }),
          );
          li.appendChild(div);
        });
        // Join every tab URL so the copy-line binding can yank all tabs in this window at once.
        const url = w.tabs.map((t: TabItem) => t.url).join("\n");
        return buildOmnibarResult(li, { windowId: Number.parseInt(w.id), url });
      });
    });
  };
  return self;
}

function OpenVIMarks(omnibar: Omnibar): OmnibarHandler {
  const self: OmnibarHandler = {
    focusFirstCandidate: true,
    prompt: "VIMarks",
  };

  self.onOpen = () => {
    const query = omnibar.input.value;
    const urls: { title: string; type: string; uid: string; url: string }[] = [];
    reportOnFail(
      RUNTIME(
        "getSettings",
        { key: "marks" },
        (response: {
          settings: {
            marks: Record<
              string,
              string | { url: string; scrollLeft?: number; scrollTop?: number }
            >;
          };
        }) => {
          for (const m in response.settings.marks) {
            const raw = response.settings.marks[m];
            if (raw == null) {
              continue;
            }
            const markInfo =
              typeof raw === "string" ? { url: raw, scrollLeft: 0, scrollTop: 0 } : raw;
            if (query === "" || markInfo.url.includes(query)) {
              urls.push({
                title: m,
                type: "🔗",
                uid: "M" + m,
                url: markInfo.url,
              });
            }
          }
          omnibar.listURLs(urls, false);
        },
      ),
      reportError,
    );
  };
  self.onInput = self.onOpen;
  return self;
}

function SearchEngine(omnibar: Omnibar, front: OmnibarFront): SearchEngineHandler {
  const self: SearchEngineHandler = { aliases: {} };

  let pendingRequest: ReturnType<typeof setTimeout> | undefined = undefined; // timeout ID
  function clearPendingRequest() {
    if (pendingRequest) {
      clearTimeout(pendingRequest);
      pendingRequest = undefined;
    }
  }
  self.onOpen = (arg: string) => {
    Object.assign(self, self.aliases[arg]);
    const q = omnibar.input.value;
    if (q.length) {
      const b = q.match(/^(site:\S+\s*).*/);
      if (b) {
        omnibar.input.setSelectionRange((b[1] ?? "").length, q.length);
      }
      omnibar.triggerInput();
    }
  };
  self.onClose = () => {
    clearPendingRequest();
    self.prompt = undefined;
    self.url = undefined;
    self.suggestionURL = undefined;
  };
  self.onTabKey = () => {
    const fi = omnibar.focusedResult();
    if (fi && fi.data.query) {
      omnibar.setQuery(fi.data.query);
    }
  };
  self.onEnter = () => {
    const fi = omnibar.focusedResult();
    let url;
    if (fi) {
      url =
        fi.data.url ||
        constructSearchURL(
          self.url ?? "",
          encodeURIComponent(fi.data.query || omnibar.input.value),
        );
    } else {
      url = constructSearchURL(self.url ?? "", encodeURIComponent(omnibar.input.value));
    }
    reportOnFail(
      RUNTIME("openLink", {
        tab: {
          tabbed: self.tabbed,
          active: self.activeTab,
        },
        url: url,
      }),
      reportError,
    );
    return self.activeTab;
  };
  function listSuggestions(suggestions: SearchSuggestion[]) {
    omnibar.detectAndInsertURLItem(omnibar.input.value, suggestions);
    const query = encodeURIComponent(omnibar.input.value);
    const rxp = regexFromString(query, runtime.getCaseSensitive(query), true);
    omnibar.listResults(suggestions, (w: SearchSuggestion) => {
      // `suggestions` is asserted as SearchSuggestion[] but originates from untrusted resp2.data, so
      // guard against null (which `typeof` reports as "object", making `in` throw) and stringify the
      // bare-query fallback to keep a non-string out of OmnibarResult.data.query.
      if (w != null && typeof w === "object" && "html" in w) {
        return omnibar.createItemFromRawHtml(w);
      } else if (w != null && typeof w === "object" && "url" in w) {
        return omnibar.createURLItem(w, rxp);
      } else {
        const text = String(w);
        const li = createElementWithContent("li", `⌕ ${text}`);
        return buildOmnibarResult(li, { query: text });
      }
    });
  }
  self.onInput = () => {
    const canSuggest = self.suggestionURL;
    const showSuggestions = canSuggest && runtime.conf.omnibarSuggestion;

    if (!showSuggestions) {
      listSuggestions([]);
      return;
    }

    clearPendingRequest();
    // Set a timeout before the request is dispatched so that it can be canceled if necessary.
    // This helps prevent rate-limits when typing a long query.
    // E.g. github.com's API rate-limits after only 10 unauthenticated requests.
    pendingRequest = setTimeout(() => {
      const requestUrl = constructSearchURL(
        self.suggestionURL ?? "",
        encodeURIComponent(omnibar.input.value),
      );
      reportOnFail(
        RUNTIME("request", { method: "get", url: requestUrl }, (resp: unknown) => {
          front.contentCommand(
            {
              action: "getSearchSuggestions",
              url: self.suggestionURL,
              query: omnibar.input.value,
              requestUrl,
              response: resp,
            },
            (resp2: unknown) => {
              const raw = resp2 && typeof resp2 === "object" && "data" in resp2 ? resp2.data : [];
              listSuggestions(Array.isArray(raw) ? raw : []);
            },
          );
        }),
        reportError,
      );
    }, runtime.conf.omnibarSuggestionTimeout);
  };

  front.actions["addSearchAlias"] = (message: {
    alias: string;
    prompt: string;
    url: string;
    suggestionURL: string;
    options?: { favicon_url?: string };
  }) => {
    const alias: SearchAlias = {
      prompt: `${message.prompt}`,
      url: message.url,
      suggestionURL: message.suggestionURL,
    };
    self.aliases[message.alias] = alias;
    const searchEngineIconStorageKey = `surfingkeys.searchEngineIcon.${message.prompt}`;
    const searchEngineIcon = localStorage.getItem(searchEngineIconStorageKey);
    if (searchEngineIcon) {
      alias.prompt = {
        html: `<img src="${searchEngineIcon}" alt="${message.prompt}" style="width: 20px;" />`,
      };
    } else if (front.topOrigin.startsWith("http")) {
      let iconUrl;
      if (message.options?.favicon_url) {
        iconUrl = new URL(message.options.favicon_url);
      } else {
        iconUrl = new URL(message.url);
        iconUrl.pathname = "favicon.ico";
        iconUrl.search = "";
        iconUrl.hash = "";
      }
      reportOnFail(
        RUNTIME("requestImage", { url: iconUrl.href }, (response: { text: string } | null) => {
          if (response) {
            localStorage.setItem(searchEngineIconStorageKey, response.text);
            alias.prompt = {
              html: `<img src="${response.text}" alt="${message.prompt}" style="width: 20px;" />`,
            };
          }
        }),
        reportError,
      );
    }
  };
  front.actions["removeSearchAlias"] = (message: { alias: string }) => {
    delete self.aliases[message.alias];
  };
  front.actions["getSearchAliases"] = (message: { id: unknown }) => {
    front.postMessage({
      aliases: self.aliases,
      toContent: true,
      id: message.id,
    });
  };

  return self;
}

function Commands(omnibar: Omnibar, front: OmnibarFront): OmnibarHandler {
  const self: OmnibarHandler = {
    focusFirstCandidate: false,
    prompt: ":",
  };
  const items: Record<string, CommandMeta> = {};

  self.onOpen = () => {
    omnibar.resultsDiv.className = "commands";

    if (omnibar.input.value.length) {
      omnibar.triggerInput();
      return;
    }

    reportOnFail(
      RUNTIME(
        "getSettings",
        { key: "cmdHistory" },
        (response: { settings: { cmdHistory: string[] } }) => {
          const candidates = response.settings.cmdHistory;
          if (candidates.length) {
            omnibar.listResults(candidates, (c: unknown) => {
              const li = createElementWithContent("li", String(c));
              return buildOmnibarResult(li, { cmd: String(c) });
            });
          }
        },
      ),
      reportError,
    );
  };

  self.onReset = self.onOpen;

  self.onInput = () => {
    const cmd = omnibar.input.value;
    const candidates = Object.keys(items).filter((c) => {
      return cmd === "" || c.includes(cmd);
    });
    if (candidates.length) {
      omnibar.listResults(candidates, (c: string) => {
        const li = createElementWithContent(
          "li",
          `${c}<span class=annotation>${htmlEncode(String(items[c]?.annotation ?? ""))}</span>`,
        );
        return buildOmnibarResult(li, { cmd: c });
      });
    }
  };

  self.onTabKey = () => {
    const fi = omnibar.focusedResult();
    if (fi) {
      omnibar.setQuery(fi.data.cmd ?? "");
    }
  };

  self.onEnter = () => {
    const ret = false;
    const cmdline = omnibar.input.value;
    if (cmdline.length) {
      reportOnFail(RUNTIME("updateInputHistory", { cmd: cmdline }), reportError);
      execute(cmdline);
      omnibar.setQuery("");
    }
    return ret;
  };

  function execute(cmdline: string) {
    const args = parseCommandLine(cmdline);
    const cmd = args.shift() ?? "";
    const meta = items[cmd];
    if (meta) {
      meta.code(args);
    } else {
      showBanner(`Unsupported command: ${cmdline}.`, 3000);
    }
  }

  front.actions["executeCommand"] = (message: { cmdline: string }) => {
    execute(message.cmdline);
  };

  omnibar.command = (cmd: string, annotation: string, jscode: (args: string[]) => void) => {
    const ag = parseAnnotation({ annotation: annotation, feature_group: 13 });
    items[cmd] = {
      code: jscode,
      feature_group: ag.feature_group,
      annotation: ag.annotation,
    };
  };

  return self;
}

function OmniQuery(omnibar: Omnibar, front: OmnibarFront): OmnibarHandler {
  const self: OmnibarHandler = {
    prompt: "ǭ",
  };

  function onlyUnique(value: string, index: number, arr: string[]) {
    return arr.indexOf(value) === index;
  }
  // onInput can fire before the getPageText round-trip assigns the real page words.
  let words: string[] = [];
  self.onOpen = (arg?: string) => {
    if (arg && document.dictEnabled == null) {
      omnibar.setQuery(arg);
      front.contentCommand({
        action: "omnibar_query_entered",
        query: arg,
      });
    }
    front.contentCommand(
      {
        action: "getPageText",
      },
      (message: { data: string }) => {
        const splitRegex = /[^a-zA-Z]+/;
        words = message.data.toLowerCase().split(splitRegex).filter(onlyUnique);
      },
    );
  };

  self.onInput = () => {
    const iw = omnibar.input.value;
    const candidates = words.filter((w) => {
      return w.includes(iw);
    });
    if (candidates.length) {
      omnibar.listResults(candidates, (w: string) => {
        return buildOmnibarResult(createElementWithContent("li", w), {});
      });
    }
  };

  self.onTabKey = () => {
    const fi = omnibar.focusedResult();
    if (fi) {
      omnibar.setQuery(fi.data.text);
    }
  };

  self.onEnter = () => {
    front.contentCommand({
      action: "omnibar_query_entered",
      query: omnibar.input.value,
    });
  };

  return self;
}

function OpenUserURLs(omnibar: Omnibar): OmnibarHandler {
  const self: OmnibarHandler = {
    focusFirstCandidate: true,
    prompt: "UserURLs",
  };

  let items: { title?: string; url?: string }[];
  self.onOpen = (args: { title?: string; url?: string }[]) => {
    items = args;
    self.onInput?.();
  };

  self.onInput = () => {
    const query = omnibar.input.value;
    const urls = filterByTitleOrUrl(items, query, runtime.getCaseSensitive(query));
    omnibar.listURLs(urls, false);
  };
  return self;
}
export default createOmnibar;
