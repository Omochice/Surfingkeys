/**
 * The live settings bag shared across every content-script module as {@link runtime.conf}. The
 * object literal below is the default value of each field; user settings are merged in by
 * {@link applySettings} (content.ts), which copies only keys that already exist here. Adding a
 * setting therefore means adding it both to this interface and to the defaults — there is no index
 * signature on purpose, so an unknown `conf.foo` is a type error rather than silently `any`.
 */
type RuntimeConf = {
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
  /**
   * Patterns matched against the page URL to locate the page-number segment for prev/next link
   * navigation.
   */
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
};

/**
 * The persisted settings bag exchanged with the background over the
 * `getSettings`/`updateSettings`/`settingsUpdated` messages and rendered by the options page. It is
 * deliberately distinct from {@link RuntimeConf}: this is the **wire/storage** shape, so regex
 * options arrive as their source strings (hydrated into RegExp by `applySettings`/`ensureRegex` in
 * content.ts) and it carries UI/meta fields that are not part of the live config. The index
 * signature is honest — the background merges arbitrary user-snippet settings and its own
 * bookkeeping keys — while the named fields are the ones the content scripts and options page
 * actually read.
 */
export type StoredSettings = {
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
};

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

/**
 * Whether a search query should be matched case-sensitively, honouring the `caseSensitive` and
 * `smartCase` settings (smart case treats a query containing an uppercase letter as sensitive).
 */
function getCaseSensitive(query: string): boolean {
  return conf.caseSensitive || (conf.smartCase && /[A-Z]/.test(query));
}

export { conf, getCaseSensitive };
