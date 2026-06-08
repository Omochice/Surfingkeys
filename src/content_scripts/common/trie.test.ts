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
