import KeyboardUtils from "./keyboardUtils";
import { RUNTIME, dispatchSKEvent, runtime } from "./runtime";
import { isSpecialKeyOf } from "./specialKeys";
import type Trie from "./trie";
import type { TrieMeta } from "./trie";

/**
 * Structural key event — satisfied by real Events via the globals.d.ts augmentation, and by bare
 * object literals in tests.
 */
export type KeyEventLike = {
  readonly isTrusted: boolean;
  sk_keyName?: string | undefined;
  sk_stopPropagation?: boolean | undefined;
  sk_suppressed?: boolean | undefined;
};

export type KeymapOptions = {
  /**
   * Opt in to vim-style numeric repeat prefixes. Only Normal and Visual count digits; with the
   * option unset `repeats` stays undefined and digits are looked up as ordinary keys.
   */
  enableRepeats?: boolean;
  /**
   * Invoked when a complete mapping executes (or when a pending mapping receives its argument key),
   * with the matched node's meta so callers can read flags such as `repeatIgnore`.
   */
  onKeysExecuted?: (keys: string, meta: TrieMeta) => void;
};

export type Keymap = {
  /** Live view of the owning controller's root trie. */
  readonly mappings: Trie;
  /** "" when idle, the accumulated digits mid-count; undefined when repeats are disabled. */
  readonly repeats: string | undefined;
  /** The node the in-flight key sequence is parked on (the root when idle). */
  getCurrentNode(): Trie;
  /** Feed one key event through the mapping state machine; returns whether an action completed. */
  handleKey(event: KeyEventLike, onNoMatched?: (last: Trie) => void): boolean;
  /** Reset the sequence/pending/repeat state, telling the front to hide the keystroke hint. */
  finish(): boolean;
  /**
   * Silently discard the in-flight state (cursor, pending argument mapping, repeat digits) for when
   * the owning controller replaces its root trie wholesale (api.ts unmapAllExcept). Unlike
   * {@link finish} it never notifies the front (no hideKeystroke).
   */
  reset(): void;
};

function callStopPropagation(meta: TrieMeta, key: string): boolean {
  return typeof meta.stopPropagation === "function"
    ? meta.stopPropagation(key)
    : !!meta.stopPropagation;
}

/**
 * Create the key-mapping state machine formerly carried by Mode's optional slots and the static
 * handleMapKey/finish. The root trie stays owned by the caller and is read through `getRoot`, so
 * replacing the root (api.ts unmapAllExcept) cannot desynchronize the keymap.
 */
export function createKeymap(getRoot: () => Trie, opts?: KeymapOptions): Keymap {
  // null means "parked on the root". The root is re-read through getRoot on demand (never
  // captured), so the keymap can be created before the controller that owns the trie is
  // fully assembled, and a wholesale root replacement is picked up transparently.
  let currentNode: Trie | null = null;
  let repeats: string | undefined = opts?.enableRepeats ? "" : undefined;
  let pendingMap: ((key: string) => void) | null = null;
  let isTrustedEvent = false;

  function finish(): boolean {
    let ret = false;
    if (currentNode != null || pendingMap != null || repeats) {
      currentNode = null;
      pendingMap = null;
      isTrustedEvent && dispatchSKEvent("front", ["hideKeystroke"]);
      if (repeats) {
        repeats = "";
      }
      ret = true;
    }
    return ret;
  }

  function handleKey(event: KeyEventLike, onNoMatched?: (last: Trie) => void): boolean {
    let key = event.sk_keyName ?? "";
    isTrustedEvent = event.isTrusted;

    const isEscKey = isSpecialKeyOf("<Esc>", key);
    if (isEscKey) {
      key = KeyboardUtils.encodeKeystroke("<Esc>");
    }

    let actionDone = false;
    if (isEscKey && finish()) {
      event.sk_stopPropagation = true;
      event.sk_suppressed = true;
      actionDone = true;
    } else if (pendingMap) {
      const meta = currentNode!.meta!;
      opts?.onKeysExecuted?.(meta.word + key, meta);
      const pf = pendingMap;
      event.sk_stopPropagation = !meta.stopPropagation || callStopPropagation(meta, key);
      pf(key);
      actionDone = finish();
    } else if (
      repeats != null &&
      currentNode == null &&
      runtime.conf.digitForRepeat &&
      (key >= "1" || (repeats !== "" && key >= "0")) &&
      key <= "9" &&
      getRoot().getWords().length > 0
    ) {
      // reset only after target action executed or cancelled
      repeats += key;
      isTrustedEvent && dispatchSKEvent("front", ["showKeystroke", key, keymap]);
      event.sk_stopPropagation = true;
    } else {
      const last = currentNode ?? getRoot();
      currentNode = last.find(key) ?? null;
      if (!currentNode) {
        onNoMatched?.(last);
        event.sk_suppressed = last !== getRoot();
        actionDone = finish();
      } else if (currentNode.meta) {
        const meta = currentNode.meta;
        const code = meta.code;
        if (code && code.length) {
          // bound function needs arguments
          pendingMap = code;
          isTrustedEvent && dispatchSKEvent("front", ["showKeystroke", key, keymap]);
          event.sk_stopPropagation = true;
        } else {
          opts?.onKeysExecuted?.(meta.word, meta);
          RUNTIME.repeats = Number.parseInt(repeats ?? "", 10) || 1;
          event.sk_stopPropagation = !meta.stopPropagation || callStopPropagation(meta, key);
          if (RUNTIME.repeats > runtime.conf.repeatThreshold) {
            dispatchSKEvent("front", [
              "showDialog",
              `Do you really want to repeat this action (${meta.annotation}) ${RUNTIME.repeats} times?`,
              () => {
                while (RUNTIME.repeats > 0) {
                  code!();
                  RUNTIME.repeats--;
                }
              },
            ]);
          } else {
            while (RUNTIME.repeats > 0) {
              code!();
              RUNTIME.repeats--;
            }
          }
          actionDone = finish();
        }
      } else {
        isTrustedEvent && dispatchSKEvent("front", ["showKeystroke", key, keymap]);
        event.sk_stopPropagation = true;
      }
    }
    return actionDone;
  }

  const keymap: Keymap = {
    get mappings() {
      return getRoot();
    },
    get repeats() {
      return repeats;
    },
    getCurrentNode() {
      return currentNode ?? getRoot();
    },
    handleKey,
    finish,
    reset() {
      currentNode = null;
      // The pending code and the counted digits belong to the replaced root.
      pendingMap = null;
      if (repeats) {
        repeats = "";
      }
    },
  };

  return keymap;
}
