import Trie from "../common/trie";
import KeyboardUtils from "../common/keyboardUtils";
import Mode from "../common/mode";
import { debounce } from "lodash";
import { filterByTitleOrUrl, regexFromString } from "../../common/utils.js";
import {
    attachFaviconToImgSrc,
    constructSearchURL,
    createElementWithContent,
    getBrowserName,
    htmlEncode,
    parseAnnotation,
    safeDecodeURI,
    safeDecodeURIComponent,
    scrollIntoViewIfNeeded,
    showBanner,
    toggleQuote,
    timeStampString,
} from "../common/utils.js";
import { RUNTIME, runtime } from "../common/runtime.js";
import { createEffect, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ResultList } from "./components/ResultList";
import type { ResultListItem } from "./components/ResultList";
import { ResultPage } from "./components/ResultPage";
import { Prompt } from "./components/Prompt";

// `Normal` is referenced by a couple of omnibar mappings but is not defined in
// this module's scope in the original code; declared here so those paths keep
// their original (throwing) runtime behavior while type-checking.
declare const Normal: any;

const separator = "➤";
const separatorHtml = `<span class='separator'>${separator}</span>`;

/**
 * A harvested omnibar row: the fields ResultList renders, plus the data the
 * handlers and key bindings read back from the store instead of reaching into
 * the DOM (the legacy code stored these as expandos on each <li>).
 */
interface OmnibarResult extends ResultListItem {
    data: {
        uid?: string;
        url?: string;
        copy?: string;
        query?: string;
        windowId?: number;
        folderId?: string;
        folder_name?: string;
        cmd?: any;
        folder?: string;
        text: string;
    };
}

