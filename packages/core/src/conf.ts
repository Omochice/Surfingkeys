/**
 * The live settings bag. User settings are merged in by copying only keys that already exist here,
 * so a new setting must be added both to this type and to the defaults below; the absent index
 * signature is deliberate, making an unknown `conf.foo` a type error rather than silently `any`.
 */
type RuntimeConf = {
  lastKeys: string[];
  blocklistPattern: RegExp | undefined;
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
 * The persisted settings bag exchanged with the background. It is deliberately distinct from
 * {@link RuntimeConf}: this is the wire/storage shape, so regex options arrive as their source
 * strings, and the index signature is honest because arbitrary user-snippet settings are merged
 * in.
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

/** Whether `query` should be matched case-sensitively under the current settings. */
function getCaseSensitive(query: string): boolean {
  return conf.caseSensitive || (conf.smartCase && /[A-Z]/.test(query));
}

export { conf, getCaseSensitive };
