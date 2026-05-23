import { describe, expect, it } from "vitest";
import Trie from "../src/content_scripts/common/trie.js";

describe("Trie", () => {
    it("stores a word and finds it with its meta", () => {
        const trie = new Trie();
        trie.add("go", { annotation: "open" });

        const node = trie.find("go");
        expect(node?.meta?.annotation).toBe("open");
        expect(node?.meta?.word).toBe("go");
    });

    it("lists every word that was added", () => {
        const trie = new Trie();
        trie.add("go", {});
        trie.add("gt", {});

        expect(trie.getWords().sort()).toEqual(["go", "gt"]);
    });

    it("removes a stored word", () => {
        const trie = new Trie();
        trie.add("x", {});

        expect(trie.remove("x")).toBeTruthy();
        expect(trie.find("x")).toBeFalsy();
    });
});
