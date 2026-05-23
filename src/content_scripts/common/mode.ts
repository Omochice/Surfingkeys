import { listElements, isInUIFrame, reportIssue } from "./utils.js";
import { RUNTIME, dispatchSKEvent, runtime } from "./runtime.js";
import KeyboardUtils from "./keyboardUtils";
import type Trie from "./trie";
import type { TrieMeta } from "./trie";

declare global {
    interface Event {
        sk_keyName?: string;
        sk_stopPropagation?: boolean;
        sk_suppressed?: boolean;
    }
}

type StackEvent = Event & { keyCode?: number };

let mode_stack: Mode[] = [];

let eventListenerBeats = 0;
let suppressScrollEvent = 0;
const keysNeedKeyupSuppressed: number[] = [];

const _listenedEvents: Record<string, (event: StackEvent) => void> = {
    sentinel: () => {
        eventListenerBeats++;
    },
    keydown: (event) => {
        event.sk_keyName = KeyboardUtils.getKeyChar(event as unknown as { keyCode: number });
        if (mode_stack.length === 0 && window !== top) {
            // automatically boots iframe on demand
            dispatchSKEvent("iframeBoot");
            document.addEventListener(
                "surfingkeys:userSettingsLoaded",
                () => {
                    // proceed to handle the key event after userSettingsLoaded.
                    handleStack("keydown", event);
                },
                { once: true },
            );
            return;
        }
        handleStack("keydown", event);
    },
    keyup: (event) => {
        handleStack("keyup", event, () => {
            const i = keysNeedKeyupSuppressed.indexOf(event.keyCode ?? -1);
            if (i !== -1) {
                event.stopImmediatePropagation();
                keysNeedKeyupSuppressed.splice(i, 1);
            }
        });
    },
    scroll: (event) => {
        handleStack("scroll", event);
        if (suppressScrollEvent > 0) {
            event.stopImmediatePropagation();
            event.preventDefault();
            suppressScrollEvent--;
        }
    },
};

function onAfterHandler(_mode: Mode, event: StackEvent): void {
    if (event.sk_stopPropagation) {
        event.stopImmediatePropagation();
        event.preventDefault();
    }
}

function handleStack(eventName: string, event: StackEvent, cb?: (mode: Mode) => void): void {
    for (let i = 0; i < mode_stack.length && !event.sk_stopPropagation; i++) {
        const m = mode_stack[i];
        if (
            !event.sk_suppressed &&
            Object.prototype.hasOwnProperty.call(m.eventListeners, eventName)
        ) {
            const handler = m.eventListeners[eventName];
            handler(event);
            onAfterHandler(m, event);
        }
        if (m.name === "Disabled") {
            break;
        }
        cb?.(m);
    }
}

function init(cb?: () => void): void {
    mode_stack = [];
    for (const evtName in _listenedEvents) {
        window.addEventListener(evtName, _listenedEvents[evtName] as EventListener, true);
    }
    cb?.();
}

export default class Mode {
    name: string;
    statusLine: string | undefined;
    eventListeners: Record<string, (event: StackEvent) => void> = {};
    priority: number | undefined;

    // Assigned by concrete modes (Normal/Insert/Visual/Hints) after construction.
    mappings?: Trie;
    map_node?: Trie;
    repeats?: string;
    pendingMap?: ((key: string) => void) | null;
    isTrustedEvent?: boolean;
    __trust_all_events__?: boolean;
    onEnter?: () => void;
    onExit?: (pos?: number) => void;
    setLastKeys?: (keys: string) => void;

    constructor(name: string, statusLine?: string) {
        this.name = name;
        this.statusLine = statusLine;
    }

    addEventListener(evtName: string, handler: (event: StackEvent) => void): this {
        this.eventListeners[evtName] = handler;

        if (!Object.prototype.hasOwnProperty.call(_listenedEvents, evtName)) {
            _listenedEvents[evtName] = (event) => {
                handleStack(evtName, event);
            };
            window.addEventListener(evtName, _listenedEvents[evtName] as EventListener, true);
        }

        return this;
    }