function createOmnibar(front: any, clipboard: any) {
    const self: any = new Mode("Omnibar");

    self.addEventListener("keydown", (event: any) => {
        if (event.sk_keyName?.length) {
            Mode.handleMapKey.call(self, event);
        }
        event.sk_suppressed = true;
    }).addEventListener("mousedown", (event: any) => {
        if (!ui.contains(event.target)) {
            front.hidePopup();
        }
        event.sk_suppressed = true;
    });

    self.mappings = new Trie();
    self.map_node = self.mappings;

    // The result list is a reactive store driven by a Solid <ResultList>; the
    // focused row is an index rather than a `.focused` DOM class, and the
    // per-row data the handlers read lives on the store item, not on the <li>.
    const [results, setResults] = createSignal<OmnibarResult[]>([]);
    const [focusedIndex, setFocusedIndex] = createSignal(-1);
    const [resultPage, setResultPage] = createSignal("");
    const [prompt, setPrompt] = createSignal("");
    self.setPrompt = setPrompt;
    const focusedResult = (): OmnibarResult | undefined => {
        const i = focusedIndex();
        return i >= 0 ? results()[i] : undefined;
    };
    // Exposed so the per-type handlers can read the focused row from the store
    // instead of querying the DOM.
    self.results = results;
    self.focusedIndex = focusedIndex;
    self.focusedResult = focusedResult;

    function getPosition() {
        let p = runtime.conf.omnibarPosition;
        if (handler && handler.omnibarPosition) {
            p = handler.omnibarPosition;
        }
        return p;
    }

    let savedFocused = -1;
    self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-d>"), {
        annotation: "Delete focused item from bookmark or history",
        feature_group: 8,
        code: function () {
            const fi = focusedResult();
            const idx = focusedIndex();
            if (fi && fi.data.uid) {
                RUNTIME("removeURL", { uid: fi.data.uid }, (ret: any) => {
                    if (ret.response !== "Done") {
                        return;
                    }
                    const remaining = results().slice();
                    remaining.splice(idx, 1);
                    setResults(remaining);
                    const bottom = getPosition() === "bottom";
                    const newIdx = bottom ? idx - 1 : idx;
                    if (newIdx >= 0 && newIdx < remaining.length) {
                        self.focusItem(newIdx);
                    } else {
                        savedFocused = bottom ? 0 : remaining.length;
                        self.input.dispatchEvent(new Event("input", { bubbles: true }));
                    }
                });
            }
        },
    });

    function reopen(cb: () => void) {
        front.hidePopup();
        setTimeout(cb, 100);
    }

    const searchEngine = SearchEngine(self, front);

    self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-j>"), {
        annotation: "Toggle Omnibar's position",
        feature_group: 8,
        code: function () {
            const savedInput = self.input.value;
            if (runtime.conf.omnibarPosition === "bottom") {
                runtime.conf.omnibarPosition = "middle";
            } else {
                runtime.conf.omnibarPosition = "bottom";
            }
            reopen(() => {
                _savedAargs.pref = savedInput;
                front.openOmnibar(_savedAargs);
            });
        },
    });

    self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-.>"), {
        annotation: "Show results of next page",
        feature_group: 8,
        code: function () {
            if (_items) {
                if (_start * runtime.conf.omnibarMaxResults < _items.length) {
                    _start++;
                } else {
                    _start = 1;
                }
                _listResultPage();
            }
        },
    });

    self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-,>"), {
        annotation: "Show results of previous page",
        feature_group: 8,
        code: function () {
            if (_items) {
                if (_start > 1) {
                    _start--;
                } else {
                    _start = Math.ceil(_items.length / runtime.conf.omnibarMaxResults);
                }
                _listResultPage();
            }
        },
    });

    self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-c>"), {
        annotation: "Copy selected item url or all listed item urls",
        feature_group: 8,
        code: function () {
            // hide Omnibar.input, so that we could use clipboard_holder to make copy
            self.input.style.display = "none";

            const fi = focusedResult();
            let text;
            if (fi && fi.data.copy) {
                text = fi.data.copy;
            } else if (fi && fi.data.url) {
                text = fi.data.url;
            } else if (_page) {
                text = _page
                    .map((p: any) => {
                        return p.url;
                    })
                    .join("\n");
            }
            clipboard.write(text);

            self.input.style.display = "";
        },
    });

    self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-D>"), {
        annotation: "Delete all listed items from bookmark or history",
        feature_group: 8,
        code: function () {
            const uids = results()
                .map((r) => r.data.uid)
                .filter((u) => u);
            if (uids.length) {
                RUNTIME("removeURL", { uid: uids }, (ret: any) => {
                    if (ret.response === "Done") {
                        if (handler && handler.getResults) {
                            handler.getResults();
                        }
                        self.triggerInput();
                    }
                });
            }
        },
    });

    self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-r>"), {
        annotation: "Re-sort history by visitCount or lastVisitTime",
        feature_group: 8,
        code: function () {
            if (handler && handler.onReset) {
                handler.onReset();
            }
        },
    });

    self.mappings.add(KeyboardUtils.encodeKeystroke("<Esc>"), {
        annotation: "Close Omnibar",
        feature_group: 8,
        code: function () {
            front.hidePopup();
        },
    });

    self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-m>"), {
        annotation: "Create vim-like mark for selected item",
        feature_group: 8,
        code: function (mark: string) {
            const fi = focusedResult();
            if (fi) {
                Normal.addVIMark(mark, fi.data.url);
            }
        },
    });

    const handlers: Record<string, any> = {};
    let bookmarkFolders: any;

    let lastInput = "";
    let handler: any;
    let lastHandler: any = null;
    const ui: any = document.getElementById("sk_omnibar");

    self.triggerInput = () => {
        const event = new Event("input", {
            bubbles: true,
            cancelable: true,
        });
        self.input.dispatchEvent(event);
    };

    self.expandAlias = (alias: string, val: string) => {
        let eaten = false;
        if (
            handler !== searchEngine &&
            alias.length &&
            Object.prototype.hasOwnProperty.call(searchEngine.aliases, alias)
        ) {
            lastHandler = handler;
            handler = searchEngine;
            Object.assign(searchEngine, searchEngine.aliases[alias]);
            setResults([]);
            setFocusedIndex(-1);
            setPrompt(handler.prompt);
            setResultPage("");
            _items = null;
            self.collapsingPoint = val;
            self.input.value = val;
            if (val.length) {
                self.triggerInput();
            }
            eaten = true;
        }
        return eaten;
    };

    self.collapseAlias = () => {
        let eaten = false;
        const val = self.input.value;
        if (
            lastHandler &&
            handler !== lastHandler &&
            (val === self.collapsingPoint || val === "")
        ) {
            handler = lastHandler;
            lastHandler = null;
            setPrompt(handler.prompt);
            if (val.length) {
                self.input.value = val.substr(0, val.length - 1);
            }
            self.triggerInput();
            eaten = true;
        }
        return eaten;
    };

    self.focusItem = (index: number) => {
        if (index >= 0 && index < results().length) {
            setFocusedIndex(index);
        }
    };

    function rotateResult(backward: boolean) {
        const total = results().length;
        if (total > 0) {
            let lastFocused = focusedIndex();
            lastFocused = lastFocused === -1 ? total : lastFocused;
            const toFocus =
                (backward ? lastFocused + total : lastFocused + total + 2) % (total + 1);
            if (toFocus < total) {
                setFocusedIndex(toFocus);
                handler.onTabKey && handler.onTabKey();
            } else {
                // the slot past the last item returns focus to the typed input
                setFocusedIndex(-1);
                self.input.value = lastInput;
            }
        }
    }

    const promptSpan = ui.querySelector("#sk_omnibarSearchArea>span.prompt");
    const resultPageSpan = ui.querySelector("#sk_omnibarSearchArea>span.resultPage");
    self.resultsDiv = ui.querySelector("#sk_omnibarSearchResult");

    render(
        () =>
            Prompt({
                get html() {
                    return prompt();
                },
            }),
        promptSpan,
    );
    render(
        () =>
            ResultPage({
                get text() {
                    return resultPage();
                },
            }),
        resultPageSpan,
    );

    function onResultSelect(index: number) {
        const d = results()[index]?.data;
        if (!d) {
            return;
        }
        if (d.url) {
            RUNTIME("openLink", { tab: { tabbed: true, active: true }, url: d.url });
        } else {
            self.input.value = d.query;
            self.input.focus();
        }
    }
    render(
        () =>
            ResultList({
                get items() {
                    return results();
                },
                get focusedIndex() {
                    return focusedIndex();
                },
                onSelect: onResultSelect,
            }),
        self.resultsDiv,
    );
    // Scroll the focused row into view once Solid has applied the focused class.
    createEffect(() => {
        if (focusedIndex() < 0) {
            return;
        }
        const fi = self.resultsDiv.querySelector("li.focused") as HTMLElement | null;
        if (fi) {
            const fiRect = fi.getBoundingClientRect();
            const resultsRect = self.resultsDiv.getBoundingClientRect();
            if (fiRect.top < resultsRect.top || fiRect.bottom > resultsRect.bottom) {
                fi.scrollIntoView(fiRect.top < resultsRect.top);
            }
        }
    });

    function _onIput(this: any) {
        if (lastInput !== self.input.value) {
            lastInput = self.input.value;
        }
        handler.onInput && handler.onInput.call(this);
    }
    function _onKeyDown(evt: any) {
        if (handler && handler.onKeydown && handler.onKeydown.call(evt.target, evt)) {
            return;
        }
        if (Mode.isSpecialKeyOf("<Esc>", evt.sk_keyName)) {
            front.hidePopup();
            evt.preventDefault();
        } else if (evt.keyCode === KeyboardUtils.keyCodes.enter) {
            handler.activeTab = !evt.ctrlKey;
            handler.tabbed = self.tabbed ^ evt.shiftKey;
            handler.onEnter() && front.hidePopup();
        } else if (evt.keyCode === KeyboardUtils.keyCodes.space) {
            const cursor = self.input.selectionStart;
            const textBeforeCursor = self.input.value.substring(0, cursor);
            const newQuery = self.input.value.substring(cursor);
            self.expandAlias(textBeforeCursor, newQuery) && evt.preventDefault();
        } else if (evt.keyCode === KeyboardUtils.keyCodes.backspace) {
            self.collapseAlias() && evt.preventDefault();
        }
    }
    function _createInput() {
        const _input: any = document.createElement("input");
        _input.oninput = _onIput;
        _input.onkeydown = _onKeyDown;
        _input.addEventListener("compositionstart", () => {
            _input.oninput = null;
            _input.onkeydown = null;
        });
        _input.addEventListener("compositionend", () => {
            _input.oninput = _onIput;
            _input.onkeydown = _onKeyDown;
            _onIput.call(_input);
        });
        return _input;
    }

    self.mappings.add(KeyboardUtils.encodeKeystroke("<Tab>"), {
        annotation: "Forward cycle through the candidates.",
        feature_group: 8,
        code: function () {
            rotateResult(getPosition() === "bottom");
        },
    });
    self.mappings.add(KeyboardUtils.encodeKeystroke("<Shift-Tab>"), {
        annotation: "Backward cycle through the candidates.",
        feature_group: 8,
        code: function () {
            rotateResult(getPosition() !== "bottom");
        },
    });
    self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-n>"), {
        annotation: "Forward cycle through the input history.",
        feature_group: 8,
        code: function () {
            if (handler && handler.rotateInput) {
                handler.rotateInput(getPosition() === "bottom");
            } else {
                rotateResult(getPosition() === "bottom");
            }
        },
    });
    self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-p>"), {
        annotation: "Backward cycle through the input history.",
        feature_group: 8,
        code: function () {
            if (handler && handler.rotateInput) {
                handler.rotateInput(getPosition() !== "bottom");
            } else {
                rotateResult(getPosition() !== "bottom");
            }
        },
    });
    self.mappings.add(KeyboardUtils.encodeKeystroke("<Ctrl-'>"), {
        annotation: "Toggle quotes in an input element",
        feature_group: 8,
        code: toggleQuote,
    });

    self.highlight = (rxp: RegExp | null, str: string) => {
        if (str.substr(0, 11) === "data:image/") {
            str = str.substr(0, 1024);
        }
        return rxp === null
            ? str
            : str.replace(rxp, (m) => {
                  return "<span class=omnibar_highlight>" + m + "</span>";
              });
    };

    self.createURLItem = (b: any, rxp: RegExp | null) => {
        b.title = b.title && b.title !== "" ? b.title : safeDecodeURI(b.url);
        let type = "🔥";
        let additional = "";
        let uid = b.uid;
        if (Object.prototype.hasOwnProperty.call(b, "lastVisitTime")) {
            type = "🕜";
            additional = `<span class=omnibar_timestamp># ${timeStampString(b.lastVisitTime)}</span>`;
            additional += `<span class=omnibar_visitcount> (${b.visitCount})</span>`;
            uid = "H" + b.url;
        } else if (Object.prototype.hasOwnProperty.call(b, "dateAdded")) {
            type = "⭐";
            additional = `<span class=omnibar_folder>@ ${bookmarkFolders[b.parentId].title || ""}</span> <span class=omnibar_timestamp># ${timeStampString(b.dateAdded)}</span>`;
            uid = "B" + b.id;
        } else if (Object.prototype.hasOwnProperty.call(b, "width")) {
            type = "🔖";
            uid = "T" + b.windowId + ":" + b.id;
            // } else if(b.type && /^\p{Emoji}$/u.test(b.type)) {
        } else if (b.type && b.type.length === 2 && b.type.charCodeAt(0) > 255) {
            type = b.type;
        }
        let li: any = createElementWithContent("li", `<div class="icon">${type}</div>`);
        if (Object.prototype.hasOwnProperty.call(b, "favIconUrl")) {
            li = createElementWithContent("li", `<img class="icon"/>`);
            attachFaviconToImgSrc(b, li.querySelector("img"));
        }
        li.appendChild(
            createElementWithContent(
                "div",
                `<div class="title">${self.highlight(rxp, htmlEncode(b.title))} ${additional}</div><div class="url">${self.highlight(rxp, htmlEncode(safeDecodeURIComponent(b.url)))}</div>`,
                { class: "text-container" },
            ),
        );
        li.uid = uid;
        li.url = b.url;
        return li;
    };

    self.createItemFromRawHtml = ({ html, props }: { html: string; props?: any }) => {
        const li: any = createElementWithContent("li", html);
        if (typeof props === "object") {
            Object.assign(li, props);
        }
        return li;
    };

    self.detectAndInsertURLItem = (str: string, toList: any[]) => {
        const urlPat = /^(?:https?:\/\/)?(?:[^@/\n]+@)?(?:www\.)?([^:/\n\s]+)\.([^:/\n\s]+)/i;
        const urlPat1 = /^https?:\/\/(?:[^@/\n]+@)?([^:/\n\s]+)/i;
        if (urlPat.test(str)) {
            let url = str;
            if (!/^https?:\/\//.test(str)) {
                url = "http://" + str;
            }
            toList.unshift({
                title: str,
                url: url,
            });
        } else if (urlPat1.test(str)) {
            toList.unshift({
                title: str,
                url: str,
            });
        }
    };

    let _start: number;
    let _items: any;
    let _showFolder: boolean;
    let _page: any;

    self.getPageSize = () => {
        return runtime.conf.omnibarMaxResults;
    };

    self.getHistoryCacheSize = () => {
        return runtime.conf.omnibarHistoryCacheSize;
    };

    self.listURLs = (items: any[], showFolder: boolean) => {
        _start = 1;
        _items = items;
        _showFolder = showFolder;
        _listResultPage();
        if (savedFocused !== -1) {
            self.focusItem(savedFocused);
            savedFocused = -1;
        }
    };
    self.getItems = () => {
        return _items;
    };

    function _listResultPage() {
        const si = (_start - 1) * runtime.conf.omnibarMaxResults;
        let ei = si + runtime.conf.omnibarMaxResults;
        ei = ei > _items.length ? _items.length : ei;
        let total: number | string = _items.length;
        if (total === runtime.conf.omnibarHistoryCacheSize) {
            total = total + "+";
        }
        setResultPage(`${si + 1} - ${ei} / ${total}`);
        _page = _items.slice(si, ei);
        const query = self.input.value.trim();
        let rxp: RegExp | null = null;
        if (query.length) {
            rxp = regexFromString(query, runtime.getCaseSensitive(query), true);
        }
        self.listResults(_page, (b: any) => {
            let li;
            if (Object.prototype.hasOwnProperty.call(b, "html")) {
                li = self.createItemFromRawHtml(b);
            } else if (Object.prototype.hasOwnProperty.call(b, "url") && b.url !== undefined) {
                if (getBrowserName() === "Firefox" && /^(place|data):/i.test(b.url)) {
                    return null;
                }
                li = self.createURLItem(b, rxp);
            } else if (_showFolder) {
                li = createElementWithContent(
                    "li",
                    `<div class="title">▷ ${self.highlight(rxp, b.title)}</div>`,
                ) as any;
                li.folder_name = b.title;
                li.folderId = b.id;
            }
            return li;
        });
    }

    let _savedAargs: any;
    ui.onShow = (args: any) => {
        handler = handlers[args.type];
        if (!self.input) {
            self.input = _createInput();
            document
                .querySelector("#sk_omnibarSearchArea")!
                .insertBefore(self.input, resultPageSpan);
        }
        _savedAargs = args;
        ui.classList.remove("sk_omnibar_middle");
        ui.classList.remove("sk_omnibar_bottom");
        ui.classList.add("sk_omnibar_" + getPosition());
        if (getPosition() === "bottom") {
            self.resultsDiv.remove();
            ui.insertBefore(self.resultsDiv, document.querySelector("#sk_omnibarSearchArea"));
        } else {
            self.resultsDiv.remove();
            ui.append(self.resultsDiv);
        }

        self.tabbed = args.tabbed !== undefined ? args.tabbed : true;
        self.input.focus();
        self.enter();
        if (args.pref) {
            self.input.value = args.pref;
        }
        self.resultsDiv.className = "";
        handler.onOpen && handler.onOpen(args.extra);
        lastHandler = handler;
        setPrompt(handler.prompt);
        setResultPage("");
        ui.scrollTop = 0;
    };

    ui.onHide = () => {
        // clear cache
        delete self.cachedPromise;
        // delete only deletes properties of an object and
        // cannot normally delete a variable declared using var, whatever the scope.
        _items = null;
        bookmarkFolders = null;

        lastInput = "";
        self.input.value = "";
        self.input.placeholder = "";
        setResults([]);
        setFocusedIndex(-1);
        lastHandler = null;
        handler.onClose && handler.onClose();
        self.exit();
        handler = null;
    };

    self.isUrl = (input: string) => {
        if (input.match(/\s+/)) {
            return false;
        }

        if (input.match(/^https?:\/\//)) {
            return true;
        }

        const regex =
            /^(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)$/;

        return input.match(regex);
    };

    self.openFocused = function (this: any) {
        const fi = focusedResult();
        let url;
        if (fi) {
            url = fi.data.url;
        } else {
            url = self.input.value;
            if (!self.isUrl(url)) {
                url = searchEngine.aliases[runtime.conf.defaultSearchEngine].url + url;
            }
        }
        let type = "";
        let uid = "";
        if (fi && fi.data.uid) {
            uid = fi.data.uid;
            type = uid[0];
            uid = uid.substr(1);
        }
        if (type === "T") {
            const parts = uid.split(":");
            RUNTIME("focusTab", {
                windowId: parseInt(parts[0]),
                tabId: parseInt(parts[1]),
            });
        } else if (url && url.length) {
            RUNTIME("openLink", {
                tab: {
                    tabbed: this.tabbed,
                    active: this.activeTab,
                },
                url: url,
            });
        }
        return this.activeTab;
    };

    self.listResults = (items: any, renderItem: (b: any) => any) => {
        if (!items || items.length === 0) {
            setResults([]);
            setFocusedIndex(-1);
            return;
        }
        if (getPosition() === "bottom") {
            items.reverse();
        }
        // The per-handler renderItem still builds a detached <li>; harvest its
        // display HTML and the expando data the handlers read, then let
        // <ResultList> render the rows reactively from the store.
        const built: OmnibarResult[] = [];
        items.forEach((b: any) => {
            const li: any = renderItem(b);
            if (li) {
                const img = li.querySelector ? li.querySelector("img.icon") : null;
                built.push({
                    html: li.innerHTML,
                    className: li.className || undefined,
                    faviconSrc: img ? (img.getAttribute("src") ?? undefined) : undefined,
                    data: {
                        uid: li.uid,
                        url: li.url,
                        copy: li.copy,
                        query: li.query,
                        windowId: li.windowId,
                        folderId: li.folderId,
                        folder_name: li.folder_name,
                        cmd: li.cmd,
                        folder: li.getAttribute
                            ? (li.getAttribute("folder") ?? undefined)
                            : undefined,
                        text: li.textContent ?? "",
                    },
                });
            }
        });
        setResults(built);
        if (runtime.conf.focusFirstCandidate || handler.focusFirstCandidate) {
            setFocusedIndex(getPosition() === "bottom" ? built.length - 1 : 0);
        } else {
            setFocusedIndex(-1);
        }
        if (getPosition() === "bottom" && built.length > 0) {
            const lis = self.resultsDiv.querySelectorAll("#sk_omnibarSearchResult>ul>li");
            if (lis.length) {
                scrollIntoViewIfNeeded(lis[lis.length - 1]);
            }
        }
    };

    self.listWords = (words: any[]) => {
        self.listResults(words, (w: any) => {
            const li: any = createElementWithContent("li", `⌕ ${w}`);
            li.query = w;
            return li;
        });
    };

    self.html = (content: string) => {
        // Show a single raw-HTML row through the store so the Solid mount that
        // owns resultsDiv is not clobbered by a direct innerHTML write.
        setResults([{ html: content, data: { text: "" } }]);
        setFocusedIndex(-1);
    };

    self.addHandler = (name: string, hdl: any) => {
        if (!hdl.onEnter) {
            hdl.onEnter = self.openFocused.bind(hdl);
        }
        handlers[name] = hdl;
    };

    self.listBookmarkFolders = (cb?: (response: any, folders: any) => void) => {
        RUNTIME("getBookmarkFolders", null, (response: any) => {
            bookmarkFolders = {};
            response.folders.forEach((f: any) => {
                bookmarkFolders[f.id] = f;
            });
            cb && cb(response, bookmarkFolders);
        });
    };

    self.addHandler("Bookmarks", OpenBookmarks(self));
    self.addHandler("AddBookmark", AddBookmark(self));
    self.addHandler(
        "History",
        OpenURLs(`history${separatorHtml}`, self, () => {
            return new Promise((resolve) => {
                RUNTIME(
                    "getHistory",
                    {
                        maxResults: self.getHistoryCacheSize(),
                        query: self.input.value,
                        sortByMostUsed: runtime.conf.historyMUOrder,
                    },
                    (response: any) => {
                        resolve(response.history);
                    },
                );
            });
        }),
    );
    self.addHandler(
        "URLs",
        OpenURLs(separatorHtml, self, () => {
            return new Promise((resolve) => {
                RUNTIME(
                    "getTabs",
                    { queryInfo: runtime.conf.omnibarTabsQuery },
                    (response: any) => {
                        let results = response.tabs;
                        RUNTIME("getTopSites", null, (response2: any) => {
                            results = results.concat(response2.urls);
                            results = filterByTitleOrUrl(
                                results,
                                self.input.value,
                                runtime.getCaseSensitive(self.input.value),
                            );
                            self.listBookmarkFolders(() => {
                                RUNTIME(
                                    "getAllURLs",
                                    {
                                        maxResults: self.getHistoryCacheSize() - results.length,
                                        query: self.input.value,
                                    },
                                    (response3: any) => {
                                        results = results.concat(response3.urls);
                                        resolve(results);
                                    },
                                );
                            });
                        });
                    },
                );
            });
        }),
    );
    self.addHandler(
        "RecentlyClosed",
        OpenURLs(`Recently closed${separatorHtml}`, self, () => {
            return new Promise((resolve) => {
                RUNTIME("getRecentlyClosed", null, (response: any) => {
                    resolve(
                        filterByTitleOrUrl(
                            response.urls,
                            self.input.value,
                            runtime.getCaseSensitive(self.input.value),
                        ),
                    );
                });
            });
        }),
    );
    self.addHandler(
        "TabURLs",
        OpenURLs(`Tab History${separatorHtml}`, self, () => {
            return new Promise((resolve) => {
                RUNTIME("getTabURLs", null, (response: any) => {
                    resolve(
                        filterByTitleOrUrl(
                            response.urls,
                            self.input.value,
                            runtime.getCaseSensitive(self.input.value),
                        ),
                    );
                });
            });
        }),
    );
    self.addHandler("Tabs", OpenTabs(self));
    self.addHandler("CloseTabs", CloseTabs(self));
    self.addHandler("Windows", OpenWindows(self, front));
    self.addHandler("VIMarks", OpenVIMarks(self));
    self.addHandler("SearchEngine", searchEngine);
    self.addHandler("Commands", Commands(self, front));
    self.addHandler("OmniQuery", OmniQuery(self, front));
    self.addHandler("UserURLs", OpenUserURLs(self));

    front._actions["updateOmnibarResult"] = (message: any) => {
        self.listWords(message.words);
    };
    return self;
}

