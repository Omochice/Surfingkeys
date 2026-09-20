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
  isElementPartiallyInViewport: (el: Element, ignoreSize?: boolean) => boolean;
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
    write: (text: string) => void;
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
    dispatchMouseClick: (element: HTMLElement) => void;
    /** Overrides the hint style; `mode` selects which kind of hints it applies to. */
    style: (css: string, mode?: string) => void;
    /** Sets the characters hints are labelled with. */
    setCharacters: (chars: string) => void;
    /** Labels hints with digits. */
    setNumeric: () => void;
  };
  Normal: {
    /** Feeds keys to normal mode as if they were typed. */
    feedkeys: (keys: string) => void;
    jumpVIMark: (mark: string) => void;
    /** Enters pass-through mode, leaving it after `timeout` milliseconds when given. */
    passThrough: (timeout?: number) => void;
    scroll: (type: string) => void;
  };
  Visual: {
    /** Overrides the style of the visual-mode `element`, either `marks` or `cursor`. */
    style: (element: string, style: string) => void;
  };
  Front: {
    registerInlineQuery: (args: InlineQuery) => void;
    openOmnibar: (args: Record<string, unknown>) => void;
    /** @param timeout Milliseconds before the banner hides. */
    showBanner: (msg: string, timeout?: number) => void;
    showPopup: (msg: string) => void;
  };
};

/** The `settings` object a snippet assigns to; the keys are those documented in the README. */
export type UserScriptSettings = {
  blocklistPattern?: RegExp;
  /** Caret-mode viewport as `[left, top, width, height]`. */
  caretViewport?: number[] | null;
  caseSensitive?: boolean;
  clickablePat?: RegExp;
  clickableSelector?: string;
  cursorAtEndOfInput?: boolean;
  defaultSearchEngine?: string;
  digitForRepeat?: boolean;
  disabledOnActiveElementPattern?: string;
  editableBodyCare?: boolean;
  editableSelector?: string;
  enableAutoFocus?: boolean;
  enableEmojiInsertion?: boolean;
  focusAfterClosed?: "left" | "right" | "last";
  focusFirstCandidate?: boolean;
  hintAlign?: "left" | "center" | "right";
  hintExplicit?: boolean;
  hintShiftNonActive?: boolean;
  historyMUOrder?: boolean;
  ignoredFrameHosts?: string[];
  interceptedErrors?: string[];
  language?: string;
  modeAfterYank?: "" | "Caret" | "Normal";
  mouseSelectToQuery?: string[];
  newTabPosition?: "left" | "right" | "first" | "last" | "default";
  nextLinkRegex?: RegExp;
  omnibarHistoryCacheSize?: number;
  omnibarMaxResults?: number;
  omnibarPosition?: "middle" | "bottom";
  omnibarSuggestion?: boolean;
  omnibarSuggestionTimeout?: number;
  prevLinkRegex?: RegExp;
  repeatThreshold?: number;
  richHintsForKeystroke?: number;
  scrollFallback?: boolean;
  scrollFriction?: number;
  scrollStepSize?: number;
  showModeStatus?: boolean;
  showTabIndices?: boolean;
  smartCase?: boolean;
  smoothScroll?: boolean;
  startToShowEmoji?: number;
  stealFocusOnLoad?: boolean;
  tabIndicesSeparator?: string;
  tabsMRUOrder?: boolean;
  tabsThreshold?: number;
  /** CSS applied to the Surfingkeys UI. */
  theme?: string;
  verticalTabs?: boolean;
};
