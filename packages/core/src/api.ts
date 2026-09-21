import type { EngineEnv } from "./engineEnv";
import { dispatchSKEvent } from "./events";
import { type FeatureGroup, isFeatureGroup } from "./featureGroup";
import KeyboardUtils from "./keyboardUtils";
import type { Keymap } from "./keymap";
import type { ModeContext } from "./modeGraph";
import { specialKeys } from "./specialKeys";
import Trie from "./trie";
import {
  constructSearchURL,
  getBrowserName,
  getClickableElements,
  initSKFunctionListener,
  isElementPartiallyInViewport,
  mapInMode,
  normalizeAnnotation,
  showBanner,
  showPopup,
} from "./utils";

type ModeWithMappings = { name: string; mappings: Trie };

type KeyTarget = {
  // User keypress handler of arbitrary signature (see mapkey's jscode).
  // eslint-disable-next-line typescript/no-explicit-any
  code: (...args: any[]) => void;
  repeatIgnore?: boolean;
  group?: FeatureGroup;
  annotation?: string | string[];
};
export type MapOptions = {
  /** Help text shown by `?`; omitting it leaves the mapping out of the help. */
  annotation?: string | string[];
  /** Restricts the mapping to pages whose URL or origin matches. */
  domain?: RegExp;
  /** Whether this action can be repeated by the dot command. */
  repeatIgnore?: boolean;
  codeHasParameter?: boolean;
  /** The help section this mapping is listed under; defaults by mode, and Misc for normal mode. */
  group?: FeatureGroup;
};

export type SearchSelectedWithOptions = {
  onlyThisSite?: boolean;
  /** Opens the omnibar on the query instead of searching at once. */
  interactive?: boolean;
  /** Replaces `searchUrl` in interactive mode. */
  alias?: string;
};

export type DomainOptions = {
  domain?: RegExp;
};

export type RemapInModeOptions = DomainOptions & {
  /** Overrides the annotation of `oldKeystroke`. */
  annotation?: string;
};

export type RemapOptions = RemapInModeOptions & {
  /** Only read for a `:command` `oldKeystroke`; a key alias keeps the section of its key. */
  group?: FeatureGroup;
};

export type SearchAliasKeyOptions = {
  /** `<searchLeaderKey><alias>` searches the selection with the engine, without the omnibar. */
  searchLeaderKey?: string;
  /** `<searchLeaderKey><onlyThisSiteKey><alias>` limits that search to the current site. */
  onlyThisSiteKey?: string;
};

export type SearchAliasOptions = SearchAliasKeyOptions & {
  /** The caption shown in front of the omnibar. */
  prompt?: string;
  /** The query is appended to it to fetch the omnibar's suggestions. */
  suggestionUrl?: string;
  /** Turns the response from `suggestionUrl` into the list of suggestions. */
  // User-provided suggestion parser; callers type its response/request for their own engine, which
  // an `unknown` parameter would reject (contravariance).
  // eslint-disable-next-line typescript/no-explicit-any
  parseSuggestion?: (...args: any[]) => unknown;
  skipMaps?: boolean;
  faviconUrl?: string;
};

type MapkeyTarget = {
  mode: ModeWithMappings;
  // The section a mapping of this mode gets when it names none. Visual and Insert each own one,
  // while Normal has no section of its own, because the built-in normal mappings are filed by
  // topic, so its mappings land in Misc rather than under a heading that would misdescribe them.
  defaultGroup: FeatureGroup;
};