function OpenBookmarks(omnibar: any): any {
    const self: any = {
        prompt: `bookmark${separatorHtml}`,
        inFolder: [],
    };

    let folderOnly = false;
    let currentFolderId: any;
    let lastFocused = 0;

    function onFolderUp() {
        const fl = self.inFolder.pop();
        if (fl.folderId) {
            currentFolderId = fl.folderId;
            RUNTIME("getBookmarks", { parentId: currentFolderId }, self.onResponse);
        } else {
            currentFolderId = undefined;
            RUNTIME("getBookmarks", null, self.onResponse);
        }
        self.prompt = fl.prompt;
        omnibar.setPrompt(self.prompt);
        lastFocused = fl.focused;
    }

    self.onEnter = function (this: any) {
        let ret = false;
        const fi = omnibar.focusedResult();
        const folderId = fi?.data.folderId;
        if (folderId && !this.activeTab) {
            RUNTIME("getBookmarks", { parentId: folderId }, (response: any) => {
                const subItems = response.bookmarks;
                for (const m of subItems) {
                    if (m.url) {
                        RUNTIME("openLink", {
                            tab: {
                                tabbed: true,
                                active: false,
                            },
                            url: m.url,
                        });
                    }
                }
            });
            self.inFolder.push({
                prompt: self.prompt,
                folderId: currentFolderId,
                focused: omnibar.focusedIndex(),
            });
            localStorage.setItem("surfingkeys.lastOpenBookmark", JSON.stringify(self.inFolder));
        } else if (folderId) {
            self.inFolder.push({
                prompt: self.prompt,
                folderId: currentFolderId,
                focused: omnibar.focusedIndex(),
            });
            self.prompt = fi.data.folder_name + separator;
            omnibar.setPrompt(self.prompt);
            omnibar.input.value = "";
            currentFolderId = folderId;
            lastFocused = 0;
            RUNTIME("getBookmarks", { parentId: currentFolderId }, self.onResponse);
        } else {
            ret = omnibar.openFocused.call(self);
            if (ret) {
                self.inFolder.push({
                    prompt: self.prompt,
                    folderId: currentFolderId,
                    focused: omnibar.focusedIndex(),
                });
                localStorage.setItem("surfingkeys.lastOpenBookmark", JSON.stringify(self.inFolder));
            }
        }
        return ret;
    };

    self.onOpen = () => {
        omnibar.listBookmarkFolders(() => {
            const lastBookmarkFolder = localStorage.getItem("surfingkeys.lastOpenBookmark");
            if (lastBookmarkFolder) {
                self.inFolder = JSON.parse(lastBookmarkFolder);
                onFolderUp();
            } else {
                RUNTIME("getBookmarks", null, self.onResponse);
            }
            if (omnibar.input.value !== "") {
                self.onInput();
            }
        });
    };

    self.onClose = () => {
        self.inFolder = [];
        self.prompt = `bookmark${separatorHtml}`;
        currentFolderId = undefined;
    };

    self.onKeydown = function (event: any) {
        let eaten = false;
        if (event.keyCode === KeyboardUtils.keyCodes.comma) {
            folderOnly = !folderOnly;
            self.prompt = folderOnly ? `bookmark folder${separator}` : `bookmark${separator}`;
            omnibar.setPrompt(self.prompt);
            RUNTIME(
                "getBookmarks",
                { parentId: currentFolderId, query: omnibar.input.value },
                self.onResponse,
            );
            eaten = true;
        } else if (
            event.keyCode === KeyboardUtils.keyCodes.backspace &&
            self.inFolder.length &&
            !omnibar.input.value.length
        ) {
            onFolderUp();
            eaten = true;
        } else if (event.ctrlKey && event.shiftKey && KeyboardUtils.isWordChar(event)) {
            const fi = omnibar.focusedResult();
            if (fi) {
                const mark_char = String.fromCharCode(event.keyCode);
                Normal.addVIMark(mark_char, fi.data.url);
                eaten = true;
            }
        }
        return eaten;
    };
    self.onInput = () => {
        const query = omnibar.input.value;
        RUNTIME(
            "getBookmarks",
            {
                parentId: currentFolderId,
                caseSensitive: runtime.getCaseSensitive(query),
                query,
            },
            self.onResponse,
        );
    };
    self.onResponse = (response: any) => {
        let items = response.bookmarks;
        if (folderOnly) {
            items = items.filter((b: any) => {
                return !Object.prototype.hasOwnProperty.call(b, "url") || b.url === undefined;
            });
        }
        omnibar.listURLs(items, true);

        if (omnibar.focusedIndex() < 0) {
            omnibar.focusItem(lastFocused);
        }
    };

    return self;
}

