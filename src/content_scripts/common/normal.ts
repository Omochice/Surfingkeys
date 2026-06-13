import browser from "./browser";
import { isAutoFocusMarked, isNewlyCreated, unmarkNewlyCreated } from "./domFlags";
import KeyboardUtils from "./keyboardUtils";
import { type Keymap, createKeymap } from "./keymap";
import { ModeHandle, getCurrentMode, showModeStatus, suppressKeyUp } from "./mode";
import { RUNTIME, dispatchSKEvent, runtime } from "./runtime";
import { getScrollableElements, hasScroll } from "./scrollDetection";
import { isSpecialKeyOf } from "./specialKeys";
import Trie from "./trie";
import {
  getRealEdit,
  isEditable,
  isElementClickable,
  isElementPartiallyInViewport,
  isInUIFrame,
  mapInMode,
  scrollIntoViewIfNeeded,
  showBanner,
  showPopup,
} from "./utils";

// Per-element scroll helpers and cached scroll positions Surfingkeys used to
// store as DOM expandos are kept in a WeakMap side-table instead.
type ScrollHelpers = {
  skScrollBy: (x: number, y: number) => unknown;
  smoothScrollBy: (x: number, y: number, d: number) => void;
  safeScroll_: (prop: "scrollTop" | "scrollLeft", value: number, increasing: boolean) => boolean;
  lastScrollTop?: number;
  lastScrollLeft?: number;
};

type InsertLike = { enter(elm: HTMLElement, keepCursor?: boolean): void; exit(): void };

/**
 * The Disabled-mode controller wrapping a private {@link ModeHandle}. createNormal's disable()
 * drives it: `enter` / `exit` push and pop the mode, and `activatedOnElement` records whether
 * disabling was scoped to the focused element.
 */
type DisabledMode = {
  activatedOnElement: boolean;
  enter(priority?: number, reentrant?: boolean): void;
  exit(): void;
};

/**
 * The Lurk-mode controller wrapping a private {@link ModeHandle}. `name` / `mappings` feed
 * mapInMode, `enter` pushes the mode, and `isCurrent` answers whether the handle is the top of the
 * mode stack (createNormal's startLurk asks this, since the controller is no longer its own
 * handle).
 */
type LurkMode = {
  name: string;
  mappings: Trie;
  enter(priority?: number, reentrant?: boolean): void;
  isCurrent(): boolean;
};

/**
 * The PassThrough-mode controller wrapping a private {@link ModeHandle}. `setTimeout` arms the
 * auto-exit, `enter` pushes the mode, `statusLine` is a read-only view of the handle's, and
 * `eventListeners` lets the hub (and tests) dispatch its key / mouse / focus events.
 */
type PassThroughMode = {
  eventListeners: ModeHandle["eventListeners"];
  name: string;
  readonly statusLine: string | undefined;
  setTimeout(timeout?: number): void;
  enter(): void;
};

/**
 * The Normal-mode controller wrapping a private {@link ModeHandle}. `name` / `mappings` feed api.ts
 * and the frontend registry, `keymap` is exposed because api.ts unmapAllExcept replaces `mappings`
 * wholesale and re-roots the keymap, `eventListeners` drives the hub's event dispatch, `statusLine`
 * is a read-only view of the handle's, and `enter` / `onExit` are part of the mode lifecycle. The
 * rest are the normal-mode operations callers invoke.
 */
type NormalMode = {
  eventListeners: ModeHandle["eventListeners"];
  name: string;
  mappings: Trie;
  keymap: Keymap;
  readonly statusLine: string | undefined;
  enter(): void;
  onExit?(): void;
  passFocus(pf: boolean): void;
  startLurk(): string;
  revertToLurk(): void;
  getLurkMode(): LurkMode | undefined;
  addLurkMap(newKeystroke: string, oldKeystroke: string): void;
  toggleBlocklist(): void;
  passThrough(timeout?: number): PassThroughMode;
  once(): void;
  scroll(type: string): void;
  refreshScrollableElements(): HTMLElement[];
  addScrollableElement(elm: HTMLElement): void;
  rotateFrame(): void;
  feedkeys(keys: string): void;
  appendKeysForRepeat(mode: string, keys: string): void;
  addVIMark(mark: string, url?: string): void;
  jumpVIMark(mark: string): void;
  moveTab(pos: number): void;
  captureElement(elm: HTMLElement): void;
  highlightElement(elm: Element): void;
  isScrollKeyInHints(key: string): boolean;
  disable(onElement?: boolean): void;
  enable(): void;
};

function createDisabled(normal: NormalMode): DisabledMode {
  const mode = new ModeHandle("Disabled");
  // hide status line for Disabled mode
  mode.statusLine = "";
  // Disabled has higher priority than others.
  mode.priority = 99;

  const self: DisabledMode = {
    // exposed as a property because createNormal's disable() sets it from outside
    activatedOnElement: false,
    enter(priority?: number, reentrant?: boolean): void {
      mode.enter(priority, reentrant);
    },
    exit(): void {
      mode.exit();
    },
  };

  mode.addEventListener("keydown", (event) => {
    // prevent this event to be handled by Surfingkeys' other listeners
    event.sk_suppressed = true;
    const keyName = event.sk_keyName ?? "";
    if (
      self.activatedOnElement &&
      !document.activeElement!.matches(runtime.conf.disabledOnActiveElementPattern as string)
    ) {
      normal.enable();
      self.activatedOnElement = false;
    } else if (isSpecialKeyOf("<Alt-s>", keyName)) {
      normal.toggleBlocklist();
      self.exit();
      event.sk_stopPropagation = true;
    }
  });

  return self;
}

