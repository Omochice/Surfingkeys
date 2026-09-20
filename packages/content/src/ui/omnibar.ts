import { Result } from "@praha/byethrow";
import { attachFaviconToImgSrc } from "@sk/adapter/platform-utils";
import { decodeError, reportOnFail, unwrapOr } from "@sk/common/result";
import { filterByTitleOrUrl, regexFromString } from "@sk/common/utils";
import { debounce } from "@sk/core/debounce";
import type { DebouncedFunction } from "@sk/core/debounce";
import type { FeatureGroup } from "@sk/core/featureGroup";
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
  normalizeAnnotation,
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

type BookmarkFolder = { id: string; title?: string };

type SearchAlias = { prompt: PromptValue; url: string; suggestionURL: string };

type TabItem = { title?: string; url?: string };

type WindowItem = { id: string; isPreviousChoice?: boolean; tabs: TabItem[] };

type HistoryItem = { title?: string; url?: string; visitCount?: number; lastVisitTime?: number };

/**
 * A bookmark, history entry, tab or folder row. Every field is optional because the source decides
 * which are present, and the renderer branches on `Object.hasOwn` to decide the row type.
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

type SearchSuggestion = string | { html: string } | { url: string };

type CommandMeta = {
  code: (args: string[]) => void;
  group?: FeatureGroup | undefined;
  annotation?: string | string[] | undefined;
};

/**
 * A per-type omnibar handler (OpenBookmarks, OpenTabs, SearchEngine, …). Every hook is optional and
 * probed before being called; handlers carry their own extra state on top of this shared shape.
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

type SearchEngineHandler = OmnibarHandler & {
  aliases: Record<string, SearchAlias>;
  url?: string | undefined;
  suggestionURL?: string | undefined;
};

type OpenBookmarksHandler = OmnibarHandler & {
  inFolder: {
    prompt?: PromptValue | undefined;
    folderId?: string | undefined;
    focused: number;
  }[];
  onResponse?(response: { bookmarks: { url?: string }[] }): void;
};

type BookmarkPage = {
  url?: string | undefined;
  title?: string | undefined;
  folder?: string | undefined;
  path?: string[] | undefined;
};

type AddBookmarkHandler = OmnibarHandler & { page?: BookmarkPage };

/** Debounced onInput, so the cancelable variant is kept. */
type OpenURLsHandler = OmnibarHandler & { onInput?: DebouncedFunction };

/**
 * The omnibar API surface the per-type handlers drive. `cachedPromise` is a shared slot cleared on
 * close; each handler resolves it with its own type and reads it back through a local typed
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
  highlight: (regex: RegExp | null, str: string) => string;
  createURLItem: (b: URLItem, regex: RegExp | null) => OmnibarResult;
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
 * The slice of the front the omnibar talks to. `actions` is assignment-only here, so a `never`
 * parameter accepts handlers of any message shape without `any`. `contentCommand` is declared as a
 * method so its callback parameter is checked bivariantly, which lets the front's unknown-typed
 * implementation satisfy it.
 */
type OmnibarFront = {
  hidePopup: () => void;
  openOmnibar: (args: OmnibarShowArgs) => void;
  postMessage: (msg: Record<string, unknown>) => void;
  topOrigin: string;
  actions: Record<string, (message: never) => void>;
  contentCommand<R = unknown>(args: Record<string, unknown>, successById?: (msg: R) => void): void;
};

type OmnibarShowArgs = {
  type: string;
  tabbed?: boolean;
  initialQuery?: string;
  extra?: unknown;
};

type OmnibarElement = HTMLElement & {
  onShow: (args: OmnibarShowArgs) => void;
  onHide: () => void;
};

/**
 * The full omnibar controller. It wraps a private {@link ModeHandle} rather than being one, so the
 * handle's stack-push and event dispatch stay internal to createOmnibar.
 */
type OmnibarMode = Omnibar & {
  name: string;
  mappings: Trie;
  expandAlias(alias: string, val: string): boolean;
  collapseAlias(): boolean;
  getPageSize(): number;
  html(content: string): void;
  isUrl(input: string): boolean | RegExpMatchArray | null;
  addHandler(name: string, handler: OmnibarHandler): void;
};

/**
 * Persist a vim-like mark for a URL selected in the omnibar.
 *
 * The frontend UI iframe has no `Normal` mode instance to call, so the mark goes through the
 * `addVIMark` runtime channel directly. The target is a bookmark or history URL rather than a live
 * page, so no scroll position is captured.
 */
