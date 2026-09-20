/** Options accepted by the `mapkey` family. */
export type MapkeyOptions = {
  /** Restricts the mapping to pages whose URL or origin matches. */
  domain?: RegExp;
  codeHasParameter?: number;
  [key: string]: unknown;
};

/** An inline query shown for the word under the cursor or the selection. */
export type InlineQuery = {
  /** The endpoint the query is appended to, or a function building the full URL. */
  url: string | ((query: string) => string);
  headers?: Record<string, string>;
  /** Turns the HTTP response into the content to display. */
  parseResult: (res: unknown) => unknown;
};

/** Maps a key sequence to a function in one mode. */
type Mapkey = (
  keys: string,
  annotation: string | string[],
  // eslint-disable-next-line typescript/no-explicit-any -- user keypress handler of arbitrary signature
  jscode: any,
  options?: MapkeyOptions,
) => void;

/** Maps a key sequence to the action another key sequence already has. */
type Remap = (
  new_keystroke: string,
  old_keystroke: string,
  domain?: RegExp,
  new_annotation?: string,
) => void;

/** Removes the mapping of a key sequence in one mode. */
type Unmap = (keystroke: string, domain?: RegExp) => void;

/** The `api` object a settings snippet receives when it runs as a user script. */
export type UserScriptApi = {
  /** Calls the background `action` with `args`; `callback` receives the response. */
  RUNTIME: <R = unknown>(
    action: string,
    args?: Record<string, unknown> | null,
    callback?: (response: R) => void,
  ) => void;
  /**
   * Adds a search engine reachable from the omnibar and from `search_leader_key` + `alias`.
   *
   * @throws When `alias` contains a non-ASCII character.
   */
  addSearchAlias: (
    alias: string,
    prompt: string,
    search_url: string,
    search_leader_key?: string,
    suggestion_url?: string,
    callback_to_parse_suggestion?: (response: unknown, request: unknown) => unknown,
    only_this_site_key?: string,
    options?: Record<string, unknown>,
  ) => void;
  /** Removes a search engine added by `addSearchAlias`. */
  removeSearchAlias: (
    alias: string,
    search_leader_key?: string,
    only_this_site_key?: string,
  ) => void;
  /** Searches the selected text with the search engine registered under the alias `se`. */
  searchSelectedWith: (
    se: string,
    onlyThisSite?: boolean,
    interactive?: boolean,
    alias?: string,
  ) => void;
  /** Adds a command to the omnibar's command mode. */
  // eslint-disable-next-line typescript/no-explicit-any -- user command callback of arbitrary signature
  addCommand: (name: string, description: string, action: (...args: any[]) => void) => void;
  /** Maps keys in normal mode. */
  mapkey: Mapkey;
  /** Maps keys in insert mode. */
  imapkey: Mapkey;
  /** Maps keys in visual mode. */
  vmapkey: Mapkey;
  /** Remaps keys in normal mode. */
  map: Remap;
  /** Remaps keys in insert mode. */
  imap: Remap;
  /** Remaps keys in lurk mode. */
  lmap: Remap;
  /** Remaps keys in visual mode. */
  vmap: Remap;
  /** Remaps keys in the omnibar. */
  cmap: Remap;
  /** Unmaps keys in normal mode. */
  unmap: Unmap;
  /** Unmaps keys in insert mode. */
  iunmap: Unmap;
  /** Unmaps keys in visual mode. */
  vunmap: Unmap;
  /** Unmaps keys in the omnibar. */
  cunmap: Unmap;
  /** Unmaps every normal-mode key except `keystrokes`. */
  unmapAllExcept: (keystrokes: string[], domain?: RegExp) => void;
  /** @param ignoreSize Counts an element with no drawn size as visible. */
  isElementPartiallyInViewport: (el: Element, ignoreSize?: boolean) => boolean;
  /** @returns The browser family the extension is running in. */
  getBrowserName: () => "Chrome" | "Firefox";
  /** @returns The elements matching `selectorString`, plus those whose text matches `pattern`. */
  getClickableElements: (selectorString: string, pattern?: RegExp) => Element[];
  /**
   * Opens links in new tabs.
   *
   * @param str Newline-separated URLs, a list of URLs, or anchor elements.
   * @param simultaneousness How many tabs open at once; the rest wait for a tab to close.
   */
  tabOpenLink: (str: string | string[] | NodeList, simultaneousness?: number) => void;
  Clipboard: {
    /** Writes text to the clipboard. */
    write: (text: string) => void;
    /** Reads the clipboard; `cb` receives a response whose `data` is the content. */
    read: (cb: (resp: unknown) => void) => void;
  };
  Hints: {
    /** Clicks the elements matching a selector, or the given elements, through hints. */
    click: (links: unknown, force?: boolean) => void;
    /**
     * Shows hints for the elements matching a selector, or for the given elements.
     *
     * @returns `false` when no element was given, otherwise the number of hints created.
     */
    create: (
      cssSelector: unknown,
      onHintKey: (element: HTMLElement, shiftKey: boolean) => void,
      attrs?: Record<string, unknown>,
    ) => false | Promise<number>;
    /** The default `onHintKey`: clicks the element. */
    dispatchMouseClick: (element: HTMLElement) => void;
    /** Overrides the hint style; pass `text` as `mode` for the hints that enter visual mode. */
    style: (css: string, mode?: string) => void;
    /** Sets the characters hints are labelled with. */
    setCharacters: (chars: string) => void;
    /** Labels hints with digits. */
    setNumeric: () => void;
  };
  Normal: {
    /** Feeds keys to normal mode as if they were typed. */
    feedkeys: (keys: string) => void;
    /** Jumps to a vim-like mark. */
    jumpVIMark: (mark: string) => void;
    /** Enters pass-through mode, leaving it after `timeout` milliseconds when given. */
    passThrough: (timeout?: number) => void;
    /**
     * Scrolls the current target.
     *
     * @param type One of `down`, `up`, `pageDown`, `fullPageDown`, `pageUp`, `fullPageUp`, `top`,
     *   `bottom`, `left`, `right`, `leftmost`, `rightmost` and `byRatio`.
     */
    scroll: (type: string) => void;
  };
  Visual: {
    /** Overrides the style of the visual-mode `element`, either `marks` or `cursor`. */
    style: (element: string, style: string) => void;
  };
  Front: {
    /** Registers the inline query run on the word under the cursor or the selection. */
    registerInlineQuery: (args: InlineQuery) => void;
    /**
     * Opens the omnibar.
     *
     * @param args `type` selects the kind of omnibar, such as `Bookmarks`, `History`, `URLs`,
     *   `Tabs`, `SearchEngine` or `Commands`.
     */
    openOmnibar: (args: Record<string, unknown>) => void;
    /**
     * Shows a message in a banner.
     *
     * @param timeout Milliseconds before the banner hides.
     */
    showBanner: (msg: string, timeout?: number) => void;
    /** Shows a message in a popup. */
    showPopup: (msg: string) => void;
  };
};