function AddBookmark(omnibar: any): any {
    const self: any = {
        focusFirstCandidate: true,
        prompt: `add bookmark${separatorHtml}`,
    };
    let folders: any[];

    self.onOpen = (arg: any) => {
        self.page = arg;
        omnibar.listBookmarkFolders((response: any) => {
            folders = response.folders;
            omnibar.listResults(folders.slice(), (f: any) => {
                return createElementWithContent("li", `▷ ${f.title}`, { folder: f.id });
            });
            RUNTIME("getBookmark", null, (resp: any) => {
                if (resp.bookmarks.length) {
                    const b = resp.bookmarks[0];
                    omnibar.setPrompt(`edit bookmark${separatorHtml}`);
                    const idx = omnibar
                        .results()
                        .findIndex((r: any) => r.data.folder === String(b.parentId));
                    if (idx >= 0) {
                        omnibar.focusItem(idx);
                    }
                }

                //restore the last used bookmark folder input
                const lastBookmarkFolder = localStorage.getItem("surfingkeys.lastAddedBookmark");
                if (lastBookmarkFolder) {
                    omnibar.input.value = lastBookmarkFolder;

                    //make the input selected, so if user don't want to use it,
                    //just input to overwrite the previous value
                    omnibar.input.select();

                    // trigger omnibar input matching
                    self.onInput();
                }
            });
        });
    };

    self.onTabKey = () => {
        const fi = omnibar.focusedResult();
        if (fi) {
            omnibar.input.value = fi.data.text.substr(2);
        }
    };

    self.onEnter = () => {
        self.page.path = [];
        const fi = omnibar.focusedResult();
        let folderName: string | undefined;
        if (fi) {
            self.page.folder = fi.data.folder;
            folderName = fi.data.text.substr(2);
        } else {
            let path = omnibar.input.value;
            path = path.split("/");
            const title = path.pop();
            if (title.length) {
                self.page.title = title;
            }
            path = path.filter((p: string) => {
                return p.length > 0;
            });
            for (let l = path.length; l > 0; l--) {
                const targetFolder = folders.filter((f) => {
                    return f.title === `/${path.slice(0, l).join("/")}/`;
                });
                if (targetFolder.length) {
                    self.page.folder = targetFolder[0].id;
                    self.page.path = path.slice(l);
                    folderName = "/" + path.join("/");
                    break;
                }
            }
            if (self.page.folder === undefined) {
                self.page.folder = folders[0].id;
                self.page.path = path;
                folderName = `${folders[0].title}${path.join("/")}`;
            }
        }
        RUNTIME("createBookmark", { page: self.page }, () => {
            showBanner("Bookmark created at {0}.".format(folderName), 3000);
        });
        localStorage.setItem("surfingkeys.lastAddedBookmark", omnibar.input.value);
        return true;
    };

    self.onInput = () => {
        const query = omnibar.input.value;
        const caseSensitive = runtime.getCaseSensitive(query);
        const matches = folders.filter((b) => {
            if (caseSensitive) return b.title.indexOf(query) !== -1;
            else return b.title.toLowerCase().indexOf(query.toLowerCase()) !== -1;
        });
        omnibar.listResults(matches, (f: any) => {
            return createElementWithContent("li", `▷ ${f.title}`, { folder: f.id });
        });
    };

    return self;
}

