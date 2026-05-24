import { dispatchSKEvent, runtime } from "./runtime.js";
import Mode from "./mode";
import KeyboardUtils from "./keyboardUtils";
import Trie from "./trie";
import {
    createElementWithContent,
    dispatchMouseEvent,
    filterInvisibleElements,
    filterOverlapElements,
    flashPressedLink,
    getAnnotations,
    getClickableElements,
    getColor,
    getCssSelectorsOfEditable,
    getRealRect,
    getTextNodePos,
    getVisibleElements,
    htmlEncode,
    initSKFunctionListener,
    isEditable,
    isElementClickable,
    isElementDrawn,
    refreshHints,
    setSanitizedContent,
} from "./utils.js";

// Browser-extension global. The typed BrowserAdapter (task #13) will replace
// this narrow declaration once cross-browser API access is centralized.

// Surfingkeys stores the target element/label/z-index on each hint node.
type HintElement = HTMLElement & {
    link?: any;
    label?: string;
    zIndex?: string;
    skColorIndex?: number;
};

type InsertLike = { enter(elm: HTMLElement, keepCursor?: boolean): void; exit(): void };
type NormalLike = {
    isScrollKeyInHints(key: string): boolean;
    passFocus(b: boolean): void;
    appendKeysForRepeat(mode: string, keys: string): void;
    disable(onElement?: boolean): void;
};
type ClipboardLike = { write(text: string): void };

type ScrollMode = Mode & { onScrollStarted?: () => void; onScrollDone?: () => void };

type Behaviours = {
    mouseEvents: string[];
    multipleHits?: boolean;
    tabbed?: boolean;
    active?: boolean;
    regionalHints?: boolean;
    statusLine?: string;
    [key: string]: unknown;
};

type RegionalHintsMode = Mode & {
    mappings: Trie;
    map_node: Trie;
    attach(elm: HintElement): void;
    onScrollStarted(): void;
    onScrollDone(): void;
};

type HintsMode = Mode & {
    mappings: Trie;
    map_node: Trie;
    setNumeric(): void;
    setCharacters(chars: string): void;
    getCharacters(): string;
    dispatchMouseClick(element: any): void;
    click(links: string | Element[], force?: boolean): void;
    previousPage(): boolean;
    nextPage(): boolean;
    onScrollStarted(): void;
    onScrollDone(): void;
    genLabels(total: number): string[];
    coordinate(): { top: number; left: number };
    createInputLayer(): void;
    getSelector(): string | Element[] | RegExp;
    create(
        cssSelector: string | Element[] | RegExp,
        onHintKey: ((element: any) => void) | null,
        attrs?: Record<string, any>,
    ): Promise<number>;
    mouseoutLastElement(): void;
    style(css: string, mode?: string): void;
    feedkeys(keys: string): void;
};

function placeHintsHost(host: HTMLElement): void {
    let topLayerElement: HTMLElement | null = document.querySelector("dialog");
    if (!topLayerElement || !isElementDrawn(topLayerElement)) {
        topLayerElement = document.documentElement;
    }
    topLayerElement.appendChild(host);
}