    enter(priority?: number, reentrant?: boolean): number {
        const pos = mode_stack.indexOf(this);
        if (!this.priority) {
            this.priority = priority || mode_stack.length;
        }

        if (pos === -1) {
            // push this mode into stack
            mode_stack.unshift(this);
        } else if (pos > 0) {
            if (reentrant) {
                // pop up all the modes over this
                mode_stack = mode_stack.slice(pos);
            } else {
                const modeList = mode_stack.map((u) => u.name).join(",");
                reportIssue(
                    `Mode ${this.name} pushed into mode stack again.`,
                    `Modes in stack: ${modeList}`,
                );
            }
        }

        mode_stack.sort((a, b) =>
            (a.priority ?? 0) < (b.priority ?? 0)
                ? 1
                : (b.priority ?? 0) < (a.priority ?? 0)
                  ? -1
                  : 0,
        );

        this.onEnter?.();

        Mode.showStatus();
        return pos;
    }

    exit(peek?: boolean): void {
        const pos = mode_stack.indexOf(this);
        if (pos !== -1) {
            this.priority = 0;
            if (peek) {
                // for peek exit, we need push modes above this back to the stack.
                mode_stack.splice(pos, 1);
            } else {
                // otherwise, we just pop all modes above this inclusively.
                mode_stack = mode_stack.slice(pos + 1);
            }
        }
        Mode.showStatus();
        this.onExit?.(pos);
    }

    static getCurrent(): Mode | undefined {
        return mode_stack[0];
    }

    static specialKeys: Record<string, string[]> = {
        "<Alt-s>": ["<Alt-s>"], // hotkey to toggleBlocklist
        "<Esc>": ["<Esc>"],
    };

    static isSpecialKeyOf(specialKey: string, keyToCheck: string): boolean {
        return (
            -1 !== Mode.specialKeys[specialKey].indexOf(KeyboardUtils.decodeKeystroke(keyToCheck))
        );
    }

    static suppressKeyUp(keyCode: number): void {
        if (keysNeedKeyupSuppressed.indexOf(keyCode) === -1) {
            keysNeedKeyupSuppressed.push(keyCode);
        }
    }

    static hasScroll(el: HTMLElement, direction: "x" | "y", barSize: number): boolean {
        const offset =
            direction === "y"
                ? (["scrollTop", "height"] as const)
                : (["scrollLeft", "width"] as const);
        let result = el[offset[0]];

        if (result < barSize) {
            // set scroll offset to barSize, and verify if we can get scroll offset as barSize
            const originOffset = el[offset[0]];
            el[offset[0]] = el.getBoundingClientRect()[offset[1]];
            result = el[offset[0]];
            if (result !== originOffset) {
                // this is valid for some site such as http://mail.live.com/
                suppressScrollEvent++;
            }
            el[offset[0]] = originOffset;
        }
        return result >= barSize;
    }

    static getScrollableElements(): HTMLElement[] {
        const nodes = listElements(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            (n: HTMLElement) =>
                (Mode.hasScroll(n, "y", 16) && n.scrollHeight > 200) ||
                (Mode.hasScroll(n, "x", 16) && n.scrollWidth > 200),
        );
        nodes.sort((a: HTMLElement, b: HTMLElement) => {
            if (b.contains(a)) return 1;
            else if (a.contains(b)) return -1;
            return b.scrollHeight * b.scrollWidth - a.scrollHeight * a.scrollWidth;
        });
        // document.scrollingElement will be null when document.body.tagName === "FRAMESET"
        if (
            document.scrollingElement &&
            (document.scrollingElement.scrollHeight > window.innerHeight ||
                document.scrollingElement.scrollWidth > window.innerWidth)
        ) {
            nodes.unshift(document.scrollingElement as HTMLElement);
        }
        return nodes;
    }

    static init(cb?: () => void): void {
        // For blank page in frames, we defer init to page loaded
        // as document.write will clear added eventListeners.
        if (
            window.location.href === "about:blank" &&
            window.frameElement &&
            (!document.body || document.body.childElementCount === 0)
        ) {
            window.frameElement.addEventListener("load", () => {
                try {
                    init(cb);
                } catch (e) {
                    console.log("Error on blank iframe loaded: " + e);
                }
            });
        } else {
            init(cb);
        }
    }

