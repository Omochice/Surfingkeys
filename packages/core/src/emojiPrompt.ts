import * as v from "valibot";

import CursorPrompt from "./cursorPrompt";
import { htmlEncode } from "./utils";

type EmojiEntry = [emoji: string, slug: string, name: string];

const emojiDataSchema = v.array(v.tuple([v.string(), v.string(), v.string()]));

/** Build the CursorPrompt that completes emoji names against the JSON fetched from `emojiURL`. */
export function createEmojiPrompt(emojiURL: string): CursorPrompt<EmojiEntry> {
  return new CursorPrompt<EmojiEntry>({
    renderer: ([emoji, , name]) => `<div><span>${emoji}</span>${htmlEncode(name)}</div>`,
    picker: (elm: Element) => {
      const child = elm.firstElementChild;
      return child instanceof HTMLElement ? child.innerText : "";
    },
    // Users type the CLDR slug (e.g. "grinning_face"), not the display name, so match on it alone.
    matches: ([, slug], query) => slug.includes(query),
    fetcher: () =>
      fetch(emojiURL)
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Failed to fetch emoji data: ${res.status}`);
          }
          return res.json();
        })
        .then((json: unknown) => v.parse(emojiDataSchema, json)),
  });
}