function createRegionalHints(clipboard: ClipboardLike): RegionalHintsMode {
    const self = new Mode("RegionalHints") as RegionalHintsMode;

    self.mappings = new Trie();
    self.map_node = self.mappings;

    const regionalHintsHost = document.createElement("div");
    regionalHintsHost.className = "surfingkeys_hints_host";
    regionalHintsHost.attachShadow({ mode: "open" });
    const hintsStyle = createElementWithContent(
        "style",
        `
div.menu {
    font-size: 14px;
    color: #fff;
}
div.menu-item {
    display: inline-block;
    padding: 4px;
    margin: 4px;
    background: #454545;
    box-shadow: inset 0 -1px 0 #bbb;
    border-radius: 3px;
    font-size: 14px;
}
kbd {
    white-space: nowrap;
    display: inline-block;
    padding: 3px 5px;
    font: 14px Consolas, "Liberation Mono", Menlo, Courier, monospace;
    line-height: 10px;
    vertical-align: middle;
    border: solid 1px #ccc;
    border-bottom-color: #bbb;
    border-radius: 3px;
    box-shadow: inset 0 -1px 0 #bbb;
    margin-right: 4px;
}
`,
    );
    regionalHintsHost.shadowRoot!.appendChild(hintsStyle);

    self.mappings.add(KeyboardUtils.encodeKeystroke("<Esc>"), {
        annotation: "Exit regional hints mode",
        feature_group: 17,
        code: () => {
            self.exit();
        },
    });

    self.mappings.add("ct", {
        annotation: "copy text from target element",
        feature_group: 17,
        code: () => {
            clipboard.write(overlay!.link.innerText);
        },
    });

    self.mappings.add("ch", {
        annotation: "copy html from target element",
        feature_group: 17,
        code: () => {
            clipboard.write(overlay!.link.innerHTML);
        },
    });

    self.mappings.add("d", {
        annotation: "delete target element",
        feature_group: 17,
        code: () => {
            overlay!.link.remove();
            self.exit();
        },
    });

    const menu = createElementWithContent("div", "", { class: "menu" });
    getAnnotations(self.mappings).forEach((b) => {
        const menuItem = createElementWithContent("div", "", { class: "menu-item" });
        menuItem.appendChild(
            createElementWithContent("kbd", htmlEncode(KeyboardUtils.decodeKeystroke(b.word))),
        );
        menuItem.appendChild(createElementWithContent("span", b.annotation as string));
        menu.appendChild(menuItem);
    });

    self.addEventListener("keydown", (event) => {
        Mode.handleMapKey.call(self, event);
    });

    let overlay: HintElement | null = null;
    self.onExit = () => {
        overlay!.remove();
        regionalHintsHost.remove();
    };
    self.attach = (elm) => {
        if (overlay) overlay.remove();
        overlay = elm;
        regionalHintsHost.shadowRoot!.appendChild(overlay);
        placeHintsHost(regionalHintsHost);
        overlay.appendChild(menu);
        self.enter();
    };
    self.onScrollStarted = () => {
        if (!document.documentElement.contains(regionalHintsHost)) {
            return;
        }
        overlay!.style.display = "none";
    };
    self.onScrollDone = () => {
        const be = overlay!.link.getBoundingClientRect();
        overlay!.style.top = be.top + "px";
        overlay!.style.left = be.left + "px";
        overlay!.style.display = "";
    };
    return self;
}