function OpenURLs(prompt: string, omnibar: any, queryFn: () => Promise<any>): any {
    const self: any = { prompt };
    let sequenceNumber: number;

    const queryAndList = () => {
        const myseq = ++sequenceNumber;
        queryFn().then((urls) => {
            if (myseq === sequenceNumber) {
                const val = omnibar.input.value;
                omnibar.detectAndInsertURLItem(val, urls);
                omnibar.listURLs(urls, false);
            }
        });
    };
    self.onOpen = (arg: any) => {
        if (arg) {
            omnibar.input.value = arg;
        }
        sequenceNumber = 0;
        queryAndList();
    };
    self.onInput = debounce(queryAndList, 200);
    self.onClose = () => {
        self.onInput.cancel();
    };

    self.onReset = () => {
        runtime.conf.historyMUOrder = !runtime.conf.historyMUOrder;
        queryFn().then((historyItems) => {
            if (runtime.conf.historyMUOrder) {
                historyItems = historyItems.sort((a: any, b: any) => {
                    return b.visitCount - a.visitCount;
                });
            } else {
                historyItems = historyItems.sort((a: any, b: any) => {
                    return b.lastVisitTime - a.lastVisitTime;
                });
            }
            omnibar.listURLs(historyItems, false);
        });
    };
    return self;
}

