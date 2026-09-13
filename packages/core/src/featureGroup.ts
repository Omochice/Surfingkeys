/**
 * The help sections a key mapping can be filed under, as the numbers the mapping actually carries.
 *
 * The numbers are a published interface: a user snippet may set one through the `#N` annotation
 * prefix documented in the README, so an existing group must keep its number forever and a new
 * group takes the next unused one.
 */
export const FeatureGroup = {
  help: 0,
  mouseClick: 1,
  scroll: 2,
  tabs: 3,
  pageNavigation: 4,
  sessions: 5,
  searchSelectedWith: 6,
  clipboard: 7,
  omnibar: 8,
  visualMode: 9,
  marks: 10,
  settings: 11,
  chromeUrls: 12,
  misc: 13,
  insertMode: 14,
  lurkMode: 15,
  regionalHintsMode: 16,
} as const;

/** The number of one of the {@link FeatureGroup} sections. */
export type FeatureGroup = (typeof FeatureGroup)[keyof typeof FeatureGroup];
