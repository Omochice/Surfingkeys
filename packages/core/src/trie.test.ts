import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import Trie from "./trie";

describe("Trie", () => {
  it("stores a word and finds it with its meta", () => {
    const trie = new Trie();
    trie.add("go", { annotation: "open" });

    const node = trie.find("go");
    expect(node?.meta?.annotation).toBe("open");
    expect(node?.meta?.word).toBe("go");
  });

  it("returns undefined for an unknown word", () => {
    const trie = new Trie();
    trie.add("go", {});

    expect(trie.find("gone")).toBeUndefined();
    expect(trie.find("x")).toBeUndefined();
  });

  it("lists every word that was added", () => {
    const trie = new Trie();
    trie.add("go", {});
    trie.add("gt", {});

    expect(trie.getWords().toSorted()).toEqual(["go", "gt"]);
  });

  it("collects metas matching a criterion", () => {
    const trie = new Trie();
    trie.add("go", { annotation: "A" });
    trie.add("gt", { annotation: "B" });

    const all = trie.getMetas(() => true).map((m) => m.annotation);
    expect(all.toSorted()).toEqual(["A", "B"]);

    const some = trie.getMetas((m) => m.annotation === "B");
    expect(some.map((m) => m.word)).toEqual(["gt"]);
  });

  it("reconstructs the matched prefix via getPrefixWord", () => {
    const trie = new Trie();
    trie.add("abc", {});

    expect(trie.find("a")?.getPrefixWord()).toBe("a");
    expect(trie.find("ab")?.getPrefixWord()).toBe("ab");
  });

  it("returns an empty string when getPrefixWord is called on an empty root", () => {
    // No char was swallowed by a partial match, so the prefix to re-insert is
    // empty. Insert-mode's fallback (insert.ts) relies on this: when a key
    // from the mappings root fails to match, last.getPrefixWord() must be ""
    // so the fallback inserts nothing.
    expect(new Trie().getPrefixWord()).toBe("");
  });

  it("returns an empty string when getPrefixWord is called on a root with one mapping", () => {
    // The first mapping registered under the root would otherwise leak its
    // encoded keystroke (the first child's meta.word) back through the
    // fallback — e.g. insert mode registers <Ctrl-e> first, which encodes to
    // U+2651 (♑), and every unmapped key would prepend ♑ to the input.
    const trie = new Trie();
    trie.add("abc", {});

    expect(trie.getPrefixWord()).toBe("");
  });

  it("returns an empty string when getPrefixWord is called on a root with multiple mappings", () => {
    const trie = new Trie();
    trie.add("abc", {});
    trie.add("xyz", {});

    expect(trie.getPrefixWord()).toBe("");
  });

  it("removes a stored word and prunes empty branches", () => {
    const trie = new Trie();
    trie.add("abc", {});
    trie.add("abd", {});

    expect(trie.remove("abc")).toBeTruthy();
    expect(trie.find("abc")).toBeUndefined();
    // the shared "ab" branch survives because "abd" still uses it
    expect(trie.find("ab")).toBeTruthy();
    expect(trie.find("abd")).toBeTruthy();

    trie.remove("abd");
    // now the whole branch is gone
    expect(trie.find("ab")).toBeUndefined();
    expect(trie.find("a")).toBeUndefined();
  });
});

describe("Trie — properties", () => {
  // A small alphabet so generated words share prefixes, exercising branch reuse.
  const letter = fc.constantFrom("a", "b", "c", "d", "g", "o", "t", "x", "y", "z");
  const word = fc.array(letter, { minLength: 1, maxLength: 6 }).map((cs) => cs.join(""));
  // Fixed-length words are prefix-free: no word is a prefix of another, so
  // removing one never prunes a branch another word depends on.
  const fixedWord = fc.array(letter, { minLength: 3, maxLength: 3 }).map((cs) => cs.join(""));
  const wordSet = fc.uniqueArray(word, { minLength: 1, maxLength: 12 });

  it("finds every added word with meta.word set to that word", () => {
    fc.assert(
      fc.property(wordSet, (words) => {
        const trie = new Trie();
        for (const w of words) {
          trie.add(w, {});
        }
        for (const w of words) {
          expect(trie.find(w)?.meta?.word).toBe(w);
        }
      }),
    );
  });

  it("lists exactly the set of added words", () => {
    fc.assert(
      fc.property(wordSet, (words) => {
        const trie = new Trie();
        for (const w of words) {
          trie.add(w, {});
        }
        expect(trie.getWords().toSorted()).toStrictEqual(words.toSorted());
      }),
    );
  });

  it("collects one meta per added word via getMetas", () => {
    fc.assert(
      fc.property(wordSet, (words) => {
        const trie = new Trie();
        for (const w of words) {
          trie.add(w, {});
        }
        const found = trie.getMetas(() => true).map((m) => m.word);
        expect(found.toSorted()).toStrictEqual(words.toSorted());
      }),
    );
  });

  it("removing one prefix-free word leaves every other word intact", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fixedWord, { minLength: 2, maxLength: 12 }),
        fc.nat(),
        (words, idx) => {
          const target = words[idx % words.length];
          const trie = new Trie();
          for (const w of words) {
            trie.add(w, {});
          }
          trie.remove(target);

          expect(trie.find(target)?.meta).toBeUndefined();
          const remaining = words.filter((w) => w !== target);
          for (const w of remaining) {
            expect(trie.find(w)?.meta?.word).toBe(w);
          }
          expect(trie.getWords().toSorted()).toStrictEqual(remaining.toSorted());
        },
      ),
    );
  });

  it("getPrefixWord on the root of a non-empty trie is always empty", () => {
    fc.assert(
      fc.property(wordSet, (words) => {
        const trie = new Trie();
        for (const w of words) {
          trie.add(w, {});
        }
        expect(trie.getPrefixWord()).toBe("");
      }),
    );
  });

  it("getPrefixWord on a prefix node of a single word reconstructs that prefix", () => {
    fc.assert(
      fc.property(word, (w) => {
        const trie = new Trie();
        trie.add(w, {});
        for (let k = 1; k <= w.length; k++) {
          const prefix = w.slice(0, k);
          expect(trie.find(prefix)?.getPrefixWord()).toBe(prefix);
        }
      }),
    );
  });
});
