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
  domain?: RegExp;
  repeatIgnore?: boolean;
  codeHasParameter?: boolean;
  /** The help section this mapping is listed under; defaults by mode, and Misc for normal mode. */
  group?: FeatureGroup;
};

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
    annotation: string | string[] | null,
    group: FeatureGroup | undefined,
    repeatIgnore?: boolean,
  ): KeyTarget {
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

  function isDomainApplicable(domain?: RegExp | number): boolean {
    // A falsy domain (undefined or the legacy 0 sentinel) means "applies everywhere".
    if (!domain || typeof domain === "number") {
      return true;
    }
    return domain.test(document.location.href) || domain.test(window.origin);
  }

  function mapkeyInMode(
    mode: ModeWithMappings,
    // The section a mapping of this mode gets when it names none. Visual and Insert each own one,
    // while Normal has no section of its own, because the built-in normal mappings are filed by
    // topic, so its mappings land in Misc rather than under a heading that would misdescribe them.
    defaultGroup: FeatureGroup,
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
      // A user snippet is plain JavaScript, so a mistyped group reaches here as an ordinary string.
      // Saying so and falling back beats dropping the mapping out of the help without a word.
      const requested = options.group;
      const group = isFeatureGroup(requested) ? requested : defaultGroup;
      if (requested != null && group !== requested) {
        LOG("warn", `${keys} names no help section [${requested}]; listing it under ${group}.`);
      }
      const keybound = createKeyTarget(jscode, annotation, group, options.repeatIgnore);
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
   *   command, `group`: string, the section of the help opened by `?` that lists this mapping, such
   *   as `"tabs"` or `"clipboard"`. Default is `null`
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
    mapkeyInMode(normal, "misc", keys, annotation, jscode, options);
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
   *   command, `group`: string, the section of the help opened by `?` that lists this mapping, such
   *   as `"tabs"` or `"clipboard"`. Default is `null`
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
    mapkeyInMode(visual, "visualMode", keys, annotation, jscode, options);
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
   *   command, `group`: string, the section of the help opened by `?` that lists this mapping, such
   *   as `"tabs"` or `"clipboard"`. Default is `null`
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
    mapkeyInMode(insert, "insertMode", keys, annotation, jscode, options);
  }

  /**
   * Map a key sequence to another in normal mode.
   *
   * @example
   *   map(";d", "<Ctrl-Alt-d>");
   *
   * @param {string} newKeystroke A key sequence to replace
   * @param {string} oldKeystroke A key sequence to be replaced
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping works. Default is `null`
   * @param {string} [newAnnotation=null] Use it instead of the annotation from oldKeystroke if
   *   provided. Default is `null`
   * @param {string} [group=null] The section of the help opened by `?` that lists this mapping,
   *   such as `"tabs"`. Only read when oldKeystroke is a `:command`, since a key alias takes the
   *   section of the key it replaces. Default is `null`
   */
  function map(
    newKeystroke: string,
    oldKeystroke: string,
    domain?: RegExp | number,
    newAnnotation?: string,
    group?: FeatureGroup,
  ): void {
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
          // There is no source mapping to take a section from, unlike the alias branch below.
          newAnnotation ?? null,
          group ?? "misc",
          false,
        );
        normal.mappings.add(KeyboardUtils.encodeKeystroke(newKeystroke), keybound);
      } else {
        const specialKey = specialKeys[oldKeystroke];
        if (
          !mapInMode(normal, newKeystroke, oldKeystroke, isInUIFrame(), newAnnotation) &&
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
   *   unmap("<<", /youtube.com/);
   *
   * @param {string} keystroke A key sequence to be removed.
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping will be removed. Default is `null`
   */
  function unmap(keystroke: string, domain?: RegExp): void {
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
   * @param {string} newKeystroke A key sequence to replace
   * @param {string} oldKeystroke A key sequence to be replaced
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping works. Default is `null`
   * @param {string} [newAnnotation=null] Use it instead of the annotation from oldKeystroke if
   *   provided. Default is `null`
   * @see map
   */
  function imap(
    newKeystroke: string,
    oldKeystroke: string,
    domain?: RegExp,
    newAnnotation?: string,
  ): void {
    if (isDomainApplicable(domain)) {
      mapInMode(insert, newKeystroke, oldKeystroke, isInUIFrame(), newAnnotation);
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
   * @param {string} newKeystroke A key sequence to replace
   * @param {string} oldKeystroke A key sequence to be replaced
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping works. Default is `null`
   * @param {string} [newAnnotation=null] Use it instead of the annotation from oldKeystroke if
   *   provided. Default is `null`
   * @see map
   */
  function cmap(
    newKeystroke: string,
    oldKeystroke: string,
    domain?: RegExp,
    _new_annotation?: string,
  ): void {
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
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping will be removed. Default is `null`
   * @see unmap
   */
  function cunmap(keystroke: string, domain?: RegExp): void {
    if (isDomainApplicable(domain)) {
      dispatchSKEvent("front", ["removeMapkey", "Omnibar", keystroke]);
    }
  }

  /**
   * Map a key sequence to another in visual mode.
   *
   * @param {string} newKeystroke A key sequence to replace
   * @param {string} oldKeystroke A key sequence to be replaced
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping works. Default is `null`
   * @param {string} [newAnnotation=null] Use it instead of the annotation from oldKeystroke if
   *   provided. Default is `null`
   * @see map
   */
  function vmap(
    newKeystroke: string,
    oldKeystroke: string,
    domain?: RegExp,
    newAnnotation?: string,
  ): void {
    if (isDomainApplicable(domain)) {
      mapInMode(visual, newKeystroke, oldKeystroke, isInUIFrame(), newAnnotation);
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
   * @param {string} newKeystroke A key sequence to replace
   * @param {string} oldKeystroke A key sequence to be replaced
   * @param {regex} [domain=null] A Javascript regex pattern to identify the domains that this
   *   mapping works. Default is `null`
   * @param {string} [newAnnotation=null] Use it instead of the annotation from oldKeystroke if
   *   provided. Default is `null`
   * @see map
   */
  function lmap(
    newKeystroke: string,
    oldKeystroke: string,
    domain?: RegExp,
    _new_annotation?: string,
  ): void {
    if (isDomainApplicable(domain)) {
      normal.addLurkMap(newKeystroke, oldKeystroke);
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
   * @param {string} searchUrl The URL of the search engine, for example,
   *   `https://www.s.com/search.html?query=`, if there are extra parameters for the search engine,
   *   you can use it as `https://www.s.com/search.html?query={0}&type=cs` or
   *   `https://www.s.com/search.html?type=cs&query=`(since order of URL parameters usually does not
   *   matter).
   * @param {string} [searchLeaderKey=s] `<searchLeaderKey><alias>` in normal mode will search
   *   selected text with this search engine directly without opening the omnibar, for example `sd`.
   *   Default is `s`
   * @param {string} [suggestionUrl=null] The URL to fetch suggestions in omnibar when this search
   *   engine is triggered. Default is `null`
   * @param {function} [callbackToParseSuggestion=null] A function to parse the response from
   *   `suggestionUrl` and return a list of strings as suggestions. Receives two arguments:
   *   `response`, the first argument, is an object containing a property `text` which holds the
   *   text of the response; and `request`, the second argument, is an object containing the
   *   properties `query` which is the text of the query and `url` which is the formatted URL for
   *   the request. Default is `null`
   * @param {string} [onlyThisSiteKey=o] `<searchLeaderKey><onlyThisSiteKey><alias>` in normal mode
   *   will search selected text within current site with this search engine directly without
   *   opening the omnibar, for example `sod`. Default is `o`
   * @param {object} [options=null] `favicon_url` URL for favicon for this search engine, `skipMaps`
   *   if `true` disable creating key mappings for this search engine. Default is `null`
   */
  function addSearchAlias(
    alias: string,
    prompt: string,
    searchUrl: string,
    searchLeaderKey?: string,
    suggestionUrl?: string,
    // User-provided suggestion parser; callers type its response/request for their own engine, which
    // an `unknown` parameter would reject (contravariance).
    // eslint-disable-next-line typescript/no-explicit-any
    callbackToParseSuggestion?: (...args: any[]) => unknown,
    onlyThisSiteKey?: string,
    options?: { skipMaps?: boolean; favicon_url?: string },
  ): void {
    if (![...alias].every((c) => c.charCodeAt(0) <= 0x7f)) {
      throw `Invalid alias ${alias}, which must be ASCII characters.`;
    }
    if (!isInUIFrame() && front.addSearchAlias) {
      front.addSearchAlias(
        alias,
        prompt,
        searchUrl,
        suggestionUrl,
        callbackToParseSuggestion,
        options,
      );
    }
    const skipMaps = options?.skipMaps ?? false;
    if (skipMaps) {
      return;
    }
    function ssw() {
      searchSelectedWith(searchUrl);
    }
    mapkey((searchLeaderKey || "s") + alias, ["Search selected with {0}", prompt], ssw, {
      group: "searchSelectedWith",
    });
    mapkey(
      "o" + alias,
      ["Open Omnibar for {0} Search", prompt],
      () => {
        front.openOmnibar({ type: "SearchEngine", extra: alias });
      },
      { group: "omnibar" },
    );
    vmapkey((searchLeaderKey || "s") + alias, "", ssw);
    function ssw2() {
      searchSelectedWith(searchUrl, true);
    }
    mapkey((searchLeaderKey || "s") + (onlyThisSiteKey || "o") + alias, "", ssw2);
    vmapkey((searchLeaderKey || "s") + (onlyThisSiteKey || "o") + alias, "", ssw2);

    const capitalAlias = alias.toUpperCase();
    if (capitalAlias !== alias) {
      const ssw4 = () => {
        searchSelectedWith(searchUrl, false, true, alias);
      };
      mapkey((searchLeaderKey || "s") + capitalAlias, "", ssw4);
      vmapkey((searchLeaderKey || "s") + capitalAlias, "", ssw4);
      const ssw5 = () => {
        searchSelectedWith(searchUrl, true, true, alias);
      };
      mapkey((searchLeaderKey || "s") + (onlyThisSiteKey || "o") + capitalAlias, "", ssw5);
      vmapkey((searchLeaderKey || "s") + (onlyThisSiteKey || "o") + capitalAlias, "", ssw5);
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
   *
   * @param {string} searchUrl A search engine's search URL
   * @param {boolean} [onlyThisSite=false] Whether to search only within current site, need support
   *   from the provided search engine. Default is `false`
   * @param {boolean} [interactive=false] Whether to search in interactive mode, in case that you
   *   need some small modification on the selected content. Default is `false`
   * @param {string} [alias=""] Only used with interactive mode, in such case the url from
   *   `searchUrl` is ignored, SurfingKeys will construct search URL from the alias registered by
   *   `addSearchAlias`. Default is `""`
   */
  function searchSelectedWith(
    searchUrl: string,
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
