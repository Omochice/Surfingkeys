import CursorPrompt from "./cursorPrompt";

/** Build the CursorPrompt that completes emoji names against the tsv fetched from `emojiURL`. */
export function createEmojiPrompt(emojiURL: string): CursorPrompt {
  return new CursorPrompt({
    renderer: (c: string) => {
      const fields = c.split("\t");
      const codepoints = fields[0];
      if (codepoints == null) {
        return "";
      }
      const parsedUnicodeEmoji = String.fromCodePoint(...codepoints.split(",").map(Number));
      return `<div><span>${parsedUnicodeEmoji}</span>${fields[1]}</div>`;
    },
    picker: (elm: Element) => {
      const child = elm.firstElementChild;
      return child instanceof HTMLElement ? child.innerText : "";
    },
    fetcher: () =>
      new Promise<string[]>((r) => {
        fetch(emojiURL)
          .then((res) => res.text())
          .then((text) => {
            r(text.split("\n"));
          });
      }),
  });
}
