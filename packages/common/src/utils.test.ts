import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { filterByTitleOrUrl, regexFromString } from "./utils";

// Characters drawn for "search words": regular characters mixed with every
// regex metacharacter, so the escaping in regexFromString is exercised.
const wordChar = fc.constantFrom(
  "a",
  "b",
  "c",
  "Z",
  "0",
  "9",
  "|",
  "\\",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  "^",
  "$",
  "+",
  "*",
  "?",
  ".",
);

// A token with no whitespace: regexFromString splits queries on whitespace, so
// staying whitespace-free keeps a token a single lookahead term.
const word = fc.array(wordChar).map((cs) => cs.join(""));

const urlItem = fc.record({
  title: fc.option(fc.string(), { nil: undefined }),
  url: fc.option(fc.string(), { nil: undefined }),
});

describe("regexFromString", () => {
  it("never throws for arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), fc.boolean(), (str, caseSensitive, highlight) => {
        expect(() => regexFromString(str, caseSensitive, highlight)).not.toThrow();
      }),
    );
  });

  it("matches metacharacters literally rather than as a pattern", () => {
    fc.assert(
      fc.property(word, word, word, fc.boolean(), (prefix, w, suffix, caseSensitive) => {
        const rxp = regexFromString(w, caseSensitive, false);
        expect(rxp.test(prefix + w + suffix)).toBe(true);
      }),
    );
  });
});

describe("filterByTitleOrUrl", () => {
  it("returns a subset of the input preserving order", () => {
    fc.assert(
      fc.property(fc.array(urlItem), fc.string(), fc.boolean(), (urls, query, caseSensitive) => {
        const result = filterByTitleOrUrl(urls, query, caseSensitive);
        expect(result.length).toBeLessThanOrEqual(urls.length);
        // Every survivor keeps its original relative position.
        expect(result).toStrictEqual(urls.filter((u) => result.includes(u)));
      }),
    );
  });

  it("returns every item when the query is empty or absent", () => {
    fc.assert(
      fc.property(fc.array(urlItem), fc.boolean(), (urls, caseSensitive) => {
        expect(filterByTitleOrUrl(urls, "", caseSensitive)).toStrictEqual(urls);
        expect(filterByTitleOrUrl(urls, undefined, caseSensitive)).toStrictEqual(urls);
      }),
    );
  });

  it("keeps exactly the items whose title or url matches the query", () => {
    fc.assert(
      fc.property(
        fc.array(urlItem),
        fc.string({ minLength: 1 }),
        fc.boolean(),
        (urls, query, caseSensitive) => {
          const result = filterByTitleOrUrl(urls, query, caseSensitive);
          const rxp = regexFromString(query, caseSensitive, false);
          const matches = (item: { title?: string; url?: string }) =>
            rxp.test(item.title ?? "") || rxp.test(item.url ?? "");
          for (const item of result) {
            expect(matches(item)).toBe(true);
          }
          for (const item of urls.filter((u) => !result.includes(u))) {
            expect(matches(item)).toBe(false);
          }
        },
      ),
    );
  });
});
