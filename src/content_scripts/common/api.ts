import { RUNTIME, dispatchSKEvent } from "./runtime.js";
import Trie from "./trie";
import Mode from "./mode";
import KeyboardUtils from "./keyboardUtils";
import { LOG } from "../../common/utils.js";
import {
    constructSearchURL,
    getBrowserName,
    getClickableElements,
    initSKFunctionListener,
    isElementPartiallyInViewport,
    isInUIFrame,
    mapInMode,
    parseAnnotation,
    showBanner,
    showPopup,
    tabOpenLink,
} from "./utils.js";

type ModeWithMappings = { name: string; mappings: Trie; map_node: Trie };
type ClipboardLike = {
    read(cb: (resp: { data: string }) => void): void;
    write(text: string): void;
};
type NormalLike = ModeWithMappings & {
    addLurkMap(newKeystroke: string, oldKeystroke: string): void;
    feedkeys(keys: string): void;
    jumpVIMark(mark: string): void;
    passThrough(timeout?: number): unknown;
    scroll(type: string): void;
};
type VisualLike = ModeWithMappings & { style(element: string, style: string): void };
type InsertLike = ModeWithMappings;
type HintsLike = {
    click(links: string | Element[], force?: boolean): void;
    create(
        cssSelector: string | Element[] | RegExp,
        onHintKey: ((element: any) => void) | null,
        attrs?: Record<string, any>,
    ): Promise<number>;
    dispatchMouseClick(element: any): void;
    style(css: string, mode?: string): void;
    setNumeric(): void;
    setCharacters(chars: string): void;
};
type FrontLike = {
    executeCommand(cmd: string): void;
    addSearchAlias?: (...args: any[]) => void;
    removeSearchAlias(alias: string): void;
    openOmnibar(args: unknown): void;
    registerInlineQuery: (...args: any[]) => void;
    setHintsCharacters?: (chars: string) => void;
};

type KeyTarget = {
    code: (...args: any[]) => void;
    repeatIgnore?: boolean;
    feature_group?: number;
    annotation?: string | string[];
};
type Annotation = { annotation: string | string[]; feature_group?: number };
type MapOptions = { domain?: RegExp; repeatIgnore?: boolean; codeHasParameter?: boolean };

