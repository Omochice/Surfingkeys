/**
 * Metadata bound to a complete keystroke sequence in the {@link Trie}. `word` is filled in by
 * {@link Trie.add}, so callers omit it.
 */
export type TrieMeta = {
  word: string;
  annotation?: string | string[];
  feature_group?: number;
  code?: (...args: string[]) => void;
  repeatIgnore?: boolean;
  stopPropagation?: ((key: string) => boolean) | boolean;
};

/**
 * A prefix tree mapping keystroke sequences to their metadata, used for key binding lookup.
 * Children are keyed by single characters; a node carries its own `stem` character and, when it
 * terminates a bound sequence, its `meta`.
 *
 * The implementation is intentionally faithful to the original prototype-based version:
 * matched-prefix reconstruction and branch pruning behave identically.
 */
export default class Trie {
  stem: string | undefined;
  meta: TrieMeta | undefined;
  private children = new Map<string, Trie>();

  constructor(stem?: string, meta?: TrieMeta) {
    this.stem = stem;
    this.meta = meta;
  }

  /** Walk `word` character by character; returns the reached node or `undefined`. */
  find(word: string): Trie | undefined {
    let node: Trie | undefined = this;
    for (const c of word) {
      if (node == null) {
        break;
      }
      node = node.children.get(c);
    }
    return node;
  }

  /** Insert `word`, attaching `meta` (with `meta.word` set to `word`) at its terminal node. */
  add(word: string, meta: Omit<TrieMeta, "word">): void {
    let node: Trie = this;
    for (const c of word) {
      let child = node.children.get(c);
      if (child == null) {
        child = new Trie(c);
        node.children.set(c, child);
      }
      node = child;
    }
    node.meta = { ...meta, word };
  }

  /**
   * Remove `word` and prune ancestor nodes that become empty as a result. Returns the removed
   * terminal node, or `undefined` if `word` was absent.
   */
  remove(word: string): Trie | undefined {
    const ancestors: Trie[] = [];
    let node: Trie | undefined = this;
    for (const c of word) {
      if (node == null) {
        break;
      }
      ancestors.push(node);
      node = node.children.get(c);
    }
    if (node != null) {
      let i = ancestors.length - 1;
      let parent = ancestors[i];
      if (parent == null) {
        return node;
      }
      parent.children.delete(node.stem!);
      while (parent !== this && parent.children.size === 0 && parent.meta == null) {
        const grandparent = ancestors[--i];
        if (grandparent == null) {
          break;
        }
        grandparent.children.delete(parent.stem!);
        parent = grandparent;
      }
    }
    return node;
  }

  /** List every complete word stored at or below this node. */
  getWords(prefix = "", withoutStem = false): string[] {
    const base = prefix + (withoutStem ? "" : (this.stem ?? ""));
    const words: string[] = [];
    if (this.meta != null) {
      words.push(base);
    }
    for (const child of this.children.values()) {
      words.push(...child.getWords(base));
    }
    return words;
  }

  /** Collect every meta at or below this node that satisfies `criterion`. */
  getMetas(criterion: (meta: TrieMeta) => boolean): TrieMeta[] {
    const metas: TrieMeta[] = [];
    if (this.meta != null && criterion(this.meta)) {
      metas.push(this.meta);
    }
    for (const child of this.children.values()) {
      metas.push(...child.getMetas(criterion));
    }
    return metas;
  }

  /**
   * Reconstruct the keystroke prefix matched up to this node. All words completing from here share
   * the same prefix, so any descent yields the same result: the first `depth` characters of a
   * completing word.
   */
  getPrefixWord(): string {
    // A node without a stem is the trie's root — no character was swallowed to
    // reach it, so the matched prefix is empty regardless of what descends from
    // it.
    if (this.stem == null) {
      return "";
    }
    let fullWord = "";
    let suffix = this.stem ?? "";
    let node: Trie = this;
    while (fullWord === "") {
      if (node.meta != null) {
        fullWord = node.meta.word;
        break;
      }
      const firstChild = node.children.values().next().value;
      if (firstChild == null) {
        break;
      }
      suffix += firstChild.stem ?? "";
      node = firstChild;
    }
    return fullWord.slice(0, fullWord.length - suffix.length + 1);
  }
}
