import {
    attachFaviconToImgSrc,
    createElementWithContent,
    generateQuickGuid,
    getAnnotations,
    getWordUnderCursor,
    htmlEncode,
    initL10n,
    initSKFunctionListener,
    refreshHints,
    rotateInput,
    setSanitizedContent,
    mapInMode,
} from "../common/utils.js";
import { RUNTIME, runtime } from "../common/runtime.js";
import KeyboardUtils from "../common/keyboardUtils";
import Mode from "../common/mode";
import createClipboard from "../common/clipboard";
import createInsert from "../common/insert";
import createNormal from "../common/normal.js";
import createVisual from "../common/visual.js";
import createHints from "../common/hints.js";
import createAPI from "../common/api.js";
import createDefaultMappings from "../common/default.js";
import createOmnibar from "./omnibar.js";
import createCommands from "./command.js";

const Front = (() => {
    const clipboard = createClipboard();
    Mode.init();
    // The god object is not dissolved yet (#13); insert's overridden enter clashes
    // with the structural InsertLike each factory expects, so it is wired untyped.
    const insert: any = createInsert();
    const normal = createNormal(insert);
    normal.enter();
    const hints = createHints(insert, normal, clipboard);
    const visual = createVisual(clipboard, hints);

    const self: any = new Mode("Front");
    self._actions = {};
    self.topSize = [0, 0];
    const destroyListeners: (() => void)[] = [];
    self.addDestroyListener = (task: () => void) => {
        destroyListeners.push(task);
    };
    const omnibar: any = createOmnibar(self, clipboard);

    createCommands(normal, omnibar.command, omnibar);

    const modes: Record<string, any> = {
        Insert: insert,
        Normal: normal,
        Visual: visual,
        Omnibar: omnibar,
    };

    const api = createAPI(clipboard, insert, normal, hints, visual, self, {});
    createDefaultMappings(api, clipboard, insert, normal, hints, visual, self);

    const _actions: Record<string, (message?: any) => any> = self._actions;
    const _callbacks: Record<string, (msg: any) => any> = {};
    self.contentCommand = (args: any, successById?: (msg: any) => any) => {
        args.toContent = true;
        args.id = generateQuickGuid();
        if (successById) {
            args.ack = true;
            _callbacks[args.id] = successById;
        }
        top!.postMessage({ surfingkeys_uihost_data: args }, self.topOrigin);
    };

    self.postMessage = (args: any) => {
        top!.postMessage({ surfingkeys_uihost_data: args }, self.topOrigin);
    };

    let pressedHintKeys = "";
    let _display: any;
    self.addEventListener("keydown", (event: any) => {
        if (Mode.isSpecialKeyOf("<Esc>", event.sk_keyName ?? "")) {
            self.hidePopup();
            event.sk_stopPropagation = true;
        } else if (_display && _display.style.display !== "none") {
            const tabHints = _display.querySelectorAll("div>div.sk_tab_hint");
            if (tabHints.length > 0) {
                const key = event.sk_keyName ?? "";
                const characters = hints.getCharacters().toLowerCase();
                if (event.keyCode === KeyboardUtils.keyCodes.backspace) {
                    if (pressedHintKeys.length > 0) {
                        pressedHintKeys = pressedHintKeys.substr(0, pressedHintKeys.length - 1);
                        refreshHints(tabHints, pressedHintKeys);
                    }
                } else if (characters.indexOf(key.toLowerCase()) !== -1) {
                    pressedHintKeys = pressedHintKeys + key.toUpperCase();
                    const hintState = refreshHints(tabHints, pressedHintKeys);
                    if (hintState.matched) {
                        _display.onHit(hintState.matched);
                        pressedHintKeys = "";
                        self.hidePopup();
                    } else if (hintState.candidates === 0) {
                        pressedHintKeys = "";
                        self.hidePopup();
                    }
                } else {
                    showElement(_omnibar, () => {
                        _omnibar.onShow({ type: "Tabs" });
                    });
                }

                event.sk_stopPropagation = true;
            }
        }
    });

    let _state: State;
    class State {
        enter: () => void;
        nextState: () => void;
        constructor(pointerEvents: string, frameHeight: string, onEnter?: () => void) {
            this.enter = () => {
                onEnter && onEnter();
                _state = this;
                top!.postMessage(
                    {
                        surfingkeys_uihost_data: {
                            action: "setFrontFrame",
                            pointerEvents: pointerEvents,
                            frameHeight: frameHeight,
                        },
                    },
                    self.topOrigin,
                );
            };
            this.nextState = () => {
                const visibleDivs = Array.from(
                    document.body.querySelectorAll<HTMLElement>("body>div"),
                ).filter((n) => {
                    return n.style.display !== "none";
                });
                const pe = visibleDivs.map((d: any) => {
                    const id = d.id;
                    const divNoPointerEvents = ["sk_keystroke", "sk_banner"];
                    if (divNoPointerEvents.indexOf(id) !== -1) {
                        // no pointerEvents for bubble
                        return false;
                    } else if (id === "sk_status") {
                        // only pointerEvents when input in statusBar
                        return self.statusBar.querySelector("input") !== null;
                    } else {
                        // with pointerEvents for all other DIVs except that noPointerEvents is set.
                        return !d.noPointerEvents;
                    }
                });
                // to make pointerEvents not empty
                pe.push(false);
                const pointerEvents2 = pe.reduce((a, b) => {
                    return a || b;
                });

                let ns;
                if (pointerEvents2) {
                    ns = stateInteractive;
                } else if (visibleDivs.length > 0) {
                    ns = stateVisible;
                } else {
                    ns = stateInvisible;
                }
                if (this !== ns) {
                    ns.enter();
                }
            };
        }
    }
    const stateInvisible = new State("none", "0px");
    const stateVisible = new State("none", "100%");
    const stateInteractive = new State("all", "100%", () => {
        window.focus();
    });
    _state = stateInvisible;

    self.flush = () => {
        _state.nextState();
    };
    self.visualCommand = (args: any) => {
        if (_usage.style.display !== "none") {
            // visual mode in frontend.html, such as help
            (visual as any)[args.action](args.query);
        } else {
            // visual mode for all content windows
            self.contentCommand(args);
        }
    };

    const _omnibar: any = document.getElementById("sk_omnibar");
    self.statusBar = document.getElementById("sk_status");
    const _usage = document.getElementById("sk_usage") as HTMLElement;
    const _popup = document.getElementById("sk_popup") as HTMLElement;
    const _tabs = document.getElementById("sk_tabs") as HTMLElement;
    const _banner = document.getElementById("sk_banner") as HTMLElement;
    const _bubble: any = document.getElementById("sk_bubble");
    const sk_bubble_content: any = _bubble.querySelector("div.sk_bubble_content");
    const sk_bubble_arrow = _bubble.querySelector("div.sk_arrow") as HTMLElement;
    const sk_bubbleClassList = sk_bubble_content.classList;
    function clearScrollerIndicator() {
        sk_bubbleClassList.remove("sk_scroller_indicator_top");
        sk_bubbleClassList.remove("sk_scroller_indicator_middle");
        sk_bubbleClassList.remove("sk_scroller_indicator_bottom");
    }
    sk_bubble_content.onscroll = () => {
        clearScrollerIndicator();
        if (sk_bubble_content.scrollTop === 0) {
            sk_bubbleClassList.add("sk_scroller_indicator_top");
        } else if (
            sk_bubble_content.scrollTop + sk_bubble_content.offsetHeight >=
            sk_bubble_content.scrollHeight
        ) {
            sk_bubbleClassList.add("sk_scroller_indicator_bottom");
        } else {
            sk_bubbleClassList.add("sk_scroller_indicator_middle");
        }
    };
    const keystroke: any = document.getElementById("sk_keystroke");

    self.startInputGuard = () => {};
    _actions["hidePopup"] = () => {
        if (_display && _display.style.display !== "none") {
            _display.style.display = "none";
            self.flush();
            _display.onHide && _display.onHide();
            self.exit();
        }
    };
    self.hidePopup = _actions["hidePopup"];

    function setDisplay(td: any, render?: () => void) {
        if (_display && _display.style.display !== "none") {
            _display.style.display = "none";
            _display.onHide && _display.onHide();
        }
        _display = td;
        _display.style.display = "";
        render && render();
        self.startInputGuard();
    }

    function showElement(td: any, render?: () => void, onHit?: (matched: any) => void) {
        self.enter(0, true);
        td.onHit = onHit;
        setDisplay(td, render);
        self.flush();
    }

    function renderTabTitles(container: HTMLElement, tabs: any[]) {
        tabs.forEach((t) => {
            const tab = createElementWithContent(
                "div",
                `<div class=sk_tab_wrap><div class=sk_tab_icon><img/></div><div class=sk_tab_title>${htmlEncode(t.title)}</div></div>`,
                { class: "sk_tab" },
            );
            if (t.active) {
                tab.classList.add("active");
            }
            attachFaviconToImgSrc(t, tab.querySelector("img")!);
            container.append(tab);
        });
    }
    function renderTabs(container: any, tabs: any[]) {
        setSanitizedContent(container, "");
        const hintLabels = hints.genLabels(tabs.length - 1);
        const unitWidth = window.innerWidth / tabs.length - 2;
        const verticalTabs = runtime.conf.verticalTabs;
        container.className = verticalTabs ? "vertical" : "horizontal";
        renderTabTitles(container, tabs);
        if (verticalTabs) {
            container.querySelectorAll("div.sk_tab").forEach((tab: HTMLElement) => {
                tab.append(createElementWithContent("div", "🚀", { class: "tab_rocket" }));
            });
        } else {
            container.querySelectorAll("div.sk_tab").forEach((tab: any) => {
                tab.querySelector("div.sk_tab_title").style.width = unitWidth - 24 + "px";
                tab.style.width = unitWidth + "px";
            });
        }
        const tabsNeedHint = tabs.filter((t) => !t.active);
        container.querySelectorAll("div.sk_tab:not(.active)").forEach((tab: any, i: number) => {
            const tabHint: any = createElementWithContent("div", hintLabels[i], {
                class: "sk_tab_hint",
            });
            const tabData = tabsNeedHint[i];
            tabHint.label = hintLabels[i];
            tabHint.link = { id: tabData.id, windowId: tabData.windowId };
            tab.prepend(tabHint);
        });
        if (container.getBoundingClientRect().height > self.topSize[1]) {
            container.className = "inline";
        }
    }
    _actions["chooseTab"] = () => {
        const tabsThreshold = Math.min(
            runtime.conf.tabsThreshold,
            Math.ceil(window.innerWidth / 26),
        );
        RUNTIME(
            "getTabs",
            { queryInfo: { currentWindow: true }, tabsThreshold },
            (response: any) => {
                if (response.tabs.length > tabsThreshold) {
                    showElement(_omnibar, () => {
                        _omnibar.onShow({ type: "Tabs" });
                    });
                } else if (response.tabs.length > 0) {
                    showElement(
                        _tabs,
                        () => {
                            renderTabs(_tabs, response.tabs);
                        },
                        (matched) => {
                            RUNTIME("focusTab", {
                                windowId: matched.windowId,
                                tabId: matched.id,
                            });
                        },
                    );
                }
            },
        );
    };
    self.chooseTab = _actions["chooseTab"];

    function localizeAnnotation(locale: (s: string) => string, annotation: any) {
        if (annotation.constructor.name === "Array") {
            const fmt = annotation[0];
            return locale(fmt).format(...annotation.slice(1));
        } else {
            return locale(annotation);
        }
    }

    function buildUsage(metas: any[], cb: (usage: string) => void) {
        const feature_groups = [
            "Help", // 0
            "Mouse Click", // 1
            "Scroll Page / Element", // 2
            "Tabs", // 3
            "Page Navigation", // 4
            "Sessions", // 5
            "Search selected with", // 6
            "Clipboard", // 7
            "Omnibar", // 8
            "Visual Mode", // 9
            "vim-like marks", // 10
            "Settings", // 11
            "Chrome URLs", // 12
            "Proxy", // 13
            "Misc", // 14
            "Insert Mode", // 15
            "Lurk Mode", // 16
            "Regional Hints Mode", // 17
        ];

        initL10n((locale) => {
            let help_groups: string[][] | string = feature_groups.map(() => {
                return [] as string[];
            });
            const lh = Mode.specialKeys["<Alt-s>"].length;
            if (lh > 0) {
                (help_groups as string[][])[0].push(
                    "<div><span class=kbd-span><kbd>{0}</kbd></span><span class=annotation>{1}</span></div>".format(
                        htmlEncode(Mode.specialKeys["<Alt-s>"][lh - 1]),
                        locale("Toggle SurfingKeys on current site"),
                    ),
                );
            }

            metas = metas.concat(getAnnotations(omnibar.mappings));
            metas.forEach((meta) => {
                const w = KeyboardUtils.decodeKeystroke(meta.word);
                const annotation = localizeAnnotation(locale, meta.annotation);
                const item = `<div><span class=kbd-span><kbd>${htmlEncode(w)}</kbd></span><span class=annotation>${annotation}</span></div>`;
                (help_groups as string[][])[meta.feature_group].push(item);
            });
            help_groups = (help_groups as string[][])
                .map((g, i) => {
                    if (g.length) {
                        return "<div><div class=feature_name><span>{0}</span></div>{1}</div>".format(
                            locale(feature_groups[i]),
                            g.join(""),
                        );
                    } else {
                        return "";
                    }
                })
                .join("");

            help_groups += `<p style='float:right; width:100%; text-align:right'><a href='https://github.com/brookhong/surfingkeys' target='_blank' style='color:#0095dd'>${locale("More help")}</a></p>`;
            cb(help_groups);
        });
    }

    _actions["showUsage"] = (message: any) => {
        showElement(_usage, () => {
            buildUsage(message.metas, (usage) => {
                setSanitizedContent(_usage, usage);
            });
        });
    };
    _actions["applyUserSettings"] = (message: any) => {
        const conf = runtime.conf as Record<string, any>;
        for (const k in message.userSettings) {
            if (Object.prototype.hasOwnProperty.call(runtime.conf, k)) {
                conf[k] = message.userSettings[k];
            }
        }
        if ("theme" in message.userSettings) {
            setSanitizedContent(
                document.getElementById("sk_theme") as HTMLElement,
                message.userSettings.theme,
            );
        }
    };
    _actions["setHintsCharacters"] = (message: any) => {
        hints.setCharacters(message.characters);
    };
    _actions["addMapkey"] = (message: any) => {
        if (message.old_keystroke in Mode.specialKeys) {
            Mode.specialKeys[message.old_keystroke].push(message.new_keystroke);
        } else if (Object.prototype.hasOwnProperty.call(modes, message.mode)) {
            mapInMode(modes[message.mode], message.new_keystroke, message.old_keystroke);
        }
    };
    _actions["addCommand"] = (message: any) => {
        const proxyAction = (...args: any[]) => {
            self.contentCommand({
                action: "executeUserCommand",
                name: message.name,
                args: args,
            });
        };
        omnibar.command(message.name, message.description, proxyAction);
    };
    _actions["getUsage"] = (message: any) => {
        // send response in callback from buildUsage
        delete message.ack;
        buildUsage(message.metas, (usage) => {
            top!.postMessage(
                {
                    surfingkeys_uihost_data: {
                        data: usage,
                        toContent: true,
                        id: message.id,
                    },
                },
                self.topOrigin,
            );
        });
    };

    self.showUsage = self.hidePopup;

    function showPopup(content: string) {
        setSanitizedContent(_popup, content);
        showElement(_popup);
    }

    _actions["showPopup"] = (message: any) => {
        showPopup(message.content);
    };

    _actions["showDialog"] = (message: any) => {
        showElement(
            _popup,
            () => {
                const hintLabels = hints.genLabels(2);
                setSanitizedContent(
                    _popup,
                    `<div>${message.question}</div><div><div class=sk_tab_hint>${hintLabels[0]}</div><span class=sk_tab_group_title>Ok</span><div class=sk_tab_hint>${hintLabels[1]}</div><span class=sk_tab_group_title>Cancel</span></div>`,
                );
                const tabHints: any = _popup.querySelectorAll("div.sk_tab_hint");
                _popup.style.textAlign = "center";
                tabHints[0].link = "Ok";
                tabHints[0].label = hintLabels[0];
                tabHints[1].link = "Cancel";
                tabHints[1].label = hintLabels[1];
            },
            (matched) => {
                self.contentCommand({
                    action: "dialogResponse",
                    result: matched,
                });
            },
        );
    };

    _actions["openOmnibar"] = (message: any) => {
        showElement(_omnibar, () => {
            _omnibar.onShow(message);
            const style = message.style || "";
            setSanitizedContent(_omnibar.querySelector("style"), `#sk_omnibar {${style}}`);
        });
    };
    self.openOmnibar = _actions["openOmnibar"];
    _actions["openFinder"] = () => {
        Find.open();
    };

    function showBanner(content: string, linger_time?: number) {
        _banner.style.cssText = "";
        _banner.style.display = "";
        _banner.style.top = "0px";
        setSanitizedContent(_banner, htmlEncode(content));
        self.flush();

        const timems = linger_time || 1600;
        setTimeout(() => {
            _banner.style.cssText = "";
            _banner.style.display = "none";
            self.flush();
        }, timems);
    }
    _actions["showBanner"] = (message: any) => {
        showBanner(message.content, message.linger_time);
    };
    _actions["showBubble"] = (message: any) => {
        const pos = message.position;
        pos.left += pos.winX;
        pos.top += pos.winY;
        // set position to (0, 0) to leave enough space for content.
        _bubble.style.top = "0px";
        _bubble.style.left = "0px";
        setSanitizedContent(sk_bubble_content, message.content);
        sk_bubble_content.style.maxWidth = pos.winWidth - 32 + "px";
        sk_bubble_content.scrollTop = 0;
        clearScrollerIndicator();
        _bubble.style.display = "";
        const w = _bubble.offsetWidth;
        let h = _bubble.offsetHeight;
        const left = [pos.left - 11 - w / 2, w / 2];
        if (left[0] < pos.winX) {
            left[1] += left[0] - pos.winX;
            left[0] = pos.winX;
        } else if (left[0] + w > pos.winWidth) {
            left[1] += left[0] - pos.winX - pos.winWidth + w;
            left[0] = pos.winX + pos.winWidth - w;
        }
        sk_bubble_arrow.style.left = left[1] + pos.width / 2 - 2 + "px";
        _bubble.style.left = left[0] + "px";
        _bubble.noPointerEvents = message.noPointerEvents;

        if (pos.top + pos.height / 2 > pos.winHeight / 2) {
            sk_bubble_arrow.setAttribute("dir", "down");
            sk_bubble_arrow.style.top = "100%";
            sk_bubble_content.style.maxHeight = pos.top - 12 - 32 + "px";
            h = _bubble.offsetHeight;
            _bubble.style.top = pos.top - h - 12 + "px";
        } else {
            sk_bubble_arrow.setAttribute("dir", "up");
            sk_bubble_arrow.style.top = "-12px";
            sk_bubble_content.style.maxHeight =
                pos.winHeight - (pos.top + pos.height + 12) - 32 + "px";
            h = _bubble.offsetHeight;
            _bubble.style.top = pos.top + pos.height + 12 + "px";
        }
        if (sk_bubble_content.scrollHeight > sk_bubble_content.offsetHeight) {
            _bubble.noPointerEvents = false;
            sk_bubbleClassList.add("sk_scroller_indicator_top");
        }
        self.flush();
        if (!_bubble.noPointerEvents) {
            setDisplay(_bubble);
            self.enter(0, true);
        }
    };

    _actions["hideBubble"] = () => {
        _bubble.style.display = "none";
        self.flush();
    };

    _actions["visualUpdated"] = () => {
        self.statusBar.querySelector("input").focus();
    };

    _actions["showStatus"] = (message: any) => {
        StatusBar.show(message.contents, message.duration);
    };

    initSKFunctionListener("front", {
        showPopup,
        showBanner,
        openFinder: () => {
            Find.open();
        },
        showStatus: (contents: any, duration?: number) => {
            StatusBar.show(contents, duration);
        },
    });

    self.toggleStatus = (visible: boolean) => {
        if (visible) {
            self.statusBar.style.display = "";
        } else {
            self.statusBar.style.display = "none";
        }
    };
    _actions["toggleStatus"] = (message: any) => {
        self.toggleStatus(message.visible);
    };

    let _pendingHint: ReturnType<typeof setTimeout> | undefined;
    function clearPendingHint() {
        if (_pendingHint) {
            clearTimeout(_pendingHint);
            _pendingHint = undefined;
        }
    }

    _actions["hideKeystroke"] = () => {
        if (keystroke.style.display !== "none") {
            keystroke.classList.remove("expandRichHints");
            setSanitizedContent(keystroke, "");
            keystroke.style.display = "none";
            self.flush();
        }
        if (runtime.conf.richHintsForKeystroke > 0 && runtime.conf.richHintsForKeystroke < 10000) {
            clearPendingHint();
        }
    };

    function showRichHints(keyHints: any) {
        initL10n((locale) => {
            const cc = keyHints.candidates;
            const words = Object.keys(cc)
                .sort()
                .map((w) => {
                    const annotation = localizeAnnotation(locale, cc[w].annotation);
                    if (annotation) {
                        const nextKey = w.substr(keyHints.accumulated.length);
                        return `<div><span class=kbd-span><kbd>${htmlEncode(KeyboardUtils.decodeKeystroke(keyHints.accumulated))}<span class=candidates>${htmlEncode(KeyboardUtils.decodeKeystroke(nextKey))}</span></kbd></span><span class=annotation>${annotation}</span></div>`;
                    } else {
                        return "";
                    }
                })
                .join("");
            if (words.length > 0 && _pendingHint) {
                setSanitizedContent(keystroke, words);
                keystroke.classList.add("expandRichHints");
                self.flush();
            }
        });
    }
    _actions["showKeystroke"] = (message: any) => {
        if (keystroke.style.display !== "none" && keystroke.classList.contains("expandRichHints")) {
            showRichHints(message.keyHints);
        } else {
            clearPendingHint();
            keystroke.style.display = "";
            self.flush();
            const keys =
                keystroke.innerHTML +
                htmlEncode(KeyboardUtils.decodeKeystroke(message.keyHints.key));
            setSanitizedContent(keystroke, keys);

            if (
                runtime.conf.richHintsForKeystroke > 0 &&
                runtime.conf.richHintsForKeystroke < 10000
            ) {
                _pendingHint = setTimeout(() => {
                    showRichHints(message.keyHints);
                }, runtime.conf.richHintsForKeystroke);
            }
        }
    };

    _actions["initFrontend"] = (message: any) => {
        self.topOrigin = message.origin;
        self.topSize = message.winSize;
        return new Date().getTime();
    };
    _actions["destroyFrontend"] = () => {
        if (_display && _display.style.display !== "none") {
            return false;
        }
        for (const task of destroyListeners) {
            task();
        }
        return true;
    };

    window.addEventListener(
        "message",
        (event) => {
            const _message = event.data && event.data.surfingkeys_frontend_data;
            if (_message === undefined) {
                return;
            }
            if (_callbacks[_message.id]) {
                const f = _callbacks[_message.id];
                // returns true to make callback stay for coming response.
                if (!f(_message)) {
                    delete _callbacks[_message.id];
                }
            } else if (
                _message.action &&
                Object.prototype.hasOwnProperty.call(_actions, _message.action)
            ) {
                const ret = _actions[_message.action](_message);
                if (_message.ack) {
                    top!.postMessage(
                        {
                            surfingkeys_uihost_data: {
                                data: ret,
                                action: _message.action + "Ack",
                                toContent: true,
                            },
                        },
                        self.topOrigin,
                    );
                }
            }
        },
        true,
    );

    function onResize() {
        if (_bubble.style.display !== "none") {
            self.contentCommand({
                action: "updateInlineQuery",
            });
        }
    }

    // for mouseSelectToQuery
    document.onmouseup = (e) => {
        if (!_bubble.contains(e.target as Node)) {
            _bubble.style.display = "none";
            self.flush();
            self.contentCommand({
                action: "emptySelection",
            });
            window.removeEventListener("resize", onResize);
        } else {
            const sel = window.getSelection()!.toString().trim() || getWordUnderCursor(true);
            if (sel && sel.length > 0) {
                self.contentCommand(
                    {
                        action: "updateInlineQuery",
                        word: sel,
                    },
                    () => {
                        window.addEventListener("resize", onResize);
                    },
                );
            }
        }
    };

    sk_bubble_content.addEventListener(
        "mousewheel",
        (evt: any) => {
            if (
                (evt.deltaY > 0 &&
                    sk_bubble_content.scrollTop + sk_bubble_content.offsetHeight >=
                        sk_bubble_content.scrollHeight) ||
                (evt.deltaY < 0 && sk_bubble_content.scrollTop <= 0)
            ) {
                evt.preventDefault();
            }
        },
        { passive: false },
    );

    return self;
})();