function createLurk(normal: NormalMode): LurkMode {
  const mode = new ModeHandle("Lurk");
  const mappings = new Trie();
  const keymap = createKeymap(() => mappings);

  function enterNormal() {
    normal.enter();
    if (window === top) {
      RUNTIME("setSurfingkeysIcon", {
        status: "enabled",
      });
    }
  }

  mappings.add(KeyboardUtils.encodeKeystroke("<Alt-i>"), {
    annotation: "Enter normal mode",
    feature_group: 15,
    code: enterNormal,
  });
  mappings.add("p", {
    annotation: "Enter ephemeral normal mode to temporarily enable SurfingKeys",
    feature_group: 15,
    code: () => {
      enterNormal();
      setTimeout(() => {
        normal.revertToLurk();
      }, 1000);
    },
  });

  // Lurk and Disabled should be mutually exclusive.
  mode.addEventListener("keydown", (event) => {
    const realTarget = getRealEdit(event);
    if (!isEditable(realTarget) && event.sk_keyName?.length) {
      keymap.handleKey(event);
      if (event.sk_stopPropagation) {
        // keyup event also needs to be suppressed for the key whose keydown has been suppressed.
        suppressKeyUp(event.keyCode!);
      }
    }
  });

  return {
    name: mode.name,
    mappings,
    enter(priority?: number, reentrant?: boolean): void {
      mode.enter(priority, reentrant);
    },
    isCurrent(): boolean {
      return getCurrentMode() === mode;
    },
  };
}

function createPassThrough(): PassThroughMode {
  let _autoExit: ReturnType<typeof setTimeout> | undefined;
  let _timeout: number | undefined;
  const mode = new ModeHandle("PassThrough");

  mode
    .addEventListener("keydown", (event) => {
      // prevent this event to be handled by Surfingkeys' other listeners
      event.sk_suppressed = true;
      if (isSpecialKeyOf("<Esc>", event.sk_keyName ?? "")) {
        mode.exit();
        event.sk_stopPropagation = true;
      } else if (_timeout && _timeout > 0) {
        if (_autoExit) {
          clearTimeout(_autoExit);
          _autoExit = undefined;
        }
        _autoExit = setTimeout(() => {
          mode.exit();
        }, _timeout);
      }
    })
    .addEventListener("mousedown", (event) => {
      event.sk_suppressed = true;
    });
  mode.addEventListener("focus", (event) => {
    event.sk_suppressed = true;
  });

  mode.onEnter = () => {
    if (_timeout && _timeout > 0) {
      _autoExit = setTimeout(() => {
        mode.exit();
      }, _timeout);
      mode.statusLine = `ephemeral(${_timeout}ms) pass through`;
    } else {
      mode.statusLine = "pass through";
    }
  };

  return {
    eventListeners: mode.eventListeners,
    name: mode.name,
    get statusLine() {
      return mode.statusLine;
    },
    setTimeout(timeout?: number): void {
      _timeout = timeout;
    },
    enter(): void {
      mode.enter();
    },
  };
}