function OpenTabs(omnibar: any): any {
    const self: any = {
        focusFirstCandidate: true,
    };

    let getTabsArgs: any = {};
    self.getResults = () => {
        omnibar.cachedPromise = new Promise((resolve) => {
            getTabsArgs.tabsThreshold = Math.min(
                runtime.conf.tabsThreshold,
                Math.ceil(window.innerWidth / 26),
            );
            RUNTIME("getTabs", getTabsArgs, (response: any) => {
                resolve(response.tabs);
            });
        });
    };
    self.onOpen = (args: any) => {
        if (args && args.action === "gather") {
            self.prompt = `Gather filtered tabs into current window${separatorHtml}`;
            self.onEnter = () => {
                RUNTIME("gatherTabs", {
                    tabs: omnibar.getItems(),
                });
                return true;
            };
            getTabsArgs = { queryInfo: { currentWindow: false } };
        } else {
            self.prompt = `tabs${separatorHtml}`;
            self.onEnter = omnibar.openFocused.bind(self);
            getTabsArgs = {};
            if (args && typeof args.filter === "string") {
                getTabsArgs.filter = args.filter;
            }
        }
        self.getResults();
        self.onInput();
    };
    self.onInput = () => {
        omnibar.cachedPromise.then((cached: any) => {
            const filtered = filterByTitleOrUrl(
                cached,
                omnibar.input.value,
                runtime.getCaseSensitive(omnibar.input.value),
            );
            omnibar.listURLs(filtered, false);
        });
    };
    return self;
}

function CloseTabs(omnibar: any): any {
    const self: any = {
        focusFirstCandidate: true,
    };

    self.onOpen = () => {
        self.prompt = `close tabs${separatorHtml}`;
        omnibar.cachedPromise = new Promise((resolve) => {
            RUNTIME("getTabs", { queryInfo: { currentWindow: true } }, (response: any) => {
                resolve(response.tabs);
            });
        });
        self.onInput();
    };
    self.onInput = () => {
        omnibar.cachedPromise.then((cached: any) => {
            const filtered = filterByTitleOrUrl(
                cached,
                omnibar.input.value,
                runtime.getCaseSensitive(omnibar.input.value),
            );
            filtered.forEach((tab: any) => {
                try {
                    const u = new URL(tab.url);
                    tab.url = u.origin + u.pathname;
                } catch {
                    /* ignore invalid URL */
                }
            });
            omnibar.listURLs(filtered, false);
        });
    };
    self.onEnter = () => {
        const tabIds: number[] = [];
        omnibar.results().forEach((r: any) => {
            const uid = r.data.uid;
            if (uid && uid[0] === "T") {
                const parts = uid.substr(1).split(":");
                tabIds.push(parseInt(parts[1]));
            }
        });
        if (tabIds.length > 0) {
            RUNTIME("closeTabByIds", { tabIds: tabIds });
        }
        return true;
    };
    return self;
}

