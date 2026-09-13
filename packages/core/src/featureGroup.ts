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