/**
 * The status bar displays the status of Surfingkeys current mode: Normal, visual, etc.
 *
 * @kind function
 *
 * @param {Object} ui
 * @return {StatusBar} StatusBar instance
 */
const StatusBar = (() => {
    const self: any = {};
    let timerHide: ReturnType<typeof setTimeout> | null = null;
    const ui = Front.statusBar;

    // 4 spans
    // mode: 0
    // search: 1
    // searchResult: 2
    // proxy: 3
    self.show = (contents: any[], duration?: number) => {
        if (timerHide) {
            clearTimeout(timerHide);
            timerHide = null;
        }
        const span = ui.querySelectorAll("span");
        for (let i = 0; i < contents.length; i++) {
            if (contents[i] !== undefined) {
                setSanitizedContent(span[i], contents[i]);
            }
        }
        let lastSpan = -1;
        for (let i = 0; i < span.length; i++) {
            if (span[i].innerHTML.length) {
                lastSpan = i;
                span[i].style.padding = "0px 8px";
                span[i].style.borderRight = "1px solid #999";
            } else {
                span[i].style.padding = "";
                span[i].style.borderRight = "";
            }
        }
        if (lastSpan === -1) {
            ui.style.display = "none";
        } else {
            span[lastSpan].style.borderRight = "";
            ui.style.display = "block";
        }
        Front.flush();
        if (duration) {
            timerHide = setTimeout(() => {
                self.show(["", "", "", ""]);
            }, duration);
        }
    };
    return self;
})();

