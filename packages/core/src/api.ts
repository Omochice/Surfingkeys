import type { EngineEnv } from "./engineEnv";
import { dispatchSKEvent } from "./events";
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
  parseAnnotation,
  showBanner,
  showPopup,
} from "./utils";

type ModeWithMappings = { name: string; mappings: Trie };

type KeyTarget = {
  // User keypress handler of arbitrary signature (see mapkey's jscode).
  // eslint-disable-next-line typescript/no-explicit-any
  code: (...args: any[]) => void;
  repeatIgnore?: boolean;
  feature_group?: number;
  annotation?: string | string[];
};
type Annotation = { annotation: string | string[]; feature_group?: number };
export type MapOptions = { domain?: RegExp; repeatIgnore?: boolean; codeHasParameter?: boolean };

function createAPI(ctx: ModeContext, env: EngineEnv) {
  const { clipboard, insert, normal, hints, visual, front } = ctx;
  const { RUNTIME, isInUIFrame, tabOpenLink, log: LOG } = env;
  // registerInlineQuery is exposed as a callable API entry, so it needs a function value rather than
  // a guarded call. The iframe front omits it (inline queries act on the hosting page, which the
  // iframe lacks), so it falls back to a no-op there instead of registering an undefined handler.
  const registerInlineQuery = front.registerInlineQuery ?? (() => {});
  function createKeyTarget(
    // User keypress handler of arbitrary signature (see mapkey's jscode).
    // eslint-disable-next-line typescript/no-explicit-any
    code: (...args: any[]) => void,
    ag: Annotation | null,
    repeatIgnore?: boolean,
  ): KeyTarget {
    const keybound: KeyTarget = {
      code: code,
    };
    if (repeatIgnore) {
      keybound.repeatIgnore = repeatIgnore;
    }
    if (ag) {
      ag = parseAnnotation(ag);
      if (ag.feature_group != null) {
        keybound.feature_group = ag.feature_group;
      }
      keybound.annotation = ag.annotation;
    }

    return keybound;
  }

  function isDomainApplicable(domain?: RegExp | number): boolean {
    // A falsy domain (undefined or the legacy 0 sentinel) means "applies everywhere".
    if (!domain || typeof domain === "number") {
      return true;
    }
    return domain.test(document.location.href) || domain.test(window.origin);
  }

  function mapkeyInMode(
    mode: ModeWithMappings,
    keys: string,
    annotation: string | string[],
    // User keypress handler of arbitrary signature; `unknown[]` would reject user callbacks that
    // declare typed parameters (e.g. (mark: string) => void).
    // eslint-disable-next-line typescript/no-explicit-any
    jscode: (...args: any[]) => void,
    options?: MapOptions,
  ): void {
    options = options || {};
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
      const keybound = createKeyTarget(
        jscode,
        { annotation: annotation, feature_group: mode === visual ? 9 : 14 },
        options.repeatIgnore,
      );
      mode.mappings.add(keys, keybound);
    }
  }

  /**
   * Create a shortcut in normal mode to execute your own action.
   *
   * @example
   *   mapkey("<Space>", "pause/resume on youtube", function() {
   *   var btn = document.querySelector("button.ytp-ad-overlay-close-button") || document.querySelector("button.ytp-ad-skip-button") || document.querySelector('ytd-watch-flexy button.ytp-play-button');
   *   btn.click();
   *   }, {domain: /youtube.com/i});
   *
   * @param {string} keys The key sequence for the shortcut.
   * @param {string} annotation A help message to describe the action, which will displayed in help
   *   opened by `?`.
   * @param {function} jscode A Javascript function to be bound. If the function needs an argument,
   *   next pressed key will be fed to the function.
   * @param {object} [options=null] `domain`: regex, a Javascript regex pattern to identify the
   *   domains that this mapping works, for example, `/github\.com/i` says that this mapping works
   *   only for github.com, `repeatIgnore`: boolean, whether this action can be repeated by dot
   *   command. Default is `null`
   */
  function mapkey(
    keys: string,
    annotation: string | string[],
    // User keypress handler of arbitrary signature; `unknown[]` would reject user callbacks that
    // declare typed parameters (e.g. (mark: string) => void).
    // eslint-disable-next-line typescript/no-explicit-any
    jscode: (...args: any[]) => void,
    options?: MapOptions,
  ): void {
    mapkeyInMode(normal, keys, annotation, jscode, options);
  }

  /**
   * Create a shortcut in visual mode to execute your own action.
   *
   * @param {string} keys The key sequence for the shortcut.
   * @param {string} annotation A help message to describe the action, which will displayed in help
   *   opened by `?`.
   * @param {function} jscode A Javascript function to be bound. If the function needs an argument,
   *   next pressed key will be fed to the function.
   * @param {object} [options=null] `domain`: regex, a Javascript regex pattern to identify the
   *   domains that this mapping works, for example, `/github\.com/i` says that this mapping works
   *   only for github.com, `repeatIgnore`: boolean, whether this action can be repeated by dot
   *   command. Default is `null`
   * @see mapkey
   */
  function vmapkey(
    keys: string,
    annotation: string | string[],
    // User keypress handler of arbitrary signature; `unknown[]` would reject user callbacks that
    // declare typed parameters (e.g. (mark: string) => void).
    // eslint-disable-next-line typescript/no-explicit-any
    jscode: (...args: any[]) => void,
    options?: MapOptions,
  ): void {
    mapkeyInMode(visual, keys, annotation, jscode, options);
  }

  /**
   * Create a shortcut in insert mode to execute your own action.
   *
   * @param {string} keys The key sequence for the shortcut.
   * @param {string} annotation A help message to describe the action, which will displayed in help
   *   opened by `?`.
   * @param {function} jscode A Javascript function to be bound. If the function needs an argument,
   *   next pressed key will be fed to the function.
   * @param {object} [options=null] `domain`: regex, a Javascript regex pattern to identify the
   *   domains that this mapping works, for example, `/github\.com/i` says that this mapping works
   *   only for github.com, `repeatIgnore`: boolean, whether this action can be repeated by dot
   *   command. Default is `null`
   * @see mapkey
   */
  function imapkey(
    keys: string,
    annotation: string | string[],
    // User keypress handler of arbitrary signature; `unknown[]` would reject user callbacks that
    // declare typed parameters (e.g. (mark: string) => void).
    // eslint-disable-next-line typescript/no-explicit-any
    jscode: (...args: any[]) => void,
    options?: MapOptions,
  ): void {
    mapkeyInMode(insert, keys, annotation, jscode, options);
  }

  /**
   * Map a key sequence to another in normal mode.
   *
   * @example
   *   map(";d", "<Ctrl-Alt-d>");
   *
   * @param {string} new_keystroke A key sequence to replace
   * @param {string} old_keystroke A key sequence to be replaced
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping works. Default is `null`
   * @param {string} [new_annotation=null] Use it instead of the annotation from old_keystroke if
   *   provided. Default is `null`
   */
  function map(
    new_keystroke: string,
    old_keystroke: string,
    domain?: RegExp | number,
    new_annotation?: string,
  ): void {
    if (isDomainApplicable(domain)) {
      if (old_keystroke[0] === ":" && old_keystroke.length > 1) {
        const cmdline = old_keystroke.slice(1);
        const keybound = createKeyTarget(
          () => {
            front.executeCommand?.(cmdline);
          },
          new_annotation ? parseAnnotation({ annotation: new_annotation }) : null,
          false,
        );
        normal.mappings.add(KeyboardUtils.encodeKeystroke(new_keystroke), keybound);
      } else {
        const specialKey = specialKeys[old_keystroke];
        if (
          !mapInMode(normal, new_keystroke, old_keystroke, isInUIFrame(), new_annotation) &&
          specialKey != null
        ) {
          specialKey.push(new_keystroke);
          dispatchSKEvent("front", ["addMapkey", "Mode", new_keystroke, old_keystroke]);
        } else {
          LOG("warn", `${old_keystroke} not found in normal mode.`);
        }
      }
    }
  }

  /**
   * Unmap a key sequence in normal mode.
   *
   * @example
   *   unmap("<<", /youtube.com/);
   *
   * @param {string} keystroke A key sequence to be removed.
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping will be removed. Default is `null`
   */
  function unmap(keystroke: string, domain?: RegExp): void {
    if (isDomainApplicable(domain)) {
      const old_map = normal.mappings.find(KeyboardUtils.encodeKeystroke(keystroke));
      if (old_map) {
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
   *   unmapAllExcept(["E", "R", "T"], /google.com|twitter.com/);
   *
   * @param {array} keystrokes The keybindings you want to keep.
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping will be removed. Default is `null`
   */
  function unmapAllExcept(keystrokes: string[], domain?: RegExp): void {
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
   * @param {string} new_keystroke A key sequence to replace
   * @param {string} old_keystroke A key sequence to be replaced
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping works. Default is `null`
   * @param {string} [new_annotation=null] Use it instead of the annotation from old_keystroke if
   *   provided. Default is `null`
   * @see map
   */
  function imap(
    new_keystroke: string,
    old_keystroke: string,
    domain?: RegExp,
    new_annotation?: string,
  ): void {
    if (isDomainApplicable(domain)) {
      mapInMode(insert, new_keystroke, old_keystroke, isInUIFrame(), new_annotation);
    }
  }

  /**
   * Unmap a key sequence in insert mode.
   *
   * @param {string} keystroke A key sequence to be removed.
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping will be removed. Default is `null`
   * @see unmap
   */
  function iunmap(keystroke: string, domain?: RegExp): void {
    if (isDomainApplicable(domain)) {
      insert.mappings.remove(KeyboardUtils.encodeKeystroke(keystroke));
    }
  }

  /**
   * Map a key sequence to another in omnibar.
   *
   * @param {string} new_keystroke A key sequence to replace
   * @param {string} old_keystroke A key sequence to be replaced
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping works. Default is `null`
   * @param {string} [new_annotation=null] Use it instead of the annotation from old_keystroke if
   *   provided. Default is `null`
   * @see map
   */
  function cmap(
    new_keystroke: string,
    old_keystroke: string,
    domain?: RegExp,
    _new_annotation?: string,
  ): void {
    if (isDomainApplicable(domain)) {
      dispatchSKEvent("front", ["addMapkey", "Omnibar", new_keystroke, old_keystroke]);
    }
  }

  /**
   * Map a key sequence to another in visual mode.
   *
   * @param {string} new_keystroke A key sequence to replace
   * @param {string} old_keystroke A key sequence to be replaced
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping works. Default is `null`
   * @param {string} [new_annotation=null] Use it instead of the annotation from old_keystroke if
   *   provided. Default is `null`
   * @see map
   */
  function vmap(
    new_keystroke: string,
    old_keystroke: string,
    domain?: RegExp,
    new_annotation?: string,
  ): void {
    if (isDomainApplicable(domain)) {
      mapInMode(visual, new_keystroke, old_keystroke, isInUIFrame(), new_annotation);
    }
  }

  /**
   * Unmap a key sequence in visual mode.
   *
   * @param {string} keystroke A key sequence to be removed.
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping will be removed. Default is `null`
   * @see unmap
   */
  function vunmap(keystroke: string, domain?: RegExp): void {
    if (isDomainApplicable(domain)) {
      visual.mappings.remove(KeyboardUtils.encodeKeystroke(keystroke));
    }
  }

  /**
   * Map a key sequence to another in lurk mode.
   *
   * @param {string} new_keystroke A key sequence to replace
   * @param {string} old_keystroke A key sequence to be replaced
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping works. Default is `null`
   * @param {string} [new_annotation=null] Use it instead of the annotation from old_keystroke if
   *   provided. Default is `null`
   * @see map
   */
  function lmap(
    new_keystroke: string,
    old_keystroke: string,
    domain?: RegExp,
    _new_annotation?: string,
  ): void {
    if (isDomainApplicable(domain)) {
      normal.addLurkMap(new_keystroke, old_keystroke);
    }
  }

  /**
   * Add a search engine alias into Omnibar.
   *
   * @example
   *   addSearchAlias(
   *     "d",
   *     "duckduckgo",
   *     "https://duckduckgo.com/?q=",
   *     "s",
   *     "https://duckduckgo.com/ac/?q=",
   *     function (response) {
   *       var res = JSON.parse(response.text);
   *       return res.map(function (r) {
   *         return r.phrase;
   *       });
   *     },
   *   );
   *
   * @param {string} alias The key to trigger this search engine, one or several chars, used as
   *   search alias, when you input the string and press `space` in omnibar, the search engine will
   *   be triggered.
   * @param {string} prompt A caption to be placed in front of the omnibar.
   * @param {string} search_url The URL of the search engine, for example,
   *   `https://www.s.com/search.html?query=`, if there are extra parameters for the search engine,
   *   you can use it as `https://www.s.com/search.html?query={0}&type=cs` or
   *   `https://www.s.com/search.html?type=cs&query=`(since order of URL parameters usually does not
   *   matter).
   * @param {string} [search_leader_key=s] `<search_leader_key><alias>` in normal mode will search
   *   selected text with this search engine directly without opening the omnibar, for example `sd`.
   *   Default is `s`
   * @param {string} [suggestion_url=null] The URL to fetch suggestions in omnibar when this search
   *   engine is triggered. Default is `null`
   * @param {function} [callback_to_parse_suggestion=null] A function to parse the response from
   *   `suggestion_url` and return a list of strings as suggestions. Receives two arguments:
   *   `response`, the first argument, is an object containing a property `text` which holds the
   *   text of the response; and `request`, the second argument, is an object containing the
   *   properties `query` which is the text of the query and `url` which is the formatted URL for
   *   the request. Default is `null`
   * @param {string} [only_this_site_key=o] `<search_leader_key><only_this_site_key><alias>` in
   *   normal mode will search selected text within current site with this search engine directly
   *   without opening the omnibar, for example `sod`. Default is `o`
   * @param {object} [options=null] `favicon_url` URL for favicon for this search engine, `skipMaps`
   *   if `true` disable creating key mappings for this search engine. Default is `null`
   */
  function addSearchAlias(
    alias: string,
    prompt: string,
    search_url: string,
    search_leader_key?: string,
    suggestion_url?: string,
    // User-provided suggestion parser; callers type its response/request for their own engine, which
    // an `unknown` parameter would reject (contravariance).
    // eslint-disable-next-line typescript/no-explicit-any
    callback_to_parse_suggestion?: (...args: any[]) => unknown,
    only_this_site_key?: string,
    options?: { skipMaps?: boolean; favicon_url?: string },
  ): void {
    if (![...alias].every((c) => c.charCodeAt(0) <= 0x7f)) {
      throw `Invalid alias ${alias}, which must be ASCII characters.`;
    }
    if (!isInUIFrame() && front.addSearchAlias) {
      front.addSearchAlias(
        alias,
        prompt,
        search_url,
        suggestion_url,
        callback_to_parse_suggestion,
        options,
      );
    }
    const skipMaps = options?.skipMaps ?? false;
    if (skipMaps) {
      return;
    }
    function ssw() {
      searchSelectedWith(search_url);
    }
    mapkey((search_leader_key || "s") + alias, ["#6Search selected with {0}", prompt], ssw);
    mapkey("o" + alias, ["#8Open Omnibar for {0} Search", prompt], () => {
      front.openOmnibar({ type: "SearchEngine", extra: alias });
    });
    vmapkey((search_leader_key || "s") + alias, "", ssw);
    function ssw2() {
      searchSelectedWith(search_url, true);
    }
    mapkey((search_leader_key || "s") + (only_this_site_key || "o") + alias, "", ssw2);
    vmapkey((search_leader_key || "s") + (only_this_site_key || "o") + alias, "", ssw2);

    const capitalAlias = alias.toUpperCase();
    if (capitalAlias !== alias) {
      const ssw4 = () => {
        searchSelectedWith(search_url, false, true, alias);
      };
      mapkey((search_leader_key || "s") + capitalAlias, "", ssw4);
      vmapkey((search_leader_key || "s") + capitalAlias, "", ssw4);
      const ssw5 = () => {
        searchSelectedWith(search_url, true, true, alias);
      };
      mapkey((search_leader_key || "s") + (only_this_site_key || "o") + capitalAlias, "", ssw5);
      vmapkey((search_leader_key || "s") + (only_this_site_key || "o") + capitalAlias, "", ssw5);
    }
  }

  /**
   * Remove a search engine alias from Omnibar.
   *
   * @example
   *   removeSearchAlias("d");
   *
   * @param {string} alias The alias of the search engine to be removed.
   * @param {string} [search_leader_key=s] `<search_leader_key><alias>` in normal mode will search
   *   selected text with this search engine directly without opening the omnibar, for example `sd`.
   *   Default is `s`
   * @param {string} [only_this_site_key=o] `<search_leader_key><only_this_site_key><alias>` in
   *   normal mode will search selected text within current site with this search engine directly
   *   without opening the omnibar, for example `sod`. Default is `o`
   */
  function removeSearchAlias(
    alias: string,
    search_leader_key?: string,
    only_this_site_key?: string,
  ): void {
    if (!isInUIFrame()) {
      front.removeSearchAlias?.(alias);
    }
    unmap((search_leader_key || "s") + alias);
    unmap("o" + alias);
    vunmap((search_leader_key || "s") + alias);
    unmap((search_leader_key || "s") + (only_this_site_key || "o") + alias);
    vunmap((search_leader_key || "s") + (only_this_site_key || "o") + alias);
    const capitalAlias = alias.toUpperCase();
    if (capitalAlias !== alias) {
      unmap((search_leader_key || "s") + capitalAlias);
      vunmap((search_leader_key || "s") + capitalAlias);
      unmap((search_leader_key || "s") + (only_this_site_key || "o") + capitalAlias);
      vunmap((search_leader_key || "s") + (only_this_site_key || "o") + capitalAlias);
    }
  }

  /**
   * Search selected with.
   *
   * @example
   *   searchSelectedWith("https://translate.google.com/?hl=en#auto/en/");
   *
   * @param {string} se A search engine's search URL
   * @param {boolean} [onlyThisSite=false] Whether to search only within current site, need support
   *   from the provided search engine. Default is `false`
   * @param {boolean} [interactive=false] Whether to search in interactive mode, in case that you
   *   need some small modification on the selected content. Default is `false`
   * @param {string} [alias=""] Only used with interactive mode, in such case the url from `se` is
   *   ignored, SurfingKeys will construct search URL from the alias registered by `addSearchAlias`.
   *   Default is `""`
   */
  function searchSelectedWith(
    se: string,
    onlyThisSite?: boolean,
    interactive?: boolean,
    alias?: string,
  ): void {
    let query = window.getSelection()!.toString();
    clipboard.read((response) => {
      query = query || response.data;
      if (onlyThisSite) {
        query = "site:" + window.location.hostname + " " + query;
      }
      if (interactive) {
        front.openOmnibar({ type: "SearchEngine", extra: alias, pref: query });
      } else {
        tabOpenLink(constructSearchURL(se, encodeURIComponent(query)));
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
    mapkey: (keys: string, annotation: string | string[], options: MapOptions) => {
      if (options.codeHasParameter) {
        mapkey(
          keys,
          annotation,
          (key: string) => {
            dispatchSKEvent("user", ["callUserFunction", `normal:${keys}`, key]);
          },
          options,
        );
      } else {
        mapkey(
          keys,
          annotation,
          () => {
            dispatchSKEvent("user", ["callUserFunction", `normal:${keys}`]);
          },
          options,
        );
      }
    },
    imapkey: (keys: string, annotation: string | string[], options: MapOptions) => {
      imapkey(
        keys,
        annotation,
        () => {
          dispatchSKEvent("user", ["callUserFunction", `insert:${keys}`]);
        },
        options,
      );
    },
    vmapkey: (keys: string, annotation: string | string[], options: MapOptions) => {
      vmapkey(
        keys,
        annotation,
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
 * The user-script / default-mapping API surface returned by {@link createAPI}: the key-mapping
 * helpers (`mapkey`/`map`/`unmap`/…), search-alias management, and the
 * `Clipboard`/`Normal`/`Hints`/`Visual`/`Front` namespaces. This is the single source of truth for
 * the shape — `default.ts` consumes it directly instead of re-declaring a structural subset.
 */
export type SurfingkeysApi = ReturnType<typeof createAPI>;

export default createAPI;