    static showStatus(): void {
        if (document.hasFocus() && mode_stack.length) {
            const cm = mode_stack[0];
            let sl = cm.statusLine || (runtime.conf.showModeStatus ? cm.name : "");
            if (sl !== "" && window !== top && !isInUIFrame()) {
                const pathname = window.location.pathname.split("/");
                if (pathname.length) {
                    sl += " - frame: " + pathname[pathname.length - 1];
                }
            }
            dispatchSKEvent("front", ["showStatus", [sl]]);
        }
    }

    static finish(mode: Mode): boolean {
        let ret = false;
        if (mode.map_node !== mode.mappings || mode.pendingMap != null || mode.repeats) {
            mode.map_node = mode.mappings;
            mode.pendingMap = null;
            mode.isTrustedEvent && dispatchSKEvent("front", ["hideKeystroke"]);
            if (mode.repeats) {
                mode.repeats = "";
            }
            ret = true;
        }
        return ret;
    }

    static handleMapKey(
        this: Mode,
        event: StackEvent,
        onNoMatched?: (last: Trie) => void,
    ): boolean {
        const thisMode = this;
        let key = event.sk_keyName ?? "";
        this.isTrustedEvent = this.__trust_all_events__ || event.isTrusted;

        const isEscKey = Mode.isSpecialKeyOf("<Esc>", key);
        if (isEscKey) {
            key = KeyboardUtils.encodeKeystroke("<Esc>");
        }

        let actionDone = false;
        if (isEscKey && Mode.finish(this)) {
            event.sk_stopPropagation = true;
            event.sk_suppressed = true;
            actionDone = true;
        } else if (this.pendingMap) {
            const meta = this.map_node!.meta as TrieMeta;
            this.setLastKeys?.(meta.word + key);
            const pf = this.pendingMap.bind(this);
            event.sk_stopPropagation = !meta.stopPropagation || callStopPropagation(meta, key);
            pf(key);
            actionDone = Mode.finish(thisMode);
        } else if (
            this.repeats !== undefined &&
            this.map_node === this.mappings &&
            runtime.conf.digitForRepeat &&
            (key >= "1" || (this.repeats !== "" && key >= "0")) &&
            key <= "9" &&
            this.map_node!.getWords().length > 0
        ) {
            // reset only after target action executed or cancelled
            this.repeats += key;
            this.isTrustedEvent && dispatchSKEvent("front", ["showKeystroke", key, this]);
            event.sk_stopPropagation = true;
        } else {
            const last = this.map_node!;
            this.map_node = this.map_node!.find(key);
            if (!this.map_node) {
                onNoMatched?.(last);
                event.sk_suppressed = last !== this.mappings;
                actionDone = Mode.finish(this);
            } else if (this.map_node.meta) {
                const meta = this.map_node.meta;
                const code = meta.code;
                if (code && code.length) {
                    // bound function needs arguments
                    this.pendingMap = code as (key: string) => void;
                    this.isTrustedEvent && dispatchSKEvent("front", ["showKeystroke", key, this]);
                    event.sk_stopPropagation = true;
                } else {
                    this.setLastKeys?.(meta.word);
                    RUNTIME.repeats = parseInt(this.repeats ?? "", 10) || 1;
                    event.sk_stopPropagation =
                        !meta.stopPropagation || callStopPropagation(meta, key);
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
                    actionDone = Mode.finish(thisMode);
                }
            } else {
                this.isTrustedEvent && dispatchSKEvent("front", ["showKeystroke", key, this]);
                event.sk_stopPropagation = true;
            }
        }
        return actionDone;
    }

    static checkEventListener(onMissing: () => void): void {
        const previousState = eventListenerBeats;
        window.dispatchEvent(new CustomEvent("sentinel"));
        if (previousState === eventListenerBeats) {
            init();
            onMissing();
        }
    }
}

function callStopPropagation(meta: TrieMeta, key: string): boolean {
    return typeof meta.stopPropagation === "function"
        ? meta.stopPropagation(key)
        : !!meta.stopPropagation;
}