function OpenWindows(omnibar: any, front: any): any {
    const self: any = {
        prompt: `Move current tab to window${separatorHtml}`,
    };

    self.getResults = () => {
        omnibar.cachedPromise = new Promise((resolve) => {
            RUNTIME("getWindows", { query: "" }, (response: any) => {
                resolve(response.windows);
            });
        });
    };
    self.onEnter = () => {
        const fi = omnibar.focusedResult();
        let windowId = -1;
        if (fi && fi.data.windowId !== undefined) {
            windowId = fi.data.windowId;
        }
        RUNTIME("moveToWindow", { windowId });
        return true;
    };
    self.onOpen = () => {
        omnibar.input.placeholder = "Press enter without focusing an item to move to a new window.";
        self.getResults();
        self.onInput();
    };
    self.onInput = () => {
        omnibar.cachedPromise.then((cached: any) => {
            if (cached.length === 0) {
                RUNTIME("moveToWindow", { windowId: -1 });
                front.hidePopup();
            }
            let filtered = cached;
            const query = omnibar.input.value;
            let rxp: RegExp | null = null;
            if (query && query.length) {
                rxp = regexFromString(query, runtime.getCaseSensitive(query), false);
                filtered = cached.filter((w: any) => {
                    for (const t of w.tabs) {
                        if (rxp!.test(t.title) || rxp!.test(t.url)) {
                            return true;
                        }
                    }
                    return false;
                });
            }
            rxp = regexFromString(query, runtime.getCaseSensitive(query), true);
            omnibar.listResults(filtered, (w: any) => {
                const li: any = createElementWithContent("li");
                li.windowId = parseInt(w.id);
                li.classList.add("window");
                if (w.isPreviousChoice) {
                    li.classList.add("focused");
                }
                w.tabs.forEach((t: any) => {
                    const div = createElementWithContent("div", "", { class: "tab_in_window" });
                    div.appendChild(
                        createElementWithContent("div", omnibar.highlight(rxp, t.title), {
                            class: "title",
                        }),
                    );
                    div.appendChild(
                        createElementWithContent(
                            "div",
                            omnibar.highlight(rxp, new URL(t.url).origin),
                            {
                                class: "url",
                            },
                        ),
                    );
                    li.appendChild(div);
                });
                // set url so that we can copy all URls of tabs in this window.
                li.url = w.tabs
                    .map((t: any) => {
                        return t.url;
                    })
                    .join("\n");
                return li;
            });
        });
    };
    return self;
}

function OpenVIMarks(omnibar: any): any {
    const self: any = {
        focusFirstCandidate: true,
        prompt: `VIMarks${separatorHtml}`,
    };

    self.onOpen = () => {
        const query = omnibar.input.value;
        const urls: any[] = [];
        RUNTIME("getSettings", { key: "marks" }, (response: any) => {
            for (const m in response.settings.marks) {
                let markInfo = response.settings.marks[m];
                if (typeof markInfo === "string") {
                    markInfo = {
                        url: markInfo,
                        scrollLeft: 0,
                        scrollTop: 0,
                    };
                }
                if (query === "" || markInfo.url.indexOf(query) !== -1) {
                    urls.push({
                        title: m,
                        type: "🔗",
                        uid: "M" + m,
                        url: markInfo.url,
                    });
                }
            }
            omnibar.listURLs(urls, false);
        });
    };
    self.onInput = self.onOpen;
    return self;
}

function SearchEngine(omnibar: any, front: any): any {
    const self: any = {};
    self.aliases = {};

    let _pendingRequest: ReturnType<typeof setTimeout> | undefined = undefined; // timeout ID
    function clearPendingRequest() {
        if (_pendingRequest) {
            clearTimeout(_pendingRequest);
            _pendingRequest = undefined;
        }
    }
    self.onOpen = (arg: any) => {
        Object.assign(self, self.aliases[arg]);
        const q = omnibar.input.value;
        if (q.length) {
            const b = q.match(/^(site:\S+\s*).*/);
            if (b) {
                omnibar.input.setSelectionRange(b[1].length, q.length);
            }
            omnibar.triggerInput();
        }
    };
    self.onClose = () => {
        clearPendingRequest();
        self.prompt = undefined;
        self.url = undefined;
        self.suggestionURL = undefined;
    };
    self.onTabKey = () => {
        const fi = omnibar.focusedResult();
        if (fi && fi.data.query) {
            omnibar.input.value = fi.data.query;
        }
    };
    self.onEnter = function (this: any) {
        const fi = omnibar.focusedResult();
        let url;
        if (fi) {
            url =
                fi.data.url ||
                constructSearchURL(
                    self.url,
                    encodeURIComponent(fi.data.query || omnibar.input.value),
                );
        } else {
            url = constructSearchURL(self.url, encodeURIComponent(omnibar.input.value));
        }
        RUNTIME("openLink", {
            tab: {
                tabbed: this.tabbed,
                active: this.activeTab,
            },
            url: url,
        });
        return this.activeTab;
    };
    function listSuggestions(suggestions: any[]) {
        omnibar.detectAndInsertURLItem(omnibar.input.value, suggestions);
        const query = encodeURIComponent(omnibar.input.value);
        const rxp = regexFromString(query, runtime.getCaseSensitive(query), true);
        omnibar.listResults(suggestions, (w: any) => {
            if (Object.prototype.hasOwnProperty.call(w, "html")) {
                return omnibar.createItemFromRawHtml(w);
            } else if (Object.prototype.hasOwnProperty.call(w, "url")) {
                return omnibar.createURLItem(w, rxp);
            } else {
                const li: any = createElementWithContent("li", `⌕ ${w}`);
                li.query = w;
                return li;
            }
        });
    }
    self.onInput = () => {
        const canSuggest = self.suggestionURL;
        const showSuggestions = canSuggest && runtime.conf.omnibarSuggestion;

        if (!showSuggestions) {
            listSuggestions([]);
            return;
        }

        clearPendingRequest();
        // Set a timeout before the request is dispatched so that it can be canceled if necessary.
        // This helps prevent rate-limits when typing a long query.
        // E.g. github.com's API rate-limits after only 10 unauthenticated requests.
        _pendingRequest = setTimeout(() => {
            const requestUrl = constructSearchURL(
                self.suggestionURL,
                encodeURIComponent(omnibar.input.value),
            );
            RUNTIME("request", { method: "get", url: requestUrl }, (resp: any) => {
                front.contentCommand(
                    {
                        action: "getSearchSuggestions",
                        url: self.suggestionURL,
                        query: omnibar.input.value,
                        requestUrl,
                        response: resp,
                    },
                    (resp2: any) => {
                        let data = resp2.data;
                        if (!Array.isArray(data)) {
                            data = [];
                        }
                        listSuggestions(data);
                    },
                );
            });
        }, runtime.conf.omnibarSuggestionTimeout);
    };

    front._actions["addSearchAlias"] = (message: any) => {
        self.aliases[message.alias] = {
            prompt: "" + message.prompt + separatorHtml,
            url: message.url,
            suggestionURL: message.suggestionURL,
        };
        const searchEngineIconStorageKey = `surfingkeys.searchEngineIcon.${message.prompt}`;
        const searchEngineIcon = localStorage.getItem(searchEngineIconStorageKey);
        if (searchEngineIcon) {
            self.aliases[message.alias].prompt =
                `<img src="${searchEngineIcon}" alt="${message.prompt}" style="width: 20px;" />`;
        } else if (front.topOrigin.startsWith("http")) {
            let iconUrl;
            if (message.options?.favicon_url) {
                iconUrl = new URL(message.options.favicon_url);
            } else {
                iconUrl = new URL(message.url);
                iconUrl.pathname = "favicon.ico";
                iconUrl.search = "";
                iconUrl.hash = "";
            }
            RUNTIME("requestImage", { url: iconUrl.href }, (response: any) => {
                if (response) {
                    localStorage.setItem(searchEngineIconStorageKey, response.text);
                    self.aliases[message.alias].prompt =
                        `<img src="${response.text}" alt="${message.prompt}" style="width: 20px;" />`;
                }
            });
        }
    };
    front._actions["removeSearchAlias"] = (message: any) => {
        delete self.aliases[message.alias];
    };
    front._actions["getSearchAliases"] = (message: any) => {
        front.postMessage({
            aliases: self.aliases,
            toContent: true,
            id: message.id,
        });
    };

    return self;
}