function createAPI(
    clipboard: ClipboardLike,
    insert: InsertLike,
    normal: NormalLike,
    hints: HintsLike,
    visual: VisualLike,
    front: FrontLike,
    _browser: unknown,
) {
    function createKeyTarget(
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
            keybound.feature_group = ag.feature_group;
            keybound.annotation = ag.annotation;
        }

        return keybound;
    }

    function _isDomainApplicable(domain?: RegExp | number): boolean {
        // A falsy domain (undefined or the legacy 0 sentinel) means "applies everywhere".
        const re = domain as RegExp;
        return !domain || re.test(document.location.href) || re.test(window.origin);
    }

    function _mapkey(
        mode: ModeWithMappings,
        keys: string,
        annotation: string | string[],
        jscode: (...args: any[]) => void,
        options?: MapOptions,
    ): void {
        options = options || {};
        if (_isDomainApplicable(options.domain)) {
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
                let p = keys.substr(0, keys.length - 1);
                while (p.length > 0) {
                    const node = mode.mappings.find(p);
                    if (node && node.meta) {
                        LOG(
                            "warn",
                            `${node.meta.word} for [${node.meta.annotation}] precedes ${keys}.`,
                        );
                        return;
                    }
                    p = p.substr(0, p.length - 1);
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
     * @param {string} keys the key sequence for the shortcut.
     * @param {string} annotation a help message to describe the action, which will displayed in help opened by `?`.
     * @param {function} jscode a Javascript function to be bound. If the function needs an argument, next pressed key will be fed to the function.
     * @param {object} [options=null] `domain`: regex, a Javascript regex pattern to identify the domains that this mapping works, for example, `/github\.com/i` says that this mapping works only for github.com, `repeatIgnore`: boolean, whether this action can be repeated by dot command.
     *
     * @example
     * mapkey("<Space>", "pause/resume on youtube", function() {
     *     var btn = document.querySelector("button.ytp-ad-overlay-close-button") || document.querySelector("button.ytp-ad-skip-button") || document.querySelector('ytd-watch-flexy button.ytp-play-button');
     *     btn.click();
     * }, {domain: /youtube.com/i});
     */
    function mapkey(
        keys: string,
        annotation: string | string[],
        jscode: (...args: any[]) => void,
        options?: MapOptions,
    ): void {
        _mapkey(normal, keys, annotation, jscode, options);
    }

    /**
     * Create a shortcut in visual mode to execute your own action.
     *
     * @param {string} keys the key sequence for the shortcut.
     * @param {string} annotation a help message to describe the action, which will displayed in help opened by `?`.
     * @param {function} jscode a Javascript function to be bound. If the function needs an argument, next pressed key will be fed to the function.
     * @param {object} [options=null] `domain`: regex, a Javascript regex pattern to identify the domains that this mapping works, for example, `/github\.com/i` says that this mapping works only for github.com, `repeatIgnore`: boolean, whether this action can be repeated by dot command.
     *
     * @see mapkey
     */
    function vmapkey(
        keys: string,
        annotation: string | string[],
        jscode: (...args: any[]) => void,
        options?: MapOptions,
    ): void {
        _mapkey(visual, keys, annotation, jscode, options);
    }

    /**
     * Create a shortcut in insert mode to execute your own action.
     *
     * @param {string} keys the key sequence for the shortcut.
     * @param {string} annotation a help message to describe the action, which will displayed in help opened by `?`.
     * @param {function} jscode a Javascript function to be bound. If the function needs an argument, next pressed key will be fed to the function.
     * @param {object} [options=null] `domain`: regex, a Javascript regex pattern to identify the domains that this mapping works, for example, `/github\.com/i` says that this mapping works only for github.com, `repeatIgnore`: boolean, whether this action can be repeated by dot command.
     *
     * @see mapkey
     */
    function imapkey(
        keys: string,
        annotation: string | string[],
        jscode: (...args: any[]) => void,
        options?: MapOptions,
    ): void {
        _mapkey(insert, keys, annotation, jscode, options);
    }

    /**
     * Map a key sequence to another in normal mode.
     *
     * @param {string} new_keystroke a key sequence to replace
     * @param {string} old_keystroke a key sequence to be replaced
     * @param {regex} [domain=null] a Javascript regex pattern to identify the domains that this mapping works.
     * @param {string} [new_annotation=null] use it instead of the annotation from old_keystroke if provided.
     *
     * @example
     * map(';d', '<Ctrl-Alt-d>');
     */
    function map(
        new_keystroke: string,
        old_keystroke: string,
        domain?: RegExp | number,
        new_annotation?: string,
    ): void {
        if (_isDomainApplicable(domain)) {
            if (old_keystroke[0] === ":" && old_keystroke.length > 1) {
                const cmdline = old_keystroke.substr(1);
                const keybound = createKeyTarget(
                    () => {
                        front.executeCommand(cmdline);
                    },
                    new_annotation ? parseAnnotation({ annotation: new_annotation }) : null,
                    false,
                );
                normal.mappings.add(KeyboardUtils.encodeKeystroke(new_keystroke), keybound);
            } else {
                if (
                    !mapInMode(normal, new_keystroke, old_keystroke, new_annotation) &&
                    old_keystroke in Mode.specialKeys
                ) {
                    Mode.specialKeys[old_keystroke].push(new_keystroke);
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
     * @param {string} keystroke a key sequence to be removed.
     * @param {regex} [domain=null] a Javascript regex pattern to identify the domains that this mapping will be removed.
     *
     * @example
     * unmap("<<", /youtube.com/);
     */
    function unmap(keystroke: string, domain?: RegExp): void {
        if (_isDomainApplicable(domain)) {
            const old_map = normal.mappings.find(KeyboardUtils.encodeKeystroke(keystroke));
            if (old_map) {
                normal.mappings.remove(KeyboardUtils.encodeKeystroke(keystroke));
            } else {
                for (const k in Mode.specialKeys) {
                    const idx = Mode.specialKeys[k].indexOf(keystroke);
                    if (idx !== -1) {
                        Mode.specialKeys[k].splice(idx, 1);
                    }
                }
            }
        }
    }

    /**
     * Unmap all keybindings except those specified.
     *
     * @param {array} keystrokes the keybindings you want to keep.
     * @param {regex} [domain=null] a Javascript regex pattern to identify the domains that this mapping will be removed.
     *
     * @example
     *
     * unmapAllExcept(['E','R','T'], /google.com|twitter.com/);
     */
    function unmapAllExcept(keystrokes: string[], domain?: RegExp): void {
        if (_isDomainApplicable(domain)) {
            const modes: ModeWithMappings[] = [normal, insert];
            modes.forEach((mode) => {
                const _mappings = new Trie();
                keystrokes = keystrokes || [];
                for (let i = 0, il = keystrokes.length; i < il; i++) {
                    const ks = KeyboardUtils.encodeKeystroke(keystrokes[i]);
                    const node = mode.mappings.find(ks);
                    if (node) {
                        _mappings.add(ks, node.meta!);
                    }
                }
                mode.mappings = _mappings;
                mode.map_node = _mappings;
            });
        }
    }

    /**
     * Map a key sequence to another in insert mode.
     *
     * @param {string} new_keystroke a key sequence to replace
     * @param {string} old_keystroke a key sequence to be replaced
     * @param {regex} [domain=null] a Javascript regex pattern to identify the domains that this mapping works.
     * @param {string} [new_annotation=null] use it instead of the annotation from old_keystroke if provided.
     *
     * @see map
     */
    function imap(
        new_keystroke: string,
        old_keystroke: string,
        domain?: RegExp,
        new_annotation?: string,
    ): void {
        if (_isDomainApplicable(domain)) {
            mapInMode(insert, new_keystroke, old_keystroke, new_annotation);
        }
    }

    /**
     * Unmap a key sequence in insert mode.
     *
     * @param {string} keystroke a key sequence to be removed.
     * @param {regex} [domain=null] a Javascript regex pattern to identify the domains that this mapping will be removed.
     *
     * @see unmap
     */
    function iunmap(keystroke: string, domain?: RegExp): void {
        if (_isDomainApplicable(domain)) {
            insert.mappings.remove(KeyboardUtils.encodeKeystroke(keystroke));
        }
    }

    /**
     * Map a key sequence to another in omnibar.
     *
     * @param {string} new_keystroke a key sequence to replace
     * @param {string} old_keystroke a key sequence to be replaced
     * @param {regex} [domain=null] a Javascript regex pattern to identify the domains that this mapping works.
     * @param {string} [new_annotation=null] use it instead of the annotation from old_keystroke if provided.
     *
     * @see map
     */
    function cmap(
        new_keystroke: string,
        old_keystroke: string,
        domain?: RegExp,
        _new_annotation?: string,
    ): void {
        if (_isDomainApplicable(domain)) {
            dispatchSKEvent("front", ["addMapkey", "Omnibar", new_keystroke, old_keystroke]);
        }
    }

    /**
     * Map a key sequence to another in visual mode.
     *
     * @param {string} new_keystroke a key sequence to replace
     * @param {string} old_keystroke a key sequence to be replaced
     * @param {regex} [domain=null] a Javascript regex pattern to identify the domains that this mapping works.
     * @param {string} [new_annotation=null] use it instead of the annotation from old_keystroke if provided.
     *
     * @see map
     */
    function vmap(
        new_keystroke: string,
        old_keystroke: string,
        domain?: RegExp,
        new_annotation?: string,
    ): void {
        if (_isDomainApplicable(domain)) {
            mapInMode(visual, new_keystroke, old_keystroke, new_annotation);
        }
    }

    /**
     * Unmap a key sequence in visual mode.
     *
     * @param {string} keystroke a key sequence to be removed.
     * @param {regex} [domain=null] a Javascript regex pattern to identify the domains that this mapping will be removed.
     *
     * @see unmap
     */
    function vunmap(keystroke: string, domain?: RegExp): void {
        if (_isDomainApplicable(domain)) {
            visual.mappings.remove(KeyboardUtils.encodeKeystroke(keystroke));
        }
    }

    /**
     * Map a key sequence to another in lurk mode.
     *
     * @param {string} new_keystroke a key sequence to replace
     * @param {string} old_keystroke a key sequence to be replaced
     * @param {regex} [domain=null] a Javascript regex pattern to identify the domains that this mapping works.
     * @param {string} [new_annotation=null] use it instead of the annotation from old_keystroke if provided.
     *
     * @see map
     */
    function lmap(
        new_keystroke: string,
        old_keystroke: string,
        domain?: RegExp,
        _new_annotation?: string,
    ): void {
        if (_isDomainApplicable(domain)) {
            normal.addLurkMap(new_keystroke, old_keystroke);
        }
    }

    /**
     * Add a search engine alias into Omnibar.
     *
     * @param {string} alias the key to trigger this search engine, one or several chars, used as search alias, when you input the string and press `space` in omnibar, the search engine will be triggered.
     * @param {string} prompt a caption to be placed in front of the omnibar.
     * @param {string} search_url the URL of the search engine, for example, `https://www.s.com/search.html?query=`, if there are extra parameters for the search engine, you can use it as `https://www.s.com/search.html?query={0}&type=cs` or `https://www.s.com/search.html?type=cs&query=`(since order of URL parameters usually does not matter).
     * @param {string} [search_leader_key=s] `<search_leader_key><alias>` in normal mode will search selected text with this search engine directly without opening the omnibar, for example `sd`.
     * @param {string} [suggestion_url=null] the URL to fetch suggestions in omnibar when this search engine is triggered.
     * @param {function} [callback_to_parse_suggestion=null] a function to parse the response from `suggestion_url` and return a list of strings as suggestions. Receives two arguments: `response`, the first argument, is an object containing a property `text` which holds the text of the response; and `request`, the second argument, is an object containing the properties `query` which is the text of the query and `url` which is the formatted URL for the request.
     * @param {string} [only_this_site_key=o] `<search_leader_key><only_this_site_key><alias>` in normal mode will search selected text within current site with this search engine directly without opening the omnibar, for example `sod`.
     * @param {object} [options=null] `favicon_url` URL for favicon for this search engine, `skipMaps` if `true` disable creating key mappings for this search engine
     *
     * @example
     * addSearchAlias('d', 'duckduckgo', 'https://duckduckgo.com/?q=', 's', 'https://duckduckgo.com/ac/?q=', function(response) {
     *     var res = JSON.parse(response.text);
     *     return res.map(function(r){
     *         return r.phrase;
     *     });
     * });
     */
    function addSearchAlias(
        alias: string,
        prompt: string,
        search_url: string,
        search_leader_key?: string,
        suggestion_url?: string,
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
            mapkey(
                (search_leader_key || "s") + (only_this_site_key || "o") + capitalAlias,
                "",
                ssw5,
            );
            vmapkey(
                (search_leader_key || "s") + (only_this_site_key || "o") + capitalAlias,
                "",
                ssw5,
            );
        }
    }

    /**
     * Remove a search engine alias from Omnibar.
     *
     * @param {string} alias the alias of the search engine to be removed.
     * @param {string} [search_leader_key=s] `<search_leader_key><alias>` in normal mode will search selected text with this search engine directly without opening the omnibar, for example `sd`.
     * @param {string} [only_this_site_key=o] `<search_leader_key><only_this_site_key><alias>` in normal mode will search selected text within current site with this search engine directly without opening the omnibar, for example `sod`.
     *
     * @example
     * removeSearchAlias('d');
     */
    function removeSearchAlias(
        alias: string,
        search_leader_key?: string,
        only_this_site_key?: string,
    ): void {
        if (!isInUIFrame()) {
            front.removeSearchAlias(alias);
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
     * @param {string} se a search engine's search URL
     * @param {boolean} [onlyThisSite=false] whether to search only within current site, need support from the provided search engine.
     * @param {boolean} [interactive=false] whether to search in interactive mode, in case that you need some small modification on the selected content.
     * @param {string} [alias=""] only used with interactive mode, in such case the url from `se` is ignored, SurfingKeys will construct search URL from the alias registered by `addSearchAlias`.
     *
     * @example
     * searchSelectedWith('https://translate.google.com/?hl=en#auto/en/');
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
        "front:registerInlineQuery": front.registerInlineQuery,
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
            registerInlineQuery: front.registerInlineQuery,
            showBanner,
            showPopup,
        },
    };
}

export default createAPI;