function createHints(insert: InsertLike, normal: NormalLike, clipboard: ClipboardLike): HintsMode {
    const self = new Mode("Hints") as HintsMode;
    const hintsHost = document.createElement("div");
    hintsHost.className = "surfingkeys_hints_host";
    hintsHost.attachShadow({ mode: "open" });
    const hintsStyle = createElementWithContent(
        "style",
        `
div {
    position: absolute;
    display: block;
    font-size: 8pt;
    font-weight: bold;
    padding: 0px 2px 0px 2px;
    background: -webkit-gradient(linear, left top, left bottom, color-stop(0%,#FFF785), color-stop(100%,#FFC542));
    color: #000;
    border: solid 1px #C38A22;
    border-radius: 3px;
    box-shadow: 0px 3px 7px 0px rgba(0, 0, 0, 0.3);
    width: auto;
}
div:empty {
    display: none;
}
[mode=text] div {
    background: -webkit-gradient(linear, left top, left bottom, color-stop(0%,#aaa), color-stop(100%,#fff));
}
div.hint-scrollable {
    background: rgba(170, 170, 255, 0.85);
}
[mode=text] div.begin {
    color: #00f;
}
[mode=input] mask {
    background: rgba(255, 217, 0, 0.25);
}
[mode=input] mask.activeInput {
    background: rgba(0, 0, 255, 0.25);
}`,
    );
    /* When the <style> loaded, set hints host's size */
    hintsStyle.onload = () => {
        /* Get height and width in integers */
        const height =
            Math.floor(document.documentElement.scrollTop + document.documentElement.clientHeight) -
            1;
        const width =
            Math.floor(document.documentElement.scrollLeft + document.documentElement.clientWidth) -
            1;

        /* Set height and width */
        hintsHost.style.height = `${height}px`;
        hintsHost.style.width = `${width}px`;
    };

    hintsHost.shadowRoot!.appendChild(hintsStyle);
    const regionalHints = createRegionalHints(clipboard);

    let numeric = false;
    /**
     * Use digits as hint label, with it set you could type text to filter links, this API is to replace original setting like `Hints.numericHints = true;`.
     *
     * @name Hints.setNumeric
     *
     * @example
     * Hints.setNumeric();
     */
    self.setNumeric = () => {
        numeric = true;
    };
    let characters = "asdfgqwertzxcvb";
    /**
     * Set characters for generating hints, this API is to replace original setting like `Hints.characters = "asdgqwertzxcvb";`.
     *
     * @param {string} characters the characters for generating hints.
     * @name Hints.setCharacters
     *
     * @example
     * Hints.setCharacters("asdgqwertzxcvb");
     */
    const excludedScrollKeys: string[] = [];
    self.setCharacters = (chars) => {
        characters = chars;
        for (const c of chars) {
            if (normal.isScrollKeyInHints(c)) {
                excludedScrollKeys.push(c);
            }
        }
    };
    self.getCharacters = () => {
        return characters;
    };

    self.addEventListener("keydown", (event) => {
        event.sk_stopPropagation = true;
        const keyEvent = event as KeyboardEvent;

        let ai = holder.querySelector("[mode=input]>mask.activeInput") as HintElement | null;
        if (ai !== null) {
            const masks = holder.querySelectorAll("mask");
            let elm = ai.link;
            if (Mode.isSpecialKeyOf("<Esc>", event.sk_keyName ?? "")) {
                elm.blur();
                hide();
            } else if (event.keyCode === KeyboardUtils.keyCodes.tab) {
                ai.classList.remove("activeInput");
                _lastCreateAttrs.activeInput =
                    (_lastCreateAttrs.activeInput! + (keyEvent.shiftKey ? -1 : 1)) % masks.length;
                ai = masks[_lastCreateAttrs.activeInput] as unknown as HintElement;
                ai.classList.add("activeInput");

                elm = ai.link;
                elm.focus();
            } else if (event.keyCode !== KeyboardUtils.keyCodes.shiftKey) {
                event.sk_stopPropagation = false;
                hide();
                insert.enter(elm);
            }
            return;
        }

        const hints = holder.querySelectorAll("div");
        if (Mode.isSpecialKeyOf("<Esc>", event.sk_keyName ?? "")) {
            hide();
        } else if (event.keyCode === KeyboardUtils.keyCodes.space) {
            holder.style.display = "none";
        } else if (event.keyCode === KeyboardUtils.keyCodes.shiftKey) {
            flip();
        } else if (hints.length > 0) {
            if (event.keyCode === KeyboardUtils.keyCodes.backspace) {
                if (prefix.length > 0) {
                    prefix = prefix.substr(0, prefix.length - 1);
                    handleHint(event);
                } else if (textFilter.length > 0) {
                    textFilter = textFilter.substr(0, textFilter.length - 1);
                    refreshByTextFilter();
                }
            } else {
                const key = event.sk_keyName ?? "";
                if (isCapital(key)) {
                    shiftKey = true;
                }
                if (key !== "") {
                    if (numeric) {
                        if (key >= "0" && key <= "9") {
                            prefix += key;
                        } else {
                            textFilter += key;
                            refreshByTextFilter();
                        }
                        handleHint(event);
                    } else if (characters.toLowerCase().indexOf(key.toLowerCase()) !== -1) {
                        prefix = prefix + key.toUpperCase();
                        handleHint(event);
                    } else {
                        if (
                            normal.isScrollKeyInHints(key) &&
                            excludedScrollKeys.indexOf(key) === -1
                        ) {
                            // pass on the key to normal mode to scroll page.
                            event.sk_stopPropagation = false;
                        } else {
                            // quit hints if user presses non-hint key and no keys for scrolling
                            hide();
                        }
                    }
                }
            }
        }
    });
    self.addEventListener("keyup", (event) => {
        if (event.keyCode === KeyboardUtils.keyCodes.space) {
            holder.style.display = "";
        }
    });

    /**
     * The default `onHintKey` implementation.
     *
     * @param {HTMLElement} element the element for which the pressed hint is targeted.
     * @name Hints.dispatchMouseClick
     * @see Hints.create
     *
     * @example
     * mapkey('q', 'click on images', function() {
     *     Hints.create("div.media_box img", Hints.dispatchMouseClick);
     * }, {domain: /weibo.com/i});
     */
    self.dispatchMouseClick = (element) => {
        if (isEditable(element)) {
            self.exit();
            normal.passFocus(true);
            element.focus();
            insert.enter(element);
        } else {
            if (!behaviours.multipleHits) {
                self.exit();
            }
            let tabbed = behaviours.tabbed,
                active = behaviours.active;
            if (behaviours.multipleHits) {
                const href = element.getAttribute("href");
                if (href !== null && href !== "#") {
                    tabbed = true;
                    active = false;
                }
            }

            const mouseEventModifiers: {
                ctrlKey?: boolean;
                altKey?: boolean;
                shiftKey?: boolean;
                metaKey?: boolean;
            } = { shiftKey: shiftKey || active };
            if (shiftKey && runtime.conf.hintShiftNonActive) {
                tabbed = true;
                mouseEventModifiers.shiftKey = false;
            }
            if (tabbed) {
                const modKey = navigator.platform.indexOf("Mac") !== -1 ? "metaKey" : "ctrlKey";
                mouseEventModifiers[modKey] = true;
            }
            flashPressedLink(element, () => {
                {
                    self.mouseoutLastElement();
                    dispatchMouseEvent(element, behaviours.mouseEvents, mouseEventModifiers);
                    dispatchSKEvent("observer", ["turnOn"]);
                    lastMouseTarget = element;
                    if (
                        document.activeElement!.matches(
                            runtime.conf.disabledOnActiveElementPattern as string,
                        )
                    ) {
                        setTimeout(() => {
                            normal.disable(true);
                        }, 100);
                    }
                }

                if (behaviours.multipleHits) {
                    setTimeout(resetHints, 300);
                }
            });
        }
        element.classList.remove("surfingkeys--hints--clicking");
    };

    const MOUSE_EVENTS = [
        "mouseover",
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "click",
        "focus",
        "focusin",
    ];
    let prefix = "";
    let textFilter = "";
    let lastMouseTarget: Element | null = null;
    let behaviours: Behaviours = {
        mouseEvents: MOUSE_EVENTS,
    };
    const holder = createElementWithContent("section", "", {
        style: "display: block; opacity: 1;",
    });
    let shiftKey = false;
    let _lastCreateAttrs: { activeInput?: number; [key: string]: unknown } = {};
    let _onHintKey: ((element: any) => void) | null = self.dispatchMouseClick;
    let _cssSelector: string | Element[] | RegExp = "";

    function isCapital(key: string): boolean {
        return (
            key === key.toUpperCase() && key !== key.toLowerCase()
            // in case key is a symbol or special character
        );
    }

    function getZIndex(node: Node | null): number {
        let z = 0;
        do {
            const i = parseInt(getComputedStyle(node as Element).getPropertyValue("z-index"));
            z += isNaN(i) || i < 0 ? 0 : i;
            node = node!.parentNode;
        } while (
            node &&
            node !== document.body &&
            node !== (document as unknown as Node) &&
            node.nodeType !== node.DOCUMENT_FRAGMENT_NODE
        );
        return z;
    }

    function handleHint(evt?: Event & { keyCode?: number }): void {
        const hints = holder.querySelectorAll("div:not(:empty)") as unknown as NodeListOf<
            HintElement & { label: string; link: unknown }
        >;
        const hintState = refreshHints(hints, prefix);
        const elm: any = hintState.matched;
        if (elm) {
            normal.appendKeysForRepeat("Hints", prefix);
            if (typeof _onHintKey === "function") {
                if (behaviours.regionalHints) {
                    setTimeout(() => {
                        const overlay = createOverlay(elm, elm.skColorIndex, "99");
                        overlay.link = elm;
                        regionalHints.attach(overlay);
                    }, 10);
                } else {
                    _onHintKey(elm);
                }
            } else {
                if (elm.constructor.name === "Array") {
                    const target = elm[0];
                    // remove Text Node from elm as it cannot be transitted across JS scope
                    elm[0] = "__EVENT_TARGET__";
                    dispatchSKEvent("user", ["onHintClicked", elm], target);
                } else {
                    dispatchSKEvent("user", ["onHintClicked", shiftKey], elm);
                }
            }
            if (behaviours.multipleHits) {
                prefix = "";
                refreshHints(hints, prefix);
            } else {
                hide();
            }
        } else if (hintState.candidates === 0) {
            hide();
        }
        // suppress future key handler since the event has been treated as a hint
        if (evt) {
            Mode.suppressKeyUp(evt.keyCode!);
            evt.stopImmediatePropagation();
            evt.preventDefault();
        }
    }

    function refreshByTextFilter(): void {
        let hints = Array.from(holder.querySelectorAll("div")) as HintElement[];
        if (textFilter.length > 0) {
            hints = hints.filter((hint) => {
                hint.label = "";
                setSanitizedContent(hint, "");
                const e = hint.link;
                let text = e.innerText;
                if (text === undefined) {
                    text = e[0] ? e[0].textContent : "";
                }
                return text.indexOf(textFilter) !== -1;
            });
        }
        const hintLabels = self.genLabels(hints.length);
        hints.forEach((e, i) => {
            e.label = hintLabels[i];
            setSanitizedContent(e, hintLabels[i]);
        });
    }

    function hide(): void {
        // To reset default behaviours here is necessary, as some hint my be hit without creation.
        behaviours = {
            mouseEvents: MOUSE_EVENTS,
        };
        // Clean up temporary class added for array-based hint creation
        document.querySelectorAll(".surfingkeys--hints--creating").forEach((el) => {
            el.classList.remove("surfingkeys--hints--creating");
        });
        setSanitizedContent(holder, "");
        holder.remove();
        hintsHost.remove();
        prefix = "";
        textFilter = "";
        shiftKey = false;
        self.exit();
    }

    function flip(): void {
        const hints = holder.querySelectorAll("div") as unknown as NodeListOf<HintElement>;
        if (hints[0].style.zIndex == hints[0].zIndex) {
            hints.forEach((hint, i) => {
                const z = parseInt(hint.style.zIndex);
                hint.style.zIndex = String(hints.length - i + 2147483000 - z);
            });
        } else {
            hints.forEach((hint) => {
                hint.style.zIndex = hint.zIndex!;
            });
        }
    }

    function resetHints(): void {
        if (Mode.getCurrent() !== self || !document.documentElement.contains(hintsHost)) {
            return;
        }
        const start = new Date().getTime();
        const found = createHintsImpl(_cssSelector, _lastCreateAttrs);
        if (found > 0) {
            self.statusLine += " - " + (new Date().getTime() - start) + "ms / " + found;
            Mode.showStatus();
        }
    }

    function walkPageUrl(step: number): boolean {
        for (let i = 0; i < runtime.conf.pageUrlRegex.length; i++) {
            const numbers = window.location.href.match(runtime.conf.pageUrlRegex[i]);
            if (numbers && numbers.length === 4) {
                const cp = parseInt(numbers[2]);
                if (cp < 0xffffffff) {
                    window.location.href = numbers[1] + (cp + step) + numbers[3];
                    return true;
                }
            }
        }
        return false;
    }

    function uniqueLinks(links: Element[]): Element[] {
        const unique: Record<string, Element> = {};
        links.forEach((link) => {
            const href = link.getAttribute("href");
            if (href && !unique[href]) {
                unique[href] = link;
            }
        });
        return Object.values(unique);
    }

    /**
     * Click element or create hints for elements to click.
     *
     * @param links `string or array of HTMLElement`, click on it if there is only one in the array or `force` parameter is true, otherwise hints will be generated for them. If `links` is a string, it will be used as css selector for `getClickableElements`.
     * @param {boolean} [force=false] force to click the first input element whether there are more than one elements in `links` or not.
     * @name Hints.click
     *
     * @example
     * mapkey('zz', 'Hide replies', function() {
     *     Hints.click(document.querySelectorAll("#less-replies:not([hidden])"), true);
     * });
     */
    self.click = (links, force) => {
        let list: Element[];
        if (typeof links === "string") {
            list = getClickableElements(links);
        } else {
            list = links;
        }
        if (list.length > 1) {
            if (force) {
                list.forEach((u) => {
                    self.dispatchMouseClick(u);
                });
            } else {
                self.create(list, self.dispatchMouseClick);
            }
        } else if (list.length === 1) {
            self.dispatchMouseClick(list[0]);
        }
    };

    self.previousPage = () => {
        const prevLinks = uniqueLinks(
            getClickableElements("[rel=prev]", runtime.conf.prevLinkRegex),
        );
        if (prevLinks.length) {
            self.click(prevLinks);
            return true;
        } else {
            return walkPageUrl(-1);
        }
    };

    self.nextPage = () => {
        const nextLinks = uniqueLinks(
            getClickableElements("[rel=next]", runtime.conf.nextLinkRegex),
        );
        if (nextLinks.length) {
            self.click(nextLinks);
            return true;
        } else {
            return walkPageUrl(1);
        }
    };

    self.onScrollStarted = () => {
        if (!document.documentElement.contains(hintsHost)) {
            return;
        }
        setSanitizedContent(holder, "");
        holder.remove();
        prefix = "";
    };

    self.onScrollDone = resetHints;

    initSKFunctionListener(
        "hints",
        {
            scrollStarted: () => {
                const mode = Mode.getCurrent() as ScrollMode | undefined;
                if (mode?.onScrollStarted) mode.onScrollStarted();
            },
            scrollDone: () => {
                const mode = Mode.getCurrent() as ScrollMode | undefined;
                if (mode?.onScrollDone) mode.onScrollDone();
            },
            topBoundaryHit: self.previousPage,
            bottomBoundaryHit: self.nextPage,
            dispatchMouseClick: self.dispatchMouseClick,
        },
        true,
    );

    self.genLabels = (total) => {
        const chars = characters.toUpperCase();
        let hints = [""];
        let offset = 0;
        while (hints.length - offset < total || offset == 0) {
            const p = hints[offset++];
            for (let i = 0; i < chars.length; i++) {
                hints.push(p + chars[i]);
            }
        }
        hints = hints.slice(offset, offset + total);
        return hints;
    };

    self.coordinate = () => {
        // a hack to get co-ordinate
        const link = createElementWithContent("div", "A", { style: "top: 0; left: 0;" });
        holder.prepend(link);
        hintsHost.shadowRoot!.appendChild(holder);
        const br = link.getBoundingClientRect();
        const ret = {
            top: br.top + window.pageYOffset - document.documentElement.clientTop,
            left: br.left + window.pageXOffset - document.documentElement.clientLeft,
        };
        setSanitizedContent(holder, "");
        holder.remove();
        return ret;
    };

    function _initHolder(mode: string): void {
        setSanitizedContent(holder, "");
        holder.setAttribute("mode", mode);
        holder.style.display = "";
    }

    function createOverlay(e: HintElement, i: number, alpha: string): HintElement {
        e.skColorIndex = i;

        const be = e.getBoundingClientRect();
        const z = getZIndex(e);

        const frame = document.createElement("mask") as unknown as HintElement;
        frame.style.position = "fixed";
        frame.style.top = be.top + "px";
        frame.style.left = be.left + "px";
        frame.style.width = be.width - 4 + "px";
        frame.style.height = be.height - 4 + "px";
        frame.style.zIndex = String(z + 9999);
        frame.style.background = getColor(i) + alpha;
        frame.style.border = `2px solid ${getColor(i)}`;
        return frame;
    }

    function placeHints(elements: HintElement[]): void {
        _initHolder("click");
        const hintLabels = self.genLabels(elements.length);
        const bof = self.coordinate();
        const style = createElementWithContent("style", _styleForClick);
        holder.prepend(style);
        if (behaviours.regionalHints) {
            elements.forEach((e, i) => {
                holder.append(createOverlay(e, i, "33"));
            });
        }

        let lastTop = -1,
            lastLeft = -1;
        const links = elements.map((elm, i) => {
            const r = getRealRect(elm),
                z = getZIndex(elm);
            let left;
            const width = Math.min(r.width, window.innerWidth);
            if (runtime.conf.hintAlign === "right") {
                left = window.pageXOffset + r.left - bof.left + width;
            } else if (runtime.conf.hintAlign === "left") {
                left = window.pageXOffset + r.left - bof.left;
            } else {
                left = window.pageXOffset + r.left - bof.left + width / 2;
            }
            if (left < window.pageXOffset) {
                left = window.pageXOffset;
            } else if (left + 32 > window.pageXOffset + window.innerWidth) {
                left = window.pageXOffset + window.innerWidth - 32;
            }
            const link = createElementWithContent("div", hintLabels[i]) as HintElement;
            if (elm.dataset.hint_scrollable) {
                link.classList.add("hint-scrollable");
            }
            let lTop = Math.max(r.top + window.pageYOffset - bof.top, 0);
            if (lTop === lastTop && Math.abs(left - lastLeft) < 20) {
                left += 20 - Math.abs(left - lastLeft);
            } else if (left === lastLeft && Math.abs(lTop - lastTop) < 20) {
                lTop += 20 - Math.abs(lTop - lastTop);
            }
            link.style.top = lTop + "px";
            link.style.left = left + "px";
            link.style.zIndex = String(z + 9999);
            if (behaviours.regionalHints) {
                link.style.background = getColor(i);
            }
            link.zIndex = link.style.zIndex;
            link.label = hintLabels[i];
            link.link = elm;

            lastTop = lTop;
            lastLeft = left;
            return link;
        });
        links.forEach((link) => {
            holder.appendChild(link);
        });
        const hints = holder.querySelectorAll("div");
        let bcr = getRealRect(hints[0]);
        for (let i = 1; i < hints.length; i++) {
            const h = hints[i] as HTMLElement;
            const tcr = getRealRect(h);
            if (tcr.top === bcr.top && Math.abs(tcr.left - bcr.left) < bcr.width) {
                h.style.top = h.offsetTop + h.offsetHeight + "px";
            }
            bcr = getRealRect(h);
        }
        hintsHost.shadowRoot!.appendChild(holder);
    }

    function createHintsForElements(elements: Element[], attrs?: Record<string, any>): number {
        attrs = attrs || {};
        for (const attr in attrs) {
            behaviours[attr] = attrs[attr];
        }
        self.statusLine = (attrs && attrs.statusLine) || "Hints to click";

        const filtered = filterInvisibleElements(elements as HTMLElement[]);
        if (filtered.length > 0) {
            placeHints(filtered as HintElement[]);
        }
        return filtered.length;
    }

    function createHintsForClick(
        cssSelector: string | Element[],
        attrs?: Record<string, any>,
    ): number {
        self.statusLine = "Hints to click";

        attrs = attrs || {};
        for (const attr in attrs) {
            behaviours[attr] = attrs[attr];
        }
        let elements: HTMLElement[];
        if (cssSelector === "") {
            elements = getVisibleElements((e, v) => {
                if (isElementClickable(e)) {
                    v.push(e);
                }
            });
            elements = filterOverlapElements(elements) as HTMLElement[];
        } else if (Array.isArray(cssSelector)) {
            elements = filterInvisibleElements(cssSelector as HTMLElement[]);
        } else {
            elements = getVisibleElements((e, v) => {
                const input = e as HTMLInputElement;
                if (e.matches(cssSelector) && !input.disabled && !input.readOnly) {
                    v.push(e);
                }
            });
            elements = filterInvisibleElements(elements);
            elements = filterOverlapElements(elements) as HTMLElement[];
        }

        if (elements.length > 0) {
            placeHints(elements as HintElement[]);
        }

        return elements.length;
    }

    function createHintsForTextNode(rxp: RegExp, attrs?: Record<string, any>): number {
        for (const attr in attrs) {
            behaviours[attr] = attrs[attr];
        }
        self.statusLine = (attrs && attrs.statusLine) || "Hints to select text";

        const visible = getVisibleElements((e, v) => {
            const aa = e.childNodes;
            for (let i = 0, len = aa.length; i < len; i++) {
                if (aa[i].nodeType == Node.TEXT_NODE && (aa[i] as Text).data.length > 0) {
                    v.push(e);
                    break;
                }
            }
        });
        const textNodes: Text[] = visible.flatMap((e) => {
            const aa = e.childNodes;
            const bb: Text[] = [];
            for (let i = 0, len = aa.length; i < len; i++) {
                if (aa[i].nodeType == Node.TEXT_NODE && (aa[i] as Text).data.trim().length > 1) {
                    bb.push(aa[i] as Text);
                }
            }
            return bb;
        });

        let positions: [Text, number, string][];
        if (rxp.flags.indexOf("g") === -1) {
            positions = textNodes.map((e) => {
                return [e, 0, ""];
            });
        } else {
            positions = [];
            for (let i = 0, length = textNodes.length; i < length; i++) {
                const e = textNodes[i];
                let match;
                while ((match = rxp.exec(e.data)) != null) {
                    positions.push([e, match.index, match[0]]);
                }
            }
        }

        const elements = positions
            .map((e) => {
                const pos = getTextNodePos(e[0], e[1]);
                let caretViewport = [0, 0, window.innerHeight, window.innerWidth];
                if (runtime.conf.caretViewport && runtime.conf.caretViewport.length === 4) {
                    caretViewport = runtime.conf.caretViewport;
                }
                if (
                    e[0].data.trim().length === 0 ||
                    pos.top < caretViewport[0] ||
                    pos.left < caretViewport[1] ||
                    pos.top > caretViewport[2] ||
                    pos.left > caretViewport[3]
                ) {
                    return null;
                } else {
                    const z = getZIndex(e[0].parentNode);
                    const link = document.createElement("div") as HintElement;
                    if (e[1] === 0) {
                        link.className = "begin";
                    }
                    link.style.position = "fixed";
                    link.style.top = pos.top + "px";
                    link.style.left = pos.left + "px";
                    link.style.zIndex = String(z + 9999);
                    link.zIndex = link.style.zIndex;
                    link.link = e;
                    return link;
                }
            })
            .filter((e): e is HintElement => e !== null);
        if (document.getSelection()!.anchorNode) {
            document.getSelection()!.collapseToStart();
        }

        if (elements.length > 0) {
            _initHolder("text");
            const hintLabels = self.genLabels(elements.length);
            elements.forEach((e, i) => {
                e.label = hintLabels[i];
                setSanitizedContent(e, hintLabels[i]);
                holder.append(e);
            });

            const style = createElementWithContent("style", _styleForText);
            holder.prepend(style);
            hintsHost.shadowRoot!.appendChild(holder);
        }

        return elements.length;
    }

    function createHintsImpl(
        cssSelector: string | Element[] | RegExp,
        attrs?: Record<string, any>,
    ): number {
        placeHintsHost(hintsHost);
        if (cssSelector instanceof RegExp) {
            return createHintsForTextNode(cssSelector, attrs);
        } else if (Array.isArray(cssSelector)) {
            return createHintsForElements(cssSelector, attrs);
        }
        return createHintsForClick(cssSelector, attrs);
    }

    self.createInputLayer = () => {
        placeHintsHost(hintsHost);
        const cssSelector = getCssSelectorsOfEditable();

        let elements = getVisibleElements((e, v) => {
            const input = e as HTMLInputElement;
            if (
                e.matches(cssSelector) &&
                !input.disabled &&
                !input.readOnly &&
                (input.type === "text" ||
                    input.type === "email" ||
                    input.type === "search" ||
                    input.type === "password")
            ) {
                v.push(e);
            }
        });

        if (elements.length === 0 && document.querySelector(cssSelector) !== null) {
            document.querySelector(cssSelector)!.scrollIntoView();
            elements = getVisibleElements((e, v) => {
                const input = e as HTMLInputElement;
                if (e.matches(cssSelector) && !input.disabled && !input.readOnly) {
                    v.push(e);
                }
            });
        }

        if (elements.length > 1) {
            self.enter();
            _initHolder("input");
            elements.forEach((e) => {
                const be = e.getBoundingClientRect();
                const z = getZIndex(e);

                const mask = document.createElement("mask") as unknown as HintElement;
                mask.style.position = "fixed";
                mask.style.top = be.top + "px";
                mask.style.left = be.left + "px";
                mask.style.width = be.width + "px";
                mask.style.height = be.height + "px";
                mask.style.zIndex = String(z + 9999);
                mask.link = e;
                holder.append(mask);
            });
            hintsHost.shadowRoot!.appendChild(holder);
            _lastCreateAttrs.activeInput = 0;
            const ai = holder.querySelector("[mode=input]>mask") as HintElement;
            ai.classList.add("activeInput");
            normal.passFocus(true);
            ai.link.focus();
        } else if (elements.length === 1) {
            normal.passFocus(true);
            elements[0].focus();
            insert.enter(elements[0]);
        }
    };

    self.getSelector = () => {
        return _cssSelector;
    };

    /**
     * Create hints for elements to click.
     *
     * @param cssSelector `string or array of HTMLElement`, if `links` is a string, it will be used as css selector.
     * @param {function} onHintKey a callback function on hint keys pressed.
     * @param {object} [attrs=null] `active`: whether to activate the new tab when a link is opened, `tabbed`: whether to open a link in a new tab, `multipleHits`: whether to stay in hints mode after one hint is triggered.
     * @name Hints.create
     * @returns {Promise} which will be resolved how many hints are created.
     * @see Hints.dispatchMouseClick
     *
     * @example
     * mapkey('yA', '#7Copy a link URL to the clipboard', function() {
     *     Hints.create('*[href]', function(element) {
     *         Clipboard.write('[' + element.innerText + '](' + element.href + ')');
     *     });
     * });
     */
    self.create = (cssSelector, onHintKey, attrs) => {
        if (numeric) {
            characters = "1234567890";
        }

        // save last used attributes, which will be reused if the user scrolls while the hints are still open
        _cssSelector = cssSelector;
        _onHintKey = onHintKey;
        _lastCreateAttrs = attrs || {};

        const start = new Date().getTime();
        const found = createHintsImpl(cssSelector, attrs);
        if (found > (runtime.conf.hintExplicit ? 0 : 1)) {
            self.statusLine += " - " + (new Date().getTime() - start) + "ms / " + found;
            self.enter();
        } else {
            handleHint();
        }
        dispatchSKEvent("user", ["onHintCreated", found]);
        return new Promise<number>((resolve) => {
            resolve(found);
        });
    };

    self.mouseoutLastElement = () => {
        if (lastMouseTarget) {
            dispatchMouseEvent(lastMouseTarget, ["mouseout"], {});
            lastMouseTarget = null;
        }
    };

    let _styleForText = "",
        _styleForClick = "";
    /**
     * Set styles for hints.
     *
     * @param {string} css styles for hints.
     * @param {string} [mode=null] sub mode for hints, use `text` for hints mode to enter visual mode.
     * @name Hints.style
     *
     * @example
     * Hints.style('border: solid 3px #552a48; color:#efe1eb; background: none; background-color: #552a48;');
     * Hints.style("div{border: solid 3px #707070; color:#efe1eb; background: none; background-color: #707070;} div.begin{color:red;}", "text");
     */
    self.style = (css, mode) => {
        if (!/^div\b/.test(css)) {
            css = `div{${css}}`;
        }

        if (mode === "text") {
            _styleForText = css.replace(/\bdiv\b/g, "[mode='text'] div");
        } else {
            _styleForClick = css.replace(/\bdiv\b/g, "div");
        }
    };

    self.feedkeys = (keys) => {
        setTimeout(() => {
            prefix = keys.toUpperCase();
            handleHint();
        }, 1);
    };

    return self;
}

export default createHints;