/** The `settings` object a snippet assigns to; the keys are those documented in the README. */
export type UserScriptSettings = {
  /** Sites matching this have Surfingkeys disabled. */
  blocklistPattern?: RegExp;
  /** Limits hint generation on entering visual mode to `[top, left, bottom, right]`. */
  caretViewport?: [number, number, number, number] | null;
  /** Whether finding in the page and the omnibar is case sensitive. */
  caseSensitive?: boolean;
  /** Detects clickable links in text, which `O` then opens. */
  clickablePat?: RegExp;
  /** Extra CSS selector picking elements for hints mode. */
  clickableSelector?: string;
  /** Whether the cursor goes to the end of an input on entering it, rather than where it was left. */
  cursorAtEndOfInput?: boolean;
  /** Alias of the search engine the omnibar uses by default. */
  defaultSearchEngine?: string;
  /** Whether digits are reserved for repeat counts; `false` allows mapping numeric keys. */
  digitForRepeat?: boolean;
  /** Disables Surfingkeys while the active element matches this pattern. */
  disabledOnActiveElementPattern?: string;
  /** Whether insert mode is kept from activating automatically where `document.body` is editable. */
  editableBodyCare?: boolean;
  /** CSS selector for additional editable elements. */
  editableSelector?: string;
  /** Whether an input may take focus after a mouse click reveals it. */
  enableAutoFocus?: boolean;
  /** Whether emoji completion is on in insert mode. */
  enableEmojiInsertion?: boolean;
  /** Which tab gets focus after the current tab is closed. */
  focusAfterClosed?: "left" | "right" | "last";
  /** Whether the first matched result in the omnibar is focused. */
  focusFirstCandidate?: boolean;
  /** Alignment of hints on their target elements. */
  hintAlign?: "left" | "center" | "right";
  /** Whether to wait for explicit input when only a single hint is available. */
  hintExplicit?: boolean;
  /** Whether the new tab is active after picking a hint while holding shift. */
  hintShiftNonActive?: boolean;
  /** Whether history is listed in most-used order in the omnibar. */
  historyMUOrder?: boolean;
  /** Frame origins skipped when `w` cycles through frames. */
  ignoredFrameHosts?: string[];
  /** Network errors for which Surfingkeys shows its own error page; `["*"]` means all. */
  interceptedErrors?: string[];
  /** Language of the usage popover. */
  language?: string;
  /** Mode to fall back to after yanking text in visual mode; `""` stays put. */
  modeAfterYank?: "" | "Caret" | "Normal";
  /** Origins where a mouse text selection is turned into a query. */
  mouseSelectToQuery?: string[];
  /** Where a new tab is placed. */
  newTabPosition?: "left" | "right" | "first" | "last" | "default";
  /** Matches links that lead to the next page. */
  nextLinkRegex?: RegExp;
  /** Maximum number of items fetched from browser history. */
  omnibarHistoryCacheSize?: number;
  /** How many results the omnibar lists per page. */
  omnibarMaxResults?: number;
  /** Where the omnibar is placed. */
  omnibarPosition?: "middle" | "bottom";
  /** Whether the omnibar shows suggestion URLs. */
  omnibarSuggestion?: boolean;
  /** Milliseconds to wait before querying omnibar suggestions. */
  omnibarSuggestionTimeout?: number;
  /** Matches links that lead to the previous page. */
  prevLinkRegex?: RegExp;
  /** Maximum number of times an action is repeated. */
  repeatThreshold?: number;
  /** Milliseconds before rich hints for a keystroke appear; `0` disables them. */
  richHintsForKeystroke?: number;
  /**
   * Whether to scroll the document when the focused element cannot scroll in the requested
   * direction.
   */
  scrollFallback?: boolean;
  /** Force needed to start continuous scrolling after the initial scroll step. */
  scrollFriction?: number;
  /** Step size of each move by `j`/`k`. */
  scrollStepSize?: number;
  /** Whether the mode status is always shown. */
  showModeStatus?: boolean;
  /** Whether tab indices are shown in tab titles. */
  showTabIndices?: boolean;
  /** Whether a search pattern containing upper case characters becomes case sensitive. */
  smartCase?: boolean;
  /** Whether scrolling keys scroll smoothly. */
  smoothScroll?: boolean;
  /** How many characters after a colon trigger emoji suggestions. */
  startToShowEmoji?: number;
  /** Whether inputs are kept from taking focus when the page loads. */
  stealFocusOnLoad?: boolean;
  /** Separator between the index and the original title of a tab. */
  tabIndicesSeparator?: string;
  /** Whether opened tabs are listed in most-recently-used order in the omnibar. */
  tabsMRUOrder?: boolean;
  /** Number of opened tabs above which the omnibar is used for choosing tabs. */
  tabsThreshold?: number;
  /** CSS applied to the Surfingkeys UI. */
  theme?: string;
  /** Whether the tab picker is vertically aligned. */
  verticalTabs?: boolean;
};