const Find = (() => {
    const self: any = new Mode("Find", "/");

    self.addEventListener("keydown", (event: any) => {
        // prevent this event to be handled by Surfingkeys' other listeners
        event.sk_suppressed = true;
    }).addEventListener("mousedown", (event: any) => {
        if (event.target !== input) {
            // user clicks on somewhere else
            reset();
        }
        event.sk_suppressed = true;
    });

    let input: any;
    let historyInc = 0;
    let userInput = "";
    function reset() {
        input = null;
        StatusBar.show(["", ""]);
        self.exit();
    }

    /**
     * Opens the status bar
     *
     * @memberof StatusBar
     * @instance
     *
     * @return {undefined}
     */
    self.open = () => {
        StatusBar.show(["/", '<input id="sk_find" class="sk_theme"/>']);
        input = Front.statusBar.querySelector("input");
        input.oninput = () => {
            if (input.value.length && input.value !== ".") {
                Front.visualCommand({
                    action: "visualUpdate",
                    query: input.value,
                });
                // To find in usage popup will set focus and selection elsewhere
                // we need bring it back
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        };
        let findHistory: string[] = [];
        RUNTIME(
            "getSettings",
            {
                key: "findHistory",
            },
            (response: any) => {
                userInput = "";
                findHistory = response.settings.findHistory;
                historyInc = findHistory.length;
            },
        );
        input.onkeydown = (event: any) => {
            let query: string | undefined;
            if (Mode.isSpecialKeyOf("<Esc>", event.sk_keyName ?? "")) {
                reset();
                Front.visualCommand({
                    action: "visualClear",
                });
            } else if (event.keyCode === KeyboardUtils.keyCodes.enter) {
                query = input.value;
                if (query!.length && query !== ".") {
                    if (event.ctrlKey) {
                        query = "\\b" + query + "\\b";
                    }
                    reset();
                    RUNTIME("updateInputHistory", { find: query });
                    Front.visualCommand({
                        action: "visualEnter",
                        query: query,
                    });
                }
            } else if (
                event.keyCode === KeyboardUtils.keyCodes.upArrow ||
                event.keyCode === KeyboardUtils.keyCodes.downArrow
            ) {
                if (findHistory.length) {
                    [input.value, historyInc] = rotateInput(
                        findHistory,
                        event.keyCode === KeyboardUtils.keyCodes.downArrow,
                        historyInc,
                        userInput,
                    );
                    Front.visualCommand({
                        action: "visualUpdate",
                        query: query,
                    });
                    event.preventDefault();
                }
            } else {
                userInput = input.value;
                historyInc = findHistory.length;
            }
        };
        input.focus();
        Front.startInputGuard();
        self.enter();
    };
    return self;
})();

export default Front;