function createNormal(insert: InsertLike): NormalMode {
  const mode = new ModeHandle("Normal");
  const mappings = new Trie();

  // let next focus event pass
  let _passFocus = false;
  let _lurk: LurkMode | undefined = undefined;
  let _lurkMaps: [string, string][] | undefined = [];
  let _once = false;
  let keyHeld = 0;
  let scrollNodes: HTMLElement[] | null = null;
  let scrollIndex = 0;
  let lastKeys: string[] | undefined;
  let scrollHelpers = new WeakMap<Element, ScrollHelpers>();

  const keymap = createKeymap(() => self.mappings, {
    enableRepeats: true,
    onKeysExecuted: (keys, meta) => {
      if (!meta.repeatIgnore && keys.length > 1) {
        lastKeys = [keys];
        saveLastKeys();
      }
    },
  });

  const passFocus = (pf: boolean): void => {
    _passFocus = pf;
  };

  const startLurk = (): string => {
    let state = "lurking";
    if (!_lurk) {
      mode.exit();
      _lurk = createLurk(self);
      _lurkMaps!.forEach((lurkMap) => {
        mapInMode(_lurk!, lurkMap[0], lurkMap[1]);
        _lurk!.mappings.remove(KeyboardUtils.encodeKeystroke(lurkMap[1]));
      });
      _lurkMaps = undefined;
      _lurk.enter(0, true);
    } else if (!_lurk.isCurrent()) {
      state = "enabled";
    }
    return state;
  };
  const revertToLurk = (): void => {
    // peeking exit to keep modes such hints above normal.
    mode.exit(true);
    if (window === top) {
      RUNTIME("setSurfingkeysIcon", {
        status: "lurking",
      });
    }
  };
  const getLurkMode = (): LurkMode | undefined => {
    return _lurk;
  };
  const addLurkMap = (newKeystroke: string, oldKeystroke: string): void => {
    _lurkMaps!.push([newKeystroke, oldKeystroke]);
  };

  mode.addEventListener("keydown", (event) => {
    const realTarget = getRealEdit(event);
    const keyName = event.sk_keyName ?? "";
    const eventKey = (event as KeyboardEvent).key;
    if (realTarget && isEditable(realTarget) && event.isTrusted) {
      if (isSpecialKeyOf("<Esc>", keyName)) {
        realTarget.blur();
        insert.exit();
      } else {
        if (runtime.conf.editableBodyCare && realTarget === document.body && eventKey !== "i") {
          mode.statusLine = "Press i to enter Insert mode";
          runtime.conf.showModeStatus = true;
          if (keyName.length) {
            keymap.handleKey(event);
          }
        } else {
          event.sk_stopPropagation =
            runtime.conf.editableBodyCare && realTarget === document.body && eventKey === "i";
          if (event.sk_stopPropagation) {
            self.passFocus(true);
            realTarget.focus();
          }

          let stealFocus = false;
          if (!isElementPartiallyInViewport(realTarget)) {
            let n: HTMLElement | null = realTarget;
            while (n && n !== document.documentElement && !isNewlyCreated(n)) {
              n = n.parentElement;
            }
            stealFocus = n != null && n !== document.documentElement && isNewlyCreated(n);
          }
          if (stealFocus) {
            // steal focus from dynamically created input widget
            realTarget.blur();
            unmarkNewlyCreated(realTarget);
            keymap.handleKey(event);
          } else {
            // keep cursor where it is
            insert.enter(realTarget, true);
          }
        }
      }
    } else if (isSpecialKeyOf("<Alt-s>", keyName)) {
      self.toggleBlocklist();
      keymap.finish();
      event.sk_stopPropagation = true;
    } else if (keyName.length) {
      const done = keymap.handleKey(event, () => {
        // revert to lurk only when Esc is not handled and lurk mode available.
        if (isSpecialKeyOf("<Esc>", keyName) && _lurk) {
          self.revertToLurk();
        }
      });
      if (_once && done) {
        _once = false;
        mode.exit();
      }
    }
    if (event.sk_stopPropagation) {
      // keyup event also needs to be suppressed for the key whose keydown has been suppressed.
      suppressKeyUp(event.keyCode!);
    }
  });
  mode.addEventListener("blur", () => {
    keyHeld = 0;
  });
  mode.addEventListener("focus", (event) => {
    showModeStatus();
    if (runtime.conf.stealFocusOnLoad && !isInUIFrame()) {
      const elm = getRealEdit(event);
      if (elm && isEditable(elm)) {
        if (_passFocus || isAutoFocusMarked(elm)) {
          if (!runtime.conf.enableAutoFocus) {
            // prevent focus on input only when enableAutoFocus is turned off.
            _passFocus = false;
          }
        } else {
          elm.blur();
          event.sk_stopPropagation = true;
        }
      }
    }
  });
  mode.addEventListener("keyup", () => {
    setTimeout(() => {
      keyHeld = 0;
    }, 0);
  });
  mode.addEventListener("mousedown", (event) => {
    // The isTrusted read-only property of the Event interface is a boolean
    // that is true when the event was generated by a user action, and false
    // when the event was created or modified by a script or dispatched via dispatchEvent.

    // enable only mouse click from human being to focus input
    if (runtime.conf.enableAutoFocus) {
      self.passFocus(true);
    } else {
      self.passFocus(event.isTrusted);
    }

    const realTarget = getRealEdit(event);
    if (realTarget && isEditable(realTarget)) {
      // keep cursor where it is
      insert.enter(realTarget, true);
    } else {
      insert.exit();
    }

    if (document.activeElement!.matches(runtime.conf.disabledOnActiveElementPattern as string)) {
      setTimeout(() => {
        self.disable(true);
      }, 100);
    }
  });

  const toggleBlocklist = (): void => {
    if (document.location.href.indexOf(browser.runtime.getURL("/")) !== 0) {
      RUNTIME(
        "toggleBlocklist",
        {
          blocklistPattern: runtime.conf.blocklistPattern || "",
        },
        (resp: { state: string; blocklist: Record<string, unknown>; url?: string }) => {
          if (resp.state === "disabled") {
            if (Object.hasOwn(resp.blocklist, ".*")) {
              showBanner(
                "Surfingkeys is globally disabled, please enable it globally from popup menu.",
                3000,
              );
            } else {
              showBanner("Surfingkeys turned OFF for " + resp.url, 3000);
            }
          } else {
            showBanner("Surfingkeys turned ON for " + resp.url, 3000);
          }
        },
      );
    } else {
      showBanner("You could not toggle Surfingkeys on its own pages.", 3000);
    }
  };

  const _passThrough = createPassThrough();
  /**
   * Enter PassThrough mode.
   *
   * @param {number} [timeout] How many milliseconds to linger in PassThrough mode, to ignore it
   *   will stay in PassThrough mode until an Escape key is pressed.
   * @name Normal.passThrough
   */
  const passThrough = (timeout?: number): PassThroughMode => {
    _passThrough.setTimeout(timeout);
    _passThrough.enter();
    return _passThrough;
  };
  const once = (): void => {
    _once = true;
    mode.enter();
  };
  mappings.add(KeyboardUtils.encodeKeystroke("<Alt-i>"), {
    annotation: "Enter PassThrough mode to temporarily suppress SurfingKeys",
    feature_group: 0,
    code: () => {
      self.passThrough();
    },
  });
  mappings.add("p", {
    annotation: "Enter ephemeral PassThrough mode to temporarily suppress SurfingKeys",
    feature_group: 0,
    code: () => {
      self.passThrough(1000);
    },
  });

  function initScroll(elm: HTMLElement): void {
    const helpers: ScrollHelpers = {
      skScrollBy(x: number, y: number) {
        if (
          runtime.conf.smartPageBoundary &&
          (elm === document.scrollingElement ||
            (scrollNodes!.length === 1 && elm === scrollNodes![0]))
        ) {
          if (elm.scrollTop === 0 && y < 0) {
            return dispatchSKEvent("hints", ["topBoundaryHit"]);
          }
          if (elm.scrollHeight - elm.scrollTop <= elm.clientHeight + 1 && y > 0) {
            return dispatchSKEvent("hints", ["bottomBoundaryHit"]);
          }
        }
        if (RUNTIME.repeats > 1) {
          x = RUNTIME.repeats * x;
          y = RUNTIME.repeats * y;
          RUNTIME.repeats = 0;
        }
        if (runtime.conf.smoothScroll) {
          const d = Math.max(100, 20 * Math.log(Math.abs(x || y)));
          helpers.smoothScrollBy(x, y, d);
        } else {
          dispatchSKEvent("hints", ["scrollStarted"]);
          elm.scrollBy({
            // "instant" is a valid runtime value the lib types omit.
            behavior: "instant" as ScrollBehavior,
            left: x,
            top: y,
          });
          dispatchSKEvent("hints", ["scrollDone"]);
        }
      },
      safeScroll_(prop, value, increasing) {
        const clientHeight =
          elm === document.scrollingElement ? window.innerHeight : elm.clientHeight;
        const clientWidth = elm === document.scrollingElement ? window.innerWidth : elm.clientWidth;
        const rangeMin = 0;
        const rangeMax =
          prop === "scrollTop" ? elm.scrollHeight - clientHeight : elm.scrollWidth - clientWidth;
        const boundary = increasing ? rangeMax : rangeMin;
        if (value >= rangeMin && value <= rangeMax) {
          elm[prop] = value;
          return false;
        } else {
          elm[prop] = boundary;
          return true;
        }
      },
      smoothScrollBy(x: number, y: number, d: number) {
        if (!keyHeld) {
          const prop: "scrollTop" | "scrollLeft" = y ? "scrollTop" : "scrollLeft";
          const distance = y || x;
          const duration = d;
          let previousTimestamp = 0;
          let originValue = elm[prop];
          let stepCompleted = false;
          keyHeld = 1;
          const step = (t: number): void => {
            if (previousTimestamp === 0) {
              // init previousTimestamp in first step
              previousTimestamp = t;
              dispatchSKEvent("hints", ["scrollStarted"]);
              window.requestAnimationFrame(step);
              return;
            }
            const old = elm[prop];
            const delta = ((t - previousTimestamp) * distance) / duration;
            let boundaryHit = false;
            if (Math.abs(old + delta - originValue) >= Math.abs(distance)) {
              stepCompleted = true;
              if (keyHeld > runtime.conf.scrollFriction) {
                boundaryHit = helpers.safeScroll_(prop, old + delta, distance > 0);
                originValue = elm[prop];
              } else if (keyHeld > 0) {
                keyHeld++;
              } else {
                boundaryHit = helpers.safeScroll_(prop, originValue + distance, distance > 0);
              }
            } else {
              boundaryHit = helpers.safeScroll_(prop, old + delta, distance > 0);
            }
            previousTimestamp = t;

            if (
              !keyHeld &&
              (boundaryHit || stepCompleted) // distance completed
            ) {
              elm.style.scrollBehavior = "";
              dispatchSKEvent("hints", ["scrollDone"]);
            } else {
              window.requestAnimationFrame(step);
            }
          };
          elm.style.scrollBehavior = "auto";
          window.requestAnimationFrame(step);
        }
      },
    };
    scrollHelpers.set(elm, helpers);
  }

  // set scrollIndex to the highest node
  function initScrollIndex(): void {
    if (!scrollNodes || scrollNodes.length === 0) {
      scrollNodes = getScrollableElements();
      scrollNodes.forEach((n) => {
        n.removeEventListener("mousedown", scrollableMousedownHandler);
        n.addEventListener("mousedown", scrollableMousedownHandler);
        n.dataset["hint_scrollable"] = "true";
      });
      scrollIndex = 0;
    }
  }

  function scrollableMousedownHandler(e: MouseEvent): void {
    const n = e.currentTarget as HTMLElement;
    const target = e.target as HTMLElement;
    if (!n.contains(target)) return;
    let index = scrollNodes!.lastIndexOf(target);
    for (let i = scrollNodes!.length - 1; i >= 0 && index === -1; i--) {
      const sn = scrollNodes![i];
      if (sn != null && sn !== document.body && sn.contains(target)) {
        index = i;
      }
    }
    if (index !== -1) {
      scrollIndex = index;
    }
  }

  const highlightElement = (elm: Element): void => {
    let rc;
    if (document.scrollingElement === elm) {
      rc = {
        top: 0,
        left: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    } else {
      rc = elm.getBoundingClientRect();
    }
    dispatchSKEvent("front", [
      "highlightElement",
      {
        duration: 200,
        rect: {
          top: rc.top,
          left: rc.left,
          width: rc.width,
          height: rc.height,
        },
      },
    ]);
  };
  function changeScrollTarget(silent?: boolean): void {
    scrollNodes = getScrollableElements();
    if (scrollNodes.length > 0) {
      scrollIndex = (scrollIndex + 1) % scrollNodes.length;
      const sn = scrollNodes[scrollIndex];
      if (sn != null) {
        scrollIntoViewIfNeeded(sn);
        if (!silent) {
          self.highlightElement(sn);
        }
      }
    }
  }

  const scrollTypeDirections = new Map([
    ["down", "vertical"],
    ["up", "vertical"],
    ["pageDown", "vertical"],
    ["fullPageDown", "vertical"],
    ["pageUp", "vertical"],
    ["fullPageUp", "vertical"],
    ["top", "vertical"],
    ["bottom", "vertical"],
    ["byRatio", "vertical"],
    ["left", "horizontal"],
    ["right", "horizontal"],
    ["leftmost", "horizontal"],
    ["rightmost", "horizontal"],
  ]);

  function canScrollInDirection(elm: HTMLElement, direction: string): boolean {
    const isMainPage = elm === document.scrollingElement || elm === document.body;
    const clientHeight = isMainPage ? window.innerHeight : elm.clientHeight;
    const clientWidth = isMainPage ? window.innerWidth : elm.clientWidth;

    switch (direction) {
      case "vertical": {
        return elm.scrollHeight > clientHeight + 1;
      }
      case "horizontal": {
        return elm.scrollWidth > clientWidth + 1;
      }
      default: {
        return false;
      }
    }
  }

  /**
   * Scroll within current target.
   *
   * @param {string} type Down | up | pageDown | fullPageDown | pageUp | fullPageUp | top | bottom |
   *   left | right | leftmost | rightmost | byRatio
   * @name Normal.scroll
   */
  const scroll = (type: string): void => {
    initScrollIndex();
    let scrollNode = document.scrollingElement as HTMLElement | null;
    if (scrollNodes!.length > 0) {
      scrollNode = scrollNodes![scrollIndex]!;
      if (scrollNode !== document.scrollingElement && scrollNode !== document.body) {
        const br = scrollNode.getBoundingClientRect();
        if (
          br.width === 0 ||
          br.height === 0 ||
          !isElementPartiallyInViewport(scrollNode) ||
          (!hasScroll(scrollNode, "x", 16) && !hasScroll(scrollNode, "y", 16))
        ) {
          // Recompute scrollable elements, the webpage has changed.
          self.refreshScrollableElements();
          scrollNode = scrollNodes![scrollIndex]!;
        }
      }
    }
    if (!scrollNode && !document.scrollingElement && document.body) {
      // to set document.body.style.overflow auto will make document.scrollingElement null
      // set visible to bring it back.
      document.body.style.overflow = "visible";
      scrollNode = document.scrollingElement as HTMLElement | null;
    }
    if (!scrollNode) {
      // scrollNode could be null on a page with frameset as its body.
      return;
    }

    // Fall back to document scrolling if enabled and current element can't scroll in requested direction
    if (
      runtime.conf.scrollFallback &&
      scrollNode !== document.scrollingElement &&
      scrollNode !== document.body
    ) {
      const direction = scrollTypeDirections.get(type);

      if (direction && !canScrollInDirection(scrollNode, direction)) {
        scrollNode = document.scrollingElement as HTMLElement | null;
        if (!scrollNode && document.body) {
          document.body.style.overflow = "visible";
          scrollNode = document.scrollingElement as HTMLElement | null;
        }
      }
    }

    if (!scrollNode) {
      return;
    }
    if (!scrollHelpers.has(scrollNode)) {
      initScroll(scrollNode);
    }
    const helpers = scrollHelpers.get(scrollNode)!;
    const size: [number, number] =
      scrollNode === document.scrollingElement
        ? [window.innerWidth, window.innerHeight]
        : [scrollNode.offsetWidth, scrollNode.offsetHeight];
    helpers.lastScrollTop = scrollNode.scrollTop;
    helpers.lastScrollLeft = scrollNode.scrollLeft;
    switch (type) {
      case "down": {
        helpers.skScrollBy(0, runtime.conf.scrollStepSize);
        break;
      }
      case "up": {
        helpers.skScrollBy(0, -runtime.conf.scrollStepSize);
        break;
      }
      case "pageDown": {
        helpers.skScrollBy(0, Math.round(size[1] / 2));
        break;
      }
      case "fullPageDown": {
        helpers.skScrollBy(0, size[1]);
        break;
      }
      case "pageUp": {
        helpers.skScrollBy(0, -Math.round(size[1] / 2));
        break;
      }
      case "fullPageUp": {
        helpers.skScrollBy(0, -size[1]);
        break;
      }
      case "top": {
        helpers.skScrollBy(0, -scrollNode.scrollTop);
        break;
      }
      case "bottom": {
        helpers.skScrollBy(scrollNode.scrollLeft, scrollNode.scrollHeight - scrollNode.scrollTop);
        break;
      }
      case "left": {
        helpers.skScrollBy(-Math.round(runtime.conf.scrollStepSize / 2), 0);
        break;
      }
      case "right": {
        helpers.skScrollBy(Math.round(runtime.conf.scrollStepSize / 2), 0);
        break;
      }
      case "leftmost": {
        helpers.skScrollBy(-scrollNode.scrollLeft - 10, 0);
        break;
      }
      case "rightmost": {
        helpers.skScrollBy(scrollNode.scrollWidth - scrollNode.scrollLeft - size[0] + 20, 0);
        break;
      }
      case "byRatio": {
        const y =
          Number.parseInt(String((RUNTIME.repeats * scrollNode.scrollHeight) / 100)) -
          size[1] / 2 -
          scrollNode.scrollTop;
        RUNTIME.repeats = 0;
        helpers.skScrollBy(0, y);
        break;
      }
      default: {
        break;
      }
    }
    dispatchSKEvent("observer", ["turnOff"]);
  };

  const refreshScrollableElements = (): HTMLElement[] => {
    scrollNodes = null;
    initScrollIndex();
    return scrollNodes!;
  };

  const addScrollableElement = (elm: HTMLElement): void => {
    const current = scrollNodes?.[scrollIndex];
    if (
      !scrollNodes ||
      ((current == null || !elm.contains(current)) && !scrollNodes.includes(elm))
    ) {
      initScrollIndex();
      scrollNodes!.push(elm);
      scrollIndex = scrollNodes!.length - 1;
    }
  };

  const rotateFrame = (): void => {
    RUNTIME("nextFrame", {
      frameId: (window as unknown as { frameId: number }).frameId,
    });
  };

  /**
   * Feed keys into Normal mode.
   *
   * @param {string} keys The keys to be fed into Normal mode.
   * @name Normal.feedkeys
   */
  const feedkeys = (keys: string): void => {
    setTimeout(() => {
      const evt = new Event("keydown");
      for (const ch of keys) {
        evt.sk_keyName = ch;
        keymap.handleKey(evt);
      }
    }, 1);
  };

  function saveLastKeys(): void {
    RUNTIME("localData", {
      data: {
        lastKeys: lastKeys,
      },
    });
  }

  const appendKeysForRepeat = (modeName: string, keys: string): void => {
    if (lastKeys && lastKeys.length > 0) {
      // keys for normal mode must be pushed.
      lastKeys.push(`${modeName}\t${keys}`);
      saveLastKeys();
    }
  };

  const addVIMark = (mark: string, url?: string): void => {
    url = url || window.location.href;
    const mo: Record<string, { url: string; scrollLeft: number; scrollTop: number }> = {
      [mark]: {
        url: url,
        scrollLeft: document.scrollingElement!.scrollLeft,
        scrollTop: document.scrollingElement!.scrollTop,
      },
    };
    RUNTIME("addVIMark", { mark: mo });
    showBanner(`Mark '${mark}' added for: ${url}.`);
  };

  /**
   * Jump to a vim-like mark.
   *
   * @param {string} mark A vim-like mark.
   * @name Normal.jumpVIMark
   */
  const jumpVIMark = (mark: string): void => {
    if (mark === "'") {
      initScrollIndex();
      if (scrollNodes!.length > 0) {
        const scrollNode = scrollNodes![scrollIndex]!;
        const helpers = scrollHelpers.get(scrollNode);
        if (helpers?.lastScrollTop != null && helpers.lastScrollLeft != null) {
          const lt = scrollNode.scrollTop;
          const ll = scrollNode.scrollLeft;
          scrollNode.scrollTop = helpers.lastScrollTop;
          scrollNode.scrollLeft = helpers.lastScrollLeft;
          helpers.lastScrollTop = lt;
          helpers.lastScrollLeft = ll;
        }
      }
    } else {
      RUNTIME("jumpVIMark", {
        mark: mark,
      });
    }
  };

  const moveTab = (pos: number): void => {
    RUNTIME("moveTab", {
      position: pos,
    });
  };

  const captureElement = (elm: HTMLElement): void => {
    RUNTIME("getCaptureSize", null, (response: { width: number }) => {
      const scale = response.width / window.innerWidth;

      elm.scrollTop = 0;
      elm.scrollLeft = 0;
      let lastScrollTop = -1;
      let lastScrollLeft = -1;
      // hide scrollbars
      const overflowY = elm.style.overflowY;
      elm.style.overflowY = "hidden";
      const overflowX = elm.style.overflowX;
      elm.style.overflowX = "hidden";
      // hide borders
      const borderStyle = elm.style.borderStyle;
      elm.style.borderStyle = "none";
      dispatchSKEvent("front", ["toggleStatus", false]);

      let dx = 0;
      let dy = 0;
      let sx: number;
      let sy: number;
      let ww: number;
      let wh: number;
      const dh = elm.scrollHeight;
      const dw = elm.scrollWidth;
      if (elm === document.scrollingElement) {
        ww = window.innerWidth;
        wh = window.innerHeight;
        sx = 0;
        sy = 0;
      } else {
        const br = elm.getBoundingClientRect();
        // visible rectangle
        const rc: [number, number, number, number] = [
          Math.max(br.left, 0),
          Math.max(br.top, 0),
          Math.min(br.right, window.innerWidth),
          Math.min(br.bottom, window.innerHeight),
        ];
        ww = rc[2] - rc[0];
        wh = rc[3] - rc[1];
        sx = rc[0] * scale;
        sy = rc[1] * scale;
      }
      const sw = ww * scale;
      const sh = wh * scale;

      const canvas = document.createElement("canvas");
      canvas.width = dw * scale;
      canvas.height = dh * scale;
      const ctx = canvas.getContext("2d")!;

      const img = document.createElement("img");

      img.onload = function () {
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
        if (lastScrollTop === elm.scrollTop) {
          if (lastScrollLeft === elm.scrollLeft) {
            // done
            dispatchSKEvent("front", ["toggleStatus", true]);
            showPopup(`<img src='${canvas.toDataURL("image/png")}' />`);
            // restore overflow
            elm.style.overflowY = overflowY;
            elm.style.overflowX = overflowX;
            // restore borders
            elm.style.borderStyle = borderStyle;
          } else {
            lastScrollTop = -1;
            elm.scrollTop = 0;
            dy = 0;
            lastScrollLeft = elm.scrollLeft;
            if (elm.scrollLeft + 2 * ww < dw) {
              elm.scrollLeft += ww;
              dx += ww * scale;
            } else {
              elm.scrollLeft += dw % ww;
              dx = elm.scrollLeft * scale;
            }
            setTimeout(() => {
              RUNTIME("captureVisibleTab", null, (response: { dataUrl: string }) => {
                img.src = response.dataUrl;
              });
            }, 1000);
          }
        } else {
          lastScrollTop = elm.scrollTop;
          if (elm.scrollTop + 2 * wh < dh) {
            elm.scrollTop += wh;
            dy += wh * scale;
          } else {
            elm.scrollTop += dh % wh;
            dy = elm.scrollTop * scale;
          }
          setTimeout(() => {
            RUNTIME("captureVisibleTab", null, (response: { dataUrl: string }) => {
              img.src = response.dataUrl;
            });
          }, 1000);
        }
      };

      // wait 500 millisecond for keystrokes of Surfingkeys to hide
      setTimeout(() => {
        RUNTIME("captureVisibleTab", null, (response: { dataUrl: string }) => {
          img.src = response.dataUrl;
        });
      }, 500);
    });
  };

  mappings.add("yG", {
    annotation: "Capture current full page",
    feature_group: 7,
    code: () => {
      self.captureElement(document.scrollingElement as HTMLElement);
    },
  });
  mappings.add("yS", {
    annotation: "Capture scrolling element",
    feature_group: 7,
    code: () => {
      let scrollNode = document.scrollingElement as HTMLElement;
      initScrollIndex();
      if (scrollNodes!.length > 0) {
        scrollNode = scrollNodes![scrollIndex]!;
      }
      self.captureElement(scrollNode);
    },
  });

  mappings.add("cS", {
    annotation: "Reset scroll target",
    feature_group: 2,
    code: () => {
      scrollNodes = null;
      initScrollIndex();
      if (scrollNodes!.length > 0) {
        const scrollNode = scrollNodes![scrollIndex];
        if (scrollNode != null) {
          self.highlightElement(scrollNode);
        }
      }
    },
  });

  // Bound scroll actions that may also be used to scroll in Hints mode, tracked in a side table
  // instead of an expando flag on the function.
  const hintScrollCodes = new WeakSet<(...args: string[]) => void>();
  const bindScrollForHints = (action: string): (() => void) => {
    const f = scroll.bind(undefined, action);
    hintScrollCodes.add(f);
    return f;
  };
  const isScrollKeyInHints = (key: string): boolean => {
    const code = mappings.find(key)?.meta?.code;
    return code != null && hintScrollCodes.has(code);
  };

  mappings.add("e", {
    annotation: "Scroll half page up",
    feature_group: 2,
    repeatIgnore: true,
    code: scroll.bind(undefined, "pageUp"),
  });
  mappings.add("U", {
    annotation: "Scroll full page up",
    feature_group: 2,
    repeatIgnore: true,
    code: scroll.bind(undefined, "fullPageUp"),
  });
  mappings.add("d", {
    annotation: "Scroll half page down",
    feature_group: 2,
    repeatIgnore: true,
    code: scroll.bind(undefined, "pageDown"),
  });
  mappings.add("P", {
    annotation: "Scroll full page down",
    feature_group: 2,
    repeatIgnore: true,
    code: scroll.bind(undefined, "fullPageDown"),
  });
  mappings.add("gg", {
    annotation: "Scroll to the top of the page",
    feature_group: 2,
    repeatIgnore: true,
    code: scroll.bind(undefined, "top"),
  });
  mappings.add("G", {
    annotation: "Scroll to the bottom of the page",
    feature_group: 2,
    repeatIgnore: true,
    code: bindScrollForHints("bottom"),
  });
  mappings.add("j", {
    annotation: "Scroll down",
    feature_group: 2,
    repeatIgnore: true,
    code: bindScrollForHints("down"),
  });
  mappings.add("k", {
    annotation: "Scroll up",
    feature_group: 2,
    repeatIgnore: true,
    code: bindScrollForHints("up"),
  });
  mappings.add("h", {
    annotation: "Scroll left",
    feature_group: 2,
    repeatIgnore: true,
    code: bindScrollForHints("left"),
  });
  mappings.add("l", {
    annotation: "Scroll right",
    feature_group: 2,
    repeatIgnore: true,
    code: bindScrollForHints("right"),
  });
  mappings.add("0", {
    annotation: "Scroll all the way to the left",
    feature_group: 2,
    repeatIgnore: true,
    code: bindScrollForHints("leftmost"),
  });
  mappings.add("$", {
    annotation: "Scroll all the way to the right",
    feature_group: 2,
    repeatIgnore: true,
    code: bindScrollForHints("rightmost"),
  });
  mappings.add("%", {
    annotation: "Scroll to percentage of current page",
    feature_group: 2,
    repeatIgnore: true,
    code: scroll.bind(undefined, "byRatio"),
  });
  mappings.add("cs", {
    annotation: "Change scroll target",
    feature_group: 2,
    repeatIgnore: true,
    code: () => {
      changeScrollTarget();
    },
  });

  mappings.add("/", {
    annotation: "Find in current page",
    feature_group: 9,
    repeatIgnore: true,
    code: () => {
      dispatchSKEvent("front", ["openFinder"]);
    },
  });

  mappings.add("E", {
    annotation: "Go one tab left",
    feature_group: 3,
    repeatIgnore: true,
    code: () => {
      RUNTIME("previousTab");
    },
  });
  mappings.add("R", {
    annotation: "Go one tab right",
    feature_group: 3,
    repeatIgnore: true,
    code: () => {
      RUNTIME("nextTab");
    },
  });

  function _onMouseUp(event: MouseEvent): void {
    const target = event.target as Element;
    if (
      runtime.conf.mouseSelectToQuery.includes(window.origin) &&
      !isElementClickable(target) &&
      !target.matches(".cm-matchhighlight")
    ) {
      // perform inline query after 1 ms
      // to avoid calling on selection collapse
      setTimeout(() => {
        dispatchSKEvent("front", ["querySelectedWord"]);
      }, 1);
    }
  }

  let _disabled: DisabledMode | null = null;
  const disable = (onElement?: boolean): void => {
    if (!_disabled) {
      _disabled = createDisabled(self);
      _disabled.enter(0, true);
    }
    _disabled.activatedOnElement = !!onElement;
    dispatchSKEvent("observer", ["turnOff"]);
    document.removeEventListener("mouseup", _onMouseUp);
  };

  const enable = (): void => {
    if (_disabled) {
      _disabled.exit();
      _disabled = null;
    }
    document.addEventListener("mouseup", _onMouseUp);
  };
  enable();

  mode.onExit = () => {
    dispatchSKEvent("observer", ["turnOff"]);
    // Drop all cached scroll helpers so the next activation re-initializes them.
    scrollHelpers = new WeakMap();
  };

  const self: NormalMode = {
    // The hub dispatches events through the private handle's listener map; sharing the reference
    // keeps the focus/keydown/mousedown listeners registered above observable through the
    // controller. `statusLine` is read-only because the handle owns it and the hub reads it off the
    // stacked handle; `onExit` mirrors the handle's lifecycle hook.
    eventListeners: mode.eventListeners,
    name: mode.name,
    get statusLine() {
      return mode.statusLine;
    },
    onExit: mode.onExit,
    enter(): void {
      mode.enter();
    },
    mappings,
    keymap,
    passFocus,
    startLurk,
    revertToLurk,
    getLurkMode,
    addLurkMap,
    toggleBlocklist,
    passThrough,
    once,
    scroll,
    refreshScrollableElements,
    addScrollableElement,
    rotateFrame,
    feedkeys,
    appendKeysForRepeat,
    addVIMark,
    jumpVIMark,
    moveTab,
    captureElement,
    highlightElement,
    isScrollKeyInHints,
    disable,
    enable,
  };

  return self;
}

export default createNormal;
