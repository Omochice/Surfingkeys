/**
 * The help sections a key mapping can be filed under, in the order the help popover shows them.
 *
 * Reordering this list reorders the popover and nothing else, because a mapping names its section
 * by key rather than by position. Adding a section means adding one entry, with no second table to
 * keep in step.
 */
export const featureGroups = [
  { key: "help", title: "Help" },
  { key: "mouseClick", title: "Mouse Click" },
  { key: "scroll", title: "Scroll Page / Element" },
  { key: "tabs", title: "Tabs" },
  { key: "pageNavigation", title: "Page Navigation" },
  { key: "sessions", title: "Sessions" },
  { key: "searchSelectedWith", title: "Search selected with" },
  { key: "clipboard", title: "Clipboard" },
  { key: "omnibar", title: "Omnibar" },
  { key: "visualMode", title: "Visual Mode" },
  { key: "marks", title: "vim-like marks" },
  { key: "settings", title: "Settings" },
  { key: "chromeUrls", title: "Chrome URLs" },
  { key: "misc", title: "Misc" },
  { key: "insertMode", title: "Insert Mode" },
  { key: "lurkMode", title: "Lurk Mode" },
  { key: "regionalHintsMode", title: "Regional Hints Mode" },
] as const;

/** The key naming one of the {@link featureGroups} sections. */
export type FeatureGroup = (typeof featureGroups)[number]["key"];

/** Whether the value names one of the {@link featureGroups} sections. */
export function isFeatureGroup(value: unknown): value is FeatureGroup {
  return typeof value === "string" && featureGroups.some((group) => group.key === value);
}

/**
 * The numbers the legacy `#N` annotation prefix used, written out rather than derived from the
 * order above so that reordering the list cannot silently change what an existing `#N` means.
 *
 * Only the `#N` parser still reads this, and it goes away with that prefix.
 */
const legacyNumbers: Record<number, FeatureGroup> = {
  0: "help",
  1: "mouseClick",
  2: "scroll",
  3: "tabs",
  4: "pageNavigation",
  5: "sessions",
  6: "searchSelectedWith",
  7: "clipboard",
  8: "omnibar",
  9: "visualMode",
  10: "marks",
  11: "settings",
  12: "chromeUrls",
  13: "misc",
  14: "insertMode",
  15: "lurkMode",
  16: "regionalHintsMode",
};

/** The section a legacy `#N` annotation prefix named. */
export function featureGroupFromLegacyNumber(n: number): FeatureGroup | undefined {
  return legacyNumbers[n];
}