function addVIMark(mark: string, url: string): void {
  RUNTIME("addVIMark", { mark: { [mark]: { url, scrollLeft: 0, scrollTop: 0 } } });
}

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

  const [results, setResults] = createSignal<OmnibarResult[]>([]);
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [resultPage, setResultPage] = createSignal("");
  const [prompt, setPrompt] = createSignal<PromptValue>("");
  const [query, setQuery] = createSignal("");
  const [inputVisible, setInputVisible] = createSignal(true);
  const [placeholder, setPlaceholder] = createSignal("");
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
    group: "omnibar",
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
    group: "omnibar",
    code: function () {
      const savedInput = self.input.value;
      runtime.conf.omnibarPosition =
        runtime.conf.omnibarPosition === "bottom" ? "middle" : "bottom";
      reopen(() => {
        savedArgs.initialQuery = savedInput;
        front.openOmnibar(savedArgs);
      });
    },
  });

  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-.>"), {
    annotation: "Show results of next page",
    group: "omnibar",
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
    group: "omnibar",
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
    group: "omnibar",
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
    group: "omnibar",
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
    group: "omnibar",
    code: function () {
      if (handler && handler.onReset) {
        handler.onReset();
      }
    },
  });

  mappings.add(KeyboardUtils.encodeKeystroke("<Esc>"), {
    annotation: "Close Omnibar",
    group: "omnibar",
    code: function () {
      front.hidePopup();
    },
  });

  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-m>"), {
    annotation: "Create vim-like mark for selected item",
    group: "omnibar",
    code: function (mark: string) {
      const fi = focusedResult();
      if (fi && fi.data.url) {
        addVIMark(mark, fi.data.url);
      }
    },
  });

  const handlers: Record<string, OmnibarHandler> = {};
  let bookmarkFolders: Record<string, BookmarkFolder> | null;

  let lastInput = "";
  // An empty object rather than null so a read before the first show is a harmless no-op.
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

  // createRoot rather than render so the <input> can be inserted at the exact position the
  // `#sk_omnibarSearchArea>input` CSS selector requires: between span.prompt and span.resultPage.
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
    group: "omnibar",
    code: function () {
      rotateResult(getPosition() === "bottom");
    },
  });
  mappings.add(KeyboardUtils.encodeKeystroke("<Shift-Tab>"), {
    annotation: "Backward cycle through the candidates.",
    group: "omnibar",
    code: function () {
      rotateResult(getPosition() !== "bottom");
    },
  });
  mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-n>"), {
    annotation: "Forward cycle through the input history.",
    group: "omnibar",
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
    group: "omnibar",
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
    group: "omnibar",
    code: toggleQuote,
  });

  const highlight = (regex: RegExp | null, str: string): string => {
    if (str.slice(0, 11) === "data:image/") {
      str = str.slice(0, 1024);
    }
    return regex === null
      ? str
      : str.replace(regex, (m) => {
          return "<span class=omnibar_highlight>" + m + "</span>";
        });
  };

  const createURLItem = (b: URLItem, regex: RegExp | null): OmnibarResult => {
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
        `<div class="title">${self.highlight(regex, htmlEncode(title))} ${additional}</div><div class="url">${self.highlight(regex, htmlEncode(unwrapOr(tryDecodeURIComponent(url), url)))}</div>`,
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
    const startIndex = (start - 1) * runtime.conf.omnibarMaxResults;
    let endIndex = startIndex + runtime.conf.omnibarMaxResults;
    endIndex = endIndex > urlItems.length ? urlItems.length : endIndex;
    let total: number | string = urlItems.length;
    if (total === runtime.conf.omnibarHistoryCacheSize) {
      total = total + "+";
    }
    setResultPage(`${startIndex + 1} - ${endIndex} / ${total}`);
    pageItems = urlItems.slice(startIndex, endIndex);
    const query = self.input.value.trim();
    let regex: RegExp | null = null;
    if (query.length) {
      regex = regexFromString(query, runtime.getCaseSensitive(query), true);
    }
    self.listResults(pageItems, (b: URLItem) => {
      if (Object.hasOwn(b, "html")) {
        return self.createItemFromRawHtml({ html: b.html ?? "" });
      } else if (Object.hasOwn(b, "url") && b.url != null) {
        if (getBrowserName() === "Firefox" && /^(place|data):/i.test(b.url)) {
          return null;
        }
        return self.createURLItem(b, regex);
      } else if (showFolderFlag) {
        const li = createElementWithContent(
          "li",
          `<div class="title">▷ ${self.highlight(regex, b.title ?? "")}</div>`,
        );
        return buildOmnibarResult(li, {
          folderName: b.title,
          folderId: b.id == null ? undefined : String(b.id),
        });
      }
      return undefined;
    });
  }

  let savedArgs: OmnibarShowArgs;
  ui.onShow = (args: OmnibarShowArgs) => {
    handler = handlers[args.type] ?? {};
    savedArgs = args;
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
    if (args.initialQuery) {
      setQuery(args.initialQuery);
    }
    resultsDiv.className = "";
    handler.onOpen && handler.onOpen(args.extra);
    lastHandler = handler;
    setPrompt(handler.prompt ?? "");
    setResultPage("");
    ui.scrollTop = 0;
  };

  ui.onHide = () => {
    delete self.cachedPromise;
    // `delete` only removes object properties, so these locals are nulled instead.
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
    // An empty object rather than null so a late async callback reading handler.* after the popup
    // closes hits a no-op instead of a null-deref.
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
    // Through the store, so the Solid mount owning resultsDiv is not clobbered by a direct
    // innerHTML write.
    setResults([{ html: content, data: { text: "" } }]);
    setFocusedIndex(-1);
  };

  const addHandler = (name: string, newHandler: OmnibarHandler): void => {
    if (!newHandler.onEnter) {
      newHandler.onEnter = () => self.openFocused(newHandler);
    }
    handlers[name] = newHandler;
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

  // The Solid mounts above run synchronously, so the search input ref has fired by now.
  if (inputElement == null) {
    throw new Error("omnibar search input failed to render");
  }

  const self: OmnibarMode = {
    // `name` is copied rather than exposing `mode`, which stays private.
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
              sortByMostUsed: runtime.conf.historyMostUsedOrder,
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
    const folder = self.inFolder.pop();
    if (!folder) {
      return;
    }
    if (folder.folderId) {
      currentFolderId = folder.folderId;
      reportOnFail(
        RUNTIME("getBookmarks", { parentId: currentFolderId }, self.onResponse),
        reportError,
      );
    } else {
      currentFolderId = undefined;
      reportOnFail(RUNTIME("getBookmarks", null, self.onResponse), reportError);
    }
    self.prompt = folder.prompt;
    omnibar.setPrompt(self.prompt ?? "");
    lastFocused = folder.focused;
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
      self.prompt = fi.data.folderName;
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
      if (fi && fi.data.url) {
        const markChar = String.fromCharCode(event.keyCode);
        addVIMark(markChar, fi.data.url);
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

          const lastBookmarkFolder = localStorage.getItem("surfingkeys.lastAddedBookmark");
          if (lastBookmarkFolder) {
            omnibar.setQuery(lastBookmarkFolder);

            // Select it, so typing overwrites the restored value for a user who does not want it.
            omnibar.input.select();

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
        const matchedFolder = folders.find((f) => {
          return f.title === `/${parts.slice(0, l).join("/")}/`;
        });
        if (matchedFolder) {
          page.folder = matchedFolder.id;
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
    runtime.conf.historyMostUsedOrder = !runtime.conf.historyMostUsedOrder;
    queryFn().then((historyItems) => {
      const compare = runtime.conf.historyMostUsedOrder
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
      let regex: RegExp | null = null;
      if (query && query.length) {
        regex = regexFromString(query, runtime.getCaseSensitive(query), false);
        filtered = cached.filter((w: WindowItem) => {
          for (const t of w.tabs) {
            if (regex!.test(t.title ?? "") || regex!.test(t.url ?? "")) {
              return true;
            }
          }
          return false;
        });
      }
      regex = regexFromString(query, runtime.getCaseSensitive(query), true);
      omnibar.listResults(filtered, (w: WindowItem) => {
        const li = createElementWithContent("li");
        li.classList.add("window");
        if (w.isPreviousChoice) {
          li.classList.add("focused");
        }
        w.tabs.forEach((t: TabItem) => {
          const div = createElementWithContent("div", "", { class: "tab_in_window" });
          div.appendChild(
            createElementWithContent("div", omnibar.highlight(regex, t.title ?? ""), {
              class: "title",
            }),
          );
          div.appendChild(
            createElementWithContent("div", omnibar.highlight(regex, new URL(t.url ?? "").origin), {
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

  let pendingRequest: ReturnType<typeof setTimeout> | undefined = undefined;
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
    const regex = regexFromString(query, runtime.getCaseSensitive(query), true);
    omnibar.listResults(suggestions, (w: SearchSuggestion) => {
      // `suggestions` is asserted as SearchSuggestion[] but originates from untrusted resp2.data, so
      // guard against null (which `typeof` reports as "object", making `in` throw) and stringify the
      // bare-query fallback to keep a non-string out of OmnibarResult.data.query.
      if (w != null && typeof w === "object" && "html" in w) {
        return omnibar.createItemFromRawHtml(w);
      } else if (w != null && typeof w === "object" && "url" in w) {
        return omnibar.createURLItem(w, regex);
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
    options?: { faviconUrl?: string };
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
      if (message.options?.faviconUrl) {
        iconUrl = new URL(message.options.faviconUrl);
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

  omnibar.command = (
    cmd: string,
    annotation: string,
    jscode: (args: string[]) => void,
    group: FeatureGroup = "misc",
  ) => {
    items[cmd] = {
      code: jscode,
      group,
      annotation: normalizeAnnotation(annotation),
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
  // Ties each in-flight getPageText response to the open it was issued for.
  let session = 0;
  self.onOpen = (arg?: string) => {
    session += 1;
    const opened = session;
    // The handler is reused across omnibar sessions; drop the previous page's words.
    words = [];
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
        if (opened !== session) {
          return;
        }
        const splitRegex = /[^a-zA-Z]+/;
        words = message.data.toLowerCase().split(splitRegex).filter(onlyUnique);
        // Refresh through the omnibar so an alias switch that swapped the active
        // handler mid-session is not overwritten with OmniQuery candidates.
        if (omnibar.input.value) {
          omnibar.triggerInput();
        }
      },
    );
  };

  self.onClose = () => {
    session += 1;
  };

  self.onInput = () => {
    const inputValue = omnibar.input.value;
    const candidates = words.filter((w) => {
      return w.includes(inputValue);
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