function Commands(omnibar: any, front: any): any {
    const self: any = {
        focusFirstCandidate: false,
        prompt: ":",
    };
    const items: Record<string, any> = {};

    self.onOpen = () => {
        omnibar.resultsDiv.className = "commands";

        if (omnibar.input.value.length) {
            omnibar.triggerInput();
            return;
        }

        RUNTIME("getSettings", { key: "cmdHistory" }, (response: any) => {
            const candidates = response.settings.cmdHistory;
            if (candidates.length) {
                omnibar.listResults(candidates, (c: any) => {
                    const li: any = createElementWithContent("li", c);
                    li.cmd = c;
                    return li;
                });
            }
        });
    };

    self.onReset = self.onOpen;

    self.onInput = () => {
        const cmd = omnibar.input.value;
        const candidates = Object.keys(items).filter((c) => {
            return cmd === "" || c.indexOf(cmd) !== -1;
        });
        if (candidates.length) {
            omnibar.listResults(candidates, (c: any) => {
                const li: any = createElementWithContent(
                    "li",
                    `${c}<span class=annotation>${htmlEncode(items[c].annotation)}</span>`,
                );
                li.cmd = c;
                return li;
            });
        }
    };

    self.onTabKey = () => {
        const fi = omnibar.focusedResult();
        if (fi) {
            omnibar.input.value = fi.data.cmd;
        }
    };

    self.onEnter = () => {
        const ret = false;
        const cmdline = omnibar.input.value;
        if (cmdline.length) {
            RUNTIME("updateInputHistory", { cmd: cmdline });
            execute(cmdline);
            omnibar.input.value = "";
        }
        return ret;
    };

    function parseCommand(cmdline: string) {
        cmdline = cmdline.trim();
        const tokens: string[] = [];
        let pendingToken = false;
        let part = "";
        for (let i = 0; i < cmdline.length; i++) {
            if (cmdline.charAt(i) === " " && !pendingToken) {
                tokens.push(part);
                part = "";
            } else {
                if (cmdline.charAt(i) === '"') {
                    pendingToken = !pendingToken;
                } else {
                    part += cmdline.charAt(i);
                }
            }
        }
        tokens.push(part);
        return tokens;
    }

    function execute(cmdline: string) {
        const args = parseCommand(cmdline);
        const cmd = args.shift()!;
        if (Object.prototype.hasOwnProperty.call(items, cmd)) {
            const meta = items[cmd];
            meta.code.call(meta.code, args);
        } else {
            showBanner(`Unsupported command: ${cmdline}.`, 3000);
        }
    }

    front._actions["executeCommand"] = (message: any) => {
        execute(message.cmdline);
    };

    omnibar.command = (cmd: string, annotation: string, jscode: any) => {
        const cmd_code: any = {
            code: jscode,
        };
        const ag = parseAnnotation({ annotation: annotation, feature_group: 14 });
        cmd_code.feature_group = ag.feature_group;
        cmd_code.annotation = ag.annotation;
        items[cmd] = cmd_code;
    };

    return self;
}

function OmniQuery(omnibar: any, front: any): any {
    const self: any = {
        prompt: "ǭ",
    };

    function onlyUnique(value: any, index: number, arr: any[]) {
        return arr.indexOf(value) === index;
    }
    let _words: string[];
    self.onOpen = (arg: any) => {
        if (arg && (document as any).dictEnabled === undefined) {
            omnibar.input.value = arg;
            front.contentCommand({
                action: "omnibar_query_entered",
                query: arg,
            });
        }
        front.contentCommand(
            {
                action: "getPageText",
            },
            (message: any) => {
                const splitRegex = /[^a-zA-Z]+/;
                _words = message.data.toLowerCase().split(splitRegex).filter(onlyUnique);
            },
        );
    };

    self.onInput = () => {
        const iw = omnibar.input.value;
        const candidates = _words.filter((w) => {
            return w.indexOf(iw) !== -1;
        });
        if (candidates.length) {
            omnibar.listResults(candidates, (w: any) => {
                return createElementWithContent("li", w);
            });
        }
    };

    self.onTabKey = () => {
        const fi = omnibar.focusedResult();
        if (fi) {
            omnibar.input.value = fi.data.text;
        }
    };

    self.onEnter = () => {
        front.contentCommand({
            action: "omnibar_query_entered",
            query: omnibar.input.value,
        });
    };

    return self;
}

function OpenUserURLs(omnibar: any): any {
    const self: any = {
        focusFirstCandidate: true,
        prompt: `UserURLs${separatorHtml}`,
    };

    let _items: any[];
    self.onOpen = (args: any) => {
        _items = args;
        self.onInput();
    };

    self.onInput = () => {
        const query = omnibar.input.value;
        const urls = filterByTitleOrUrl(_items, query, runtime.getCaseSensitive(query));
        omnibar.listURLs(urls, false);
    };
    return self;
}

export default createOmnibar;