function createAPI(ctx: ModeContext, env: EngineEnv) {
  const { clipboard, insert, normal, hints, visual, front } = ctx;
  const { RUNTIME, isInUIFrame, tabOpenLink, log: LOG } = env;
  // registerInlineQuery is exposed as a callable API entry, so it needs a function value rather than
  // a guarded call. The iframe front omits it (inline queries act on the hosting page, which the
  // iframe lacks), so it falls back to a no-op there instead of registering an undefined handler.
  const registerInlineQuery = front.registerInlineQuery ?? (() => {});
  const normalTarget: MapkeyTarget = {
    mode: normal,
    defaultGroup: "misc",
  };
  const visualTarget: MapkeyTarget = {
    mode: visual,
    defaultGroup: "visualMode",
  };
  const insertTarget: MapkeyTarget = {
    mode: insert,
    defaultGroup: "insertMode",
  };
  function createKeyTarget(
    // User keypress handler of arbitrary signature (see mapkey's jscode).
    // eslint-disable-next-line typescript/no-explicit-any
    code: (...args: any[]) => void,
    options: {
      annotation: string | string[] | null;
      group: FeatureGroup | undefined;
      repeatIgnore?: boolean | undefined;
    },
  ): KeyTarget {
    const { annotation, group, repeatIgnore } = options;
    const keybound: KeyTarget = {
      code: code,
    };
    if (repeatIgnore) {
      keybound.repeatIgnore = repeatIgnore;
    }
    if (group != null) {
      keybound.group = group;
    }
    if (annotation != null) {
      keybound.annotation = normalizeAnnotation(annotation);
    }

    return keybound;
  }

  function isDomainApplicable(domain?: RegExp): boolean {
    if (domain == null) {
      return true;
    }
    return domain.test(document.location.href) || domain.test(window.origin);
  }

  function mapkeyInMode(
    target: MapkeyTarget,
    keys: string,
    binding: {
      // User keypress handler of arbitrary signature; `unknown[]` would reject user callbacks that
      // declare typed parameters (e.g. (mark: string) => void).
      // eslint-disable-next-line typescript/no-explicit-any
      jscode: (...args: any[]) => void;
      options?: MapOptions | undefined;
    },
  ): void {
    const { mode, defaultGroup } = target;
    const { jscode } = binding;
    const options = binding.options || {};
    // Left undefined, it would print as "undefined" in the override warning below and in the repeat
    // confirmation.
    const annotation = options.annotation ?? "";
    if (isDomainApplicable(options.domain)) {
      keys = KeyboardUtils.encodeKeystroke(keys);
      const old = mode.mappings.remove(keys);
      if (old) {
        let warning;
        if (old.meta) {
          warning = `${old.meta.word} for [${old.meta.annotation}] is overridden by [${annotation}].`;
        } else {
          warning = old
            .getMetas(() => true)
            .map((meta) => {
              return `${meta.word} for [${meta.annotation}] is overridden by [${annotation}].`;
            });
        }
        LOG("warn", warning);
      } else if (keys.length > 1) {
        let p = keys.slice(0, -1);
        while (p.length > 0) {
          const node = mode.mappings.find(p);
          if (node && node.meta) {
            LOG("warn", `${node.meta.word} for [${node.meta.annotation}] precedes ${keys}.`);
            return;
          }
          p = p.slice(0, -1);
        }
      }
      // A user snippet is plain JavaScript, so a mistyped group reaches here as an ordinary string.
      // Saying so and falling back beats dropping the mapping out of the help without a word.
      const requested = options.group;
      const group = isFeatureGroup(requested) ? requested : defaultGroup;
      if (requested != null && group !== requested) {
        LOG("warn", `${keys} names no help section [${requested}]; listing it under ${group}.`);
      }
      const keybound = createKeyTarget(jscode, {
        annotation,
        group,
        repeatIgnore: options.repeatIgnore,
      });
      mode.mappings.add(keys, keybound);
    }
  }

  /**
   * Create a shortcut in normal mode to execute your own action.
   *
   * @example
   *   mapkey("<Space>", function() {
   *   var btn = document.querySelector("button.ytp-ad-overlay-close-button") || document.querySelector("button.ytp-ad-skip-button") || document.querySelector('ytd-watch-flexy button.ytp-play-button');
   *   btn.click();
   *   }, {annotation: "pause/resume on youtube", domain: /youtube.com/i});
   *
   * @param jscode If it takes a parameter, the next pressed key is fed to it.
   */
  function mapkey(
    keys: string,
    // User keypress handler of arbitrary signature; `unknown[]` would reject user callbacks that
    // declare typed parameters (e.g. (mark: string) => void).
    // eslint-disable-next-line typescript/no-explicit-any
    jscode: (...args: any[]) => void,
    options?: MapOptions,
  ): void {
    mapkeyInMode(normalTarget, keys, { jscode, options });
  }

  /**
   * Create a shortcut in visual mode to execute your own action.
   *
   * @see mapkey
   */
  function vmapkey(
    keys: string,
    // User keypress handler of arbitrary signature; `unknown[]` would reject user callbacks that
    // declare typed parameters (e.g. (mark: string) => void).
    // eslint-disable-next-line typescript/no-explicit-any
    jscode: (...args: any[]) => void,
    options?: MapOptions,
  ): void {
    mapkeyInMode(visualTarget, keys, { jscode, options });
  }

  /**
   * Create a shortcut in insert mode to execute your own action.
   *
   * @see mapkey
   */
  function imapkey(
    keys: string,
    // User keypress handler of arbitrary signature; `unknown[]` would reject user callbacks that
    // declare typed parameters (e.g. (mark: string) => void).
    // eslint-disable-next-line typescript/no-explicit-any
    jscode: (...args: any[]) => void,
    options?: MapOptions,
  ): void {
    mapkeyInMode(insertTarget, keys, { jscode, options });
  }

  /**
   * Map a key sequence to another in normal mode.
   *
   * @example
   *   map(";d", "<Ctrl-Alt-d>");
   *
   * @param {string} newKeystroke A key sequence to replace
   * @param {string} oldKeystroke A key sequence to be replaced
   */
  function map(newKeystroke: string, oldKeystroke: string, options?: RemapOptions): void {
    const { domain, annotation, group } = options ?? {};
    if (isDomainApplicable(domain)) {
      if (oldKeystroke[0] === ":" && oldKeystroke.length > 1) {
        const cmdline = oldKeystroke.slice(1);
        const keybound = createKeyTarget(
          () => {
            if (front.executeCommand == null) {
              LOG("warn", `:${cmdline} is not available in this frame.`);
              return;
            }
            front.executeCommand(cmdline);
          },
          {
            annotation: annotation ?? null,
            // There is no source mapping to take a section from, unlike the alias branch below.
            group: group ?? "misc",
          },
        );
        normal.mappings.add(KeyboardUtils.encodeKeystroke(newKeystroke), keybound);
      } else {
        const specialKey = specialKeys[oldKeystroke];
        if (
          !mapInMode(normal, newKeystroke, oldKeystroke, isInUIFrame(), annotation) &&
          specialKey != null
        ) {
          specialKey.push(newKeystroke);
          dispatchSKEvent("front", ["addMapkey", "Mode", newKeystroke, oldKeystroke]);
        } else {
          LOG("warn", `${oldKeystroke} not found in normal mode.`);
        }
      }
    }
  }

  /**
   * Unmap a key sequence in normal mode.
   *
   * @example
   *   unmap("<<", { domain: /youtube.com/ });
   *
   * @param {string} keystroke A key sequence to be removed.
   */
  function unmap(keystroke: string, options?: DomainOptions): void {
    const { domain } = options ?? {};
    if (isDomainApplicable(domain)) {
      const oldMap = normal.mappings.find(KeyboardUtils.encodeKeystroke(keystroke));
      if (oldMap) {
        normal.mappings.remove(KeyboardUtils.encodeKeystroke(keystroke));
      } else {
        for (const k in specialKeys) {
          const keys = specialKeys[k];
          if (keys == null) {
            continue;
          }
          const idx = keys.indexOf(keystroke);
          if (idx !== -1) {
            keys.splice(idx, 1);
          }
        }
      }
    }
  }

  /**
   * Unmap all keybindings except those specified.
   *
   * @example
   *   unmapAllExcept(["E", "R", "T"], { domain: /google.com|twitter.com/ });
   *
   * @param {array} keystrokes The keybindings you want to keep.
   */
  function unmapAllExcept(keystrokes: string[], options?: DomainOptions): void {
    const { domain } = options ?? {};
    if (isDomainApplicable(domain)) {
      const modes: (ModeWithMappings & { keymap: Pick<Keymap, "reset"> })[] = [normal, insert];
      modes.forEach((mode) => {
        const mappings = new Trie();
        keystrokes = keystrokes || [];
        for (const keystroke of keystrokes) {
          const ks = KeyboardUtils.encodeKeystroke(keystroke);
          const node = mode.mappings.find(ks);
          if (node) {
            mappings.add(ks, node.meta!);
          }
        }
        mode.mappings = mappings;
        mode.keymap.reset();
      });
    }
  }

  /**
   * Map a key sequence to another in insert mode.
   *
   * @param {string} newKeystroke A key sequence to replace
   * @param {string} oldKeystroke A key sequence to be replaced
   * @see map
   */
  function imap(newKeystroke: string, oldKeystroke: string, options?: RemapInModeOptions): void {
    const { domain, annotation } = options ?? {};
    if (isDomainApplicable(domain)) {
      mapInMode(insert, newKeystroke, oldKeystroke, isInUIFrame(), annotation);
    }
  }

  /**
   * Unmap a key sequence in insert mode.
   *
   * @param {string} keystroke A key sequence to be removed.
   * @see unmap
   */
  function iunmap(keystroke: string, options?: DomainOptions): void {
    const { domain } = options ?? {};
    if (isDomainApplicable(domain)) {
      insert.mappings.remove(KeyboardUtils.encodeKeystroke(keystroke));
    }
  }

  /**
   * Map a key sequence to another in omnibar.
   *
   * @param {string} newKeystroke A key sequence to replace
   * @param {string} oldKeystroke A key sequence to be replaced
   * @see map
   */
  function cmap(newKeystroke: string, oldKeystroke: string, options?: DomainOptions): void {
    const { domain } = options ?? {};
    if (isDomainApplicable(domain)) {
      dispatchSKEvent("front", ["addMapkey", "Omnibar", newKeystroke, oldKeystroke]);
    }
  }

  /**
   * Unmap a key sequence in omnibar.
   *
   * @example
   *   cunmap("<Ctrl-j>");
   *
   * @param {string} keystroke A key sequence to be removed.
   * @see unmap
   */
  function cunmap(keystroke: string, options?: DomainOptions): void {
    const { domain } = options ?? {};
    if (isDomainApplicable(domain)) {
      dispatchSKEvent("front", ["removeMapkey", "Omnibar", keystroke]);
    }
  }

  /**
   * Map a key sequence to another in visual mode.
   *
   * @param {string} newKeystroke A key sequence to replace
   * @param {string} oldKeystroke A key sequence to be replaced
   * @see map
   */
  function vmap(newKeystroke: string, oldKeystroke: string, options?: RemapInModeOptions): void {
    const { domain, annotation } = options ?? {};
    if (isDomainApplicable(domain)) {
      mapInMode(visual, newKeystroke, oldKeystroke, isInUIFrame(), annotation);
    }
  }

  /**
   * Unmap a key sequence in visual mode.
   *
   * @param {string} keystroke A key sequence to be removed.
   * @see unmap
   */
  function vunmap(keystroke: string, options?: DomainOptions): void {
    const { domain } = options ?? {};
    if (isDomainApplicable(domain)) {
      visual.mappings.remove(KeyboardUtils.encodeKeystroke(keystroke));
    }
  }

  /**
   * Map a key sequence to another in lurk mode.
   *
   * @param {string} newKeystroke A key sequence to replace
   * @param {string} oldKeystroke A key sequence to be replaced
   * @see map
   */
  function lmap(newKeystroke: string, oldKeystroke: string, options?: DomainOptions): void {
    const { domain } = options ?? {};
    if (isDomainApplicable(domain)) {
      normal.addLurkMap(newKeystroke, oldKeystroke);
    }
  }

  /**
   * Add a search engine alias into Omnibar.
   *
   * @example
   *   addSearchAlias("d", "https://duckduckgo.com/?q=", {
   *     prompt: "duckduckgo",
   *     suggestionUrl: "https://duckduckgo.com/ac/?q=",
   *     parseSuggestion: function (response) {
   *       return JSON.parse(response.text).map(function (r) {
   *         return r.phrase;
   *       });
   *     },
   *   });
   *
   * @param alias Typed in the omnibar and followed by `space` to switch to this engine.
   * @param searchUrl The query is appended, or replaces `{0}` when the URL holds one.
   * @throws When `alias` contains a non-ASCII character.
   */
  function addSearchAlias(alias: string, searchUrl: string, options?: SearchAliasOptions): void {
    if (![...alias].every((c) => c.charCodeAt(0) <= 0x7f)) {
      throw `Invalid alias ${alias}, which must be ASCII characters.`;
    }
    const { prompt = alias, suggestionUrl, parseSuggestion, skipMaps, faviconUrl } = options ?? {};
    const searchLeaderKey = options?.searchLeaderKey || "s";
    const onlyThisSiteKey = options?.onlyThisSiteKey || "o";
    if (!isInUIFrame() && front.addSearchAlias) {
      front.addSearchAlias(alias, searchUrl, {
        prompt,
        suggestionUrl,
        parseSuggestion,
        faviconUrl,
      });
    }
    if (skipMaps) {
      return;
    }
    function ssw() {
      searchSelectedWith(searchUrl);
    }
    mapkey(searchLeaderKey + alias, ssw, {
      annotation: ["Search selected with {0}", prompt],
      group: "searchSelectedWith",
    });
    mapkey(
      "o" + alias,
      () => {
        front.openOmnibar({ type: "SearchEngine", extra: alias });
      },
      { annotation: ["Open Omnibar for {0} Search", prompt], group: "omnibar" },
    );
    vmapkey(searchLeaderKey + alias, ssw);
    function ssw2() {
      searchSelectedWith(searchUrl, { onlyThisSite: true });
    }
    mapkey(searchLeaderKey + onlyThisSiteKey + alias, ssw2);
    vmapkey(searchLeaderKey + onlyThisSiteKey + alias, ssw2);

    const capitalAlias = alias.toUpperCase();
    if (capitalAlias !== alias) {
      const ssw4 = () => {
        searchSelectedWith(searchUrl, { interactive: true, alias });
      };
      mapkey(searchLeaderKey + capitalAlias, ssw4);
      vmapkey(searchLeaderKey + capitalAlias, ssw4);
      const ssw5 = () => {
        searchSelectedWith(searchUrl, { onlyThisSite: true, interactive: true, alias });
      };
      mapkey(searchLeaderKey + onlyThisSiteKey + capitalAlias, ssw5);
      vmapkey(searchLeaderKey + onlyThisSiteKey + capitalAlias, ssw5);
    }
  }

  /**
   * Remove a search engine alias from Omnibar.
   *
   * @example
   *   removeSearchAlias("d");
   *
   * @param {string} alias The alias of the search engine to be removed.
   * @param {string} [searchLeaderKey=s] `<searchLeaderKey><alias>` in normal mode will search
   *   selected text with this search engine directly without opening the omnibar, for example `sd`.
   *   Default is `s`
   * @param {string} [onlyThisSiteKey=o] `<searchLeaderKey><onlyThisSiteKey><alias>` in normal mode
   *   will search selected text within current site with this search engine directly without
   *   opening the omnibar, for example `sod`. Default is `o`
   */
  function removeSearchAlias(
    alias: string,
    searchLeaderKey?: string,
    onlyThisSiteKey?: string,
  ): void {
    if (!isInUIFrame()) {
      front.removeSearchAlias?.(alias);
    }
    unmap((searchLeaderKey || "s") + alias);
    unmap("o" + alias);
    vunmap((searchLeaderKey || "s") + alias);
    unmap((searchLeaderKey || "s") + (onlyThisSiteKey || "o") + alias);
    vunmap((searchLeaderKey || "s") + (onlyThisSiteKey || "o") + alias);
    const capitalAlias = alias.toUpperCase();
    if (capitalAlias !== alias) {
      unmap((searchLeaderKey || "s") + capitalAlias);
      vunmap((searchLeaderKey || "s") + capitalAlias);
      unmap((searchLeaderKey || "s") + (onlyThisSiteKey || "o") + capitalAlias);
      vunmap((searchLeaderKey || "s") + (onlyThisSiteKey || "o") + capitalAlias);
    }
  }

  /**
   * Search selected with.
   *
   * @example
   *   searchSelectedWith("https://translate.google.com/?hl=en#auto/en/");
   */
  function searchSelectedWith(searchUrl: string, options?: SearchSelectedWithOptions): void {
    const { onlyThisSite, interactive, alias } = options ?? {};
    let query = window.getSelection()!.toString();
    clipboard.read((response) => {
      query = query || response.data;
      if (onlyThisSite) {
        query = "site:" + window.location.hostname + " " + query;
      }
      if (interactive) {
        front.openOmnibar({ type: "SearchEngine", extra: alias, initialQuery: query });
      } else {
        tabOpenLink(constructSearchURL(searchUrl, encodeURIComponent(query)));
      }
    });
  }

  initSKFunctionListener("api", {
    addSearchAlias,
    imap,
    map,
    lmap,
    vmap,
    unmap,
    unmapAllExcept,
    iunmap,
    vunmap,
    removeSearchAlias,
    searchSelectedWith,
    "clipboard:write": clipboard.write,
    "clipboard:read": () => {
      clipboard.read((resp) => {
        dispatchSKEvent("user", ["onClipboardRead", resp]);
      });
    },
    "hints:click": hints.click,
    "hints:create": hints.create,
    "hints:setCharacters": hints.setCharacters,
    "hints:setNumeric": hints.setNumeric,
    "hints:style": hints.style,
    "front:registerInlineQuery": registerInlineQuery,
    "front:openOmnibar": front.openOmnibar,
    "normal:feedkeys": normal.feedkeys,
    "normal:jumpVIMark": normal.jumpVIMark,
    "normal:passThrough": normal.passThrough,
    "normal:scroll": normal.scroll,
    "visual:style": visual.style,
    mapkey: (keys: string, options: MapOptions) => {
      if (options.codeHasParameter) {
        mapkey(
          keys,
          (key: string) => {
            dispatchSKEvent("user", ["callUserFunction", `normal:${keys}`, key]);
          },
          options,
        );
      } else {
        mapkey(
          keys,
          () => {
            dispatchSKEvent("user", ["callUserFunction", `normal:${keys}`]);
          },
          options,
        );
      }
    },
    imapkey: (keys: string, options: MapOptions) => {
      imapkey(
        keys,
        () => {
          dispatchSKEvent("user", ["callUserFunction", `insert:${keys}`]);
        },
        options,
      );
    },
    vmapkey: (keys: string, options: MapOptions) => {
      vmapkey(
        keys,
        () => {
          dispatchSKEvent("user", ["callUserFunction", `visual:${keys}`]);
        },
        options,
      );
    },
  });
  return {
    RUNTIME,
    addSearchAlias,
    cmap,
    cunmap,
    imap,
    imapkey,
    isElementPartiallyInViewport,
    getBrowserName,
    getClickableElements,
    lmap,
    map,
    unmap,
    unmapAllExcept,
    iunmap,
    vunmap,
    mapkey,
    removeSearchAlias,
    searchSelectedWith,
    tabOpenLink,
    vmap,
    vmapkey,
    Clipboard: clipboard,
    Normal: {
      feedkeys: normal.feedkeys,
      jumpVIMark: normal.jumpVIMark,
      passThrough: normal.passThrough,
      scroll: normal.scroll,
    },
    Hints: {
      click: hints.click,
      create: hints.create,
      dispatchMouseClick: hints.dispatchMouseClick,
      style: hints.style,
      setNumeric: hints.setNumeric,
      setCharacters: (chars: string) => {
        hints.setCharacters(chars);
        if (front.setHintsCharacters) {
          front.setHintsCharacters(chars);
        }
      },
    },
    Visual: {
      style: visual.style,
    },
    Front: {
      openOmnibar: front.openOmnibar,
      registerInlineQuery,
      showBanner,
      showPopup,
    },
  };
}

/**
 * The user-script / default-mapping API surface: key-mapping helpers, search-alias management, and
 * the `Clipboard`/`Normal`/`Hints`/`Visual`/`Front` namespaces.
 */
export type SurfingkeysApi = ReturnType<typeof createAPI>;

export default createAPI;
