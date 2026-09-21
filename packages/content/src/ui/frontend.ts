import { attachFaviconToImgSrc, initL10n, isInUIFrame } from "@sk/adapter/platform-utils";
import createAPI from "@sk/core/api";
import { applyDefaultMappings, registerDefaultExtras } from "@sk/core/applyDefaultMappings";
import createDefaultMappings from "@sk/core/default";
import { type FeatureGroup, featureGroups, isFeatureGroup } from "@sk/core/featureGroup";
import KeyboardUtils from "@sk/core/keyboardUtils";
import { ModeHandle, initModeHub } from "@sk/core/mode";
import createModeGraph, { type ModeContext } from "@sk/core/modeGraph";
import { isSpecialKeyOf, specialKeys } from "@sk/core/specialKeys";
import type Trie from "@sk/core/trie";
import {
  format,
  generateQuickGuid,
  getAnnotations,
  getWordUnderCursor,
  hintLabel,
  hintLink,
  htmlEncode,
  initSKFunctionListener,
  refreshHints,
  requireElement,
  rotateInput,
  setSanitizedContent,
  mapInMode,
} from "@sk/core/utils";
import { RUNTIME, runtime } from "@sk/messaging/runtime";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import * as v from "valibot";

import { createEngineEnv } from "../common/createEngineEnv";
import createCommands from "./command";
import { Banner as BannerView } from "./components/Banner";
import { Bubble as BubbleView } from "./components/Bubble";
import { Keystroke as KeystrokeView } from "./components/Keystroke";
import { Popup as PopupView } from "./components/Popup";
import { StatusBar as StatusBarView } from "./components/StatusBar";
import type { StatusCell } from "./components/StatusBar";
import { Tabs as TabsView, type TabsTab } from "./components/Tabs";
import { Usage as UsageView } from "./components/Usage";
import createOmnibar from "./omnibar";

// Any page can postMessage to this window, so the envelope from the content
// side is external data; validate its shape before dispatching. looseObject
// preserves unknown keys so the payload reaches handlers (typed `any`) intact.
const frontendMessageEnvelopeSchema = v.looseObject({
  surfingkeysFrontendData: v.looseObject({
    action: v.optional(v.string()),
    id: v.optional(v.union([v.string(), v.number()])),
    ack: v.optional(v.unknown()),
  }),
});

// Dispatch registry entry: handlers are stored with their own concrete message types then invoked
// with a parsed message; an `unknown` parameter would reject those typed handlers (contravariance).
// eslint-disable-next-line typescript/no-explicit-any
type FrontActionFn = (message?: any) => any;

type FrontMode = {
  actions: Record<string, FrontActionFn>;
  topSize: [number, number];
  topOrigin: string;
  statusBar: HTMLElement;
  addDestroyListener(task: () => void): void;
  contentCommand<R = unknown>(args: Record<string, unknown>, successById?: (msg: R) => void): void;
  postMessage(args: Record<string, unknown>): void;
  flush(): void;
  visualCommand(args: { action: string; query?: string | undefined }): void;
  startInputGuard(): void;
  hidePopup(): void;
  chooseTab(): void;
  showUsage(): void;
  openOmnibar(message: { style?: string } & Record<string, unknown>): void;
  toggleStatus(visible: boolean): void;
};

const Front = (() => {
  const engineEnv = createEngineEnv();
  initModeHub(engineEnv);
  const { clipboard, insert, normal, hints, visual } = createModeGraph(engineEnv);

  const actions: Record<string, FrontActionFn> = {};
  // Response callbacks are stored with their callers' concrete message types (see FrontActionFn).
  // eslint-disable-next-line typescript/no-explicit-any
  const callbacks: Record<string, (msg: any) => unknown> = {};
  const destroyListeners: (() => void)[] = [];
  const topSize: [number, number] = [0, 0];

  // Deliberately kept off FrontMode: nothing outside reads ModeHandle members off the controller.
  const mode = new ModeHandle("Front");

  // The function members are declarations below, so hoisting lets the controller be assembled here,
  // before createOmnibar and the API wiring receive it.
  const self: FrontMode = {
    actions,
    topSize,
    topOrigin: "",
    statusBar: requireElement("#sk_status"),
    addDestroyListener,
    contentCommand,
    postMessage,
    flush,
    visualCommand,
    startInputGuard,
    hidePopup,
    chooseTab,
    showUsage: hidePopup,
    openOmnibar,
    toggleStatus,
  };

  const omnibar = createOmnibar(self, clipboard);

  // Always present: the Commands handler registers `command` while createOmnibar runs. The guard
  // states that instead of a non-null assertion.
  const omnibarCommand = omnibar.command;
  if (omnibarCommand == null) {
    throw new Error("omnibar did not register its command handler");
  }
  createCommands(normal, omnibarCommand, omnibar);

  const modes: Record<string, { name: string; mappings: Trie }> = {
    Insert: insert,
    Normal: normal,
    Visual: visual,
    Omnibar: omnibar,
  };

  const ctx: ModeContext = {
    clipboard,
    insert,
    normal,
    hints,
    visual,
    front: self,
  };
  const api = createAPI(ctx, engineEnv);
  applyDefaultMappings(api, createDefaultMappings(ctx, engineEnv, api.searchSelectedWith));
  registerDefaultExtras(api);

  function addDestroyListener(task: () => void): void {
    destroyListeners.push(task);
  }

  function contentCommand<R = unknown>(
    args: Record<string, unknown>,
    successById?: (msg: R) => void,
  ): void {
    args["toContent"] = true;
    const id = generateQuickGuid();
    args["id"] = id;
    if (successById) {
      args["ack"] = true;
      callbacks[id] = successById;
    }
    top!.postMessage({ surfingkeysUiHostData: args }, self.topOrigin);
  }

  function postMessage(args: Record<string, unknown>): void {
    top!.postMessage({ surfingkeysUiHostData: args }, self.topOrigin);
  }

  let pressedHintKeys = "";
  type DisplayElement = HTMLElement & {
    onHide?: () => void;
    onHit?: ((matched: unknown) => void) | undefined;
  };
  type OmnibarElement = DisplayElement & {
    onShow: (message: Record<string, unknown>) => void;
  };
  type BubbleElement = DisplayElement & {
    noPointerEvents?: boolean | undefined;
  };
  let display: DisplayElement | null = null;
  mode.addEventListener("keydown", (event) => {
    if (isSpecialKeyOf("<Esc>", event.sk_keyName ?? "")) {
      self.hidePopup();
      event.sk_stopPropagation = true;
    } else if (display && display.style.display !== "none") {
      const tabHints = display.querySelectorAll<HTMLElement>("div>div.sk_tab_hint");
      if (tabHints.length > 0) {
        const key = event.sk_keyName ?? "";
        const characters = hints.getCharacters().toLowerCase();
        if (event.keyCode === KeyboardUtils.keyCodes["backspace"]) {
          if (pressedHintKeys.length > 0) {
            pressedHintKeys = pressedHintKeys.slice(0, -1);
            refreshHints(tabHints, pressedHintKeys);
          }
        } else if (characters.includes(key.toLowerCase())) {
          pressedHintKeys = pressedHintKeys + key.toUpperCase();
          const hintState = refreshHints(tabHints, pressedHintKeys);
          if (hintState.matched) {
            display.onHit?.(hintState.matched);
            pressedHintKeys = "";
            self.hidePopup();
          } else if (hintState.candidates === 0) {
            pressedHintKeys = "";
            self.hidePopup();
          }
        } else {
          showElement(omnibarElement, () => {
            omnibarElement.onShow({ type: "Tabs" });
          });
        }

        event.sk_stopPropagation = true;
      }
    }
  });

  let state: State;
  class State {
    enter: () => void;
    nextState: () => void;
    constructor(pointerEvents: string, frameHeight: string, onEnter?: () => void) {
      this.enter = () => {
        onEnter && onEnter();
        state = this;
        top!.postMessage(
          {
            surfingkeysUiHostData: {
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
        const acceptsPointerEvents = visibleDivs.map(
          (d: HTMLElement & { noPointerEvents?: boolean }) => {
            const id = d.id;
            const divNoPointerEvents = ["sk_keystroke", "sk_banner"];
            if (divNoPointerEvents.includes(id)) {
              return false;
            } else if (id === "sk_status") {
              return self.statusBar.querySelector("input") !== null;
            } else {
              return !d.noPointerEvents;
            }
          },
        );
        const pointerEvents2 = acceptsPointerEvents.some(Boolean);

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
  state = stateInvisible;

  function flush(): void {
    state.nextState();
  }
  function visualCommand(args: { action: string; query?: string | undefined }): void {
    if (usageElement.style.display !== "none") {
      // Only the in-frame find dispatches here, so the three find actions are exhaustive.
      switch (args.action) {
        case "visualClear": {
          visual.visualClear();
          break;
        }
        case "visualUpdate": {
          visual.visualUpdate(args.query ?? "");
          break;
        }
        case "visualEnter": {
          visual.visualEnter(args.query ?? "");
          break;
        }
      }
    } else {
      self.contentCommand(args);
    }
  }

  const omnibarElement = requireElement<OmnibarElement>("#sk_omnibar");
  const usageElement = requireElement("#sk_usage");
  const popup = requireElement("#sk_popup");
  const tabsElement = requireElement("#sk_tabs");
  const banner = requireElement("#sk_banner");
  const bubble = requireElement<BubbleElement>("#sk_bubble");
  const bubbleContent = requireElement("#sk_bubble div.sk_bubble_content");
  const bubbleArrow = requireElement("#sk_bubble div.sk_arrow");
  const sk_bubbleClassList = bubbleContent.classList;
  const [bubbleHtml, setBubbleHtml] = createSignal("");
  render(
    () =>
      BubbleView({
        get html() {
          return bubbleHtml();
        },
      }),
    bubbleContent,
  );
  function clearScrollerIndicator() {
    sk_bubbleClassList.remove("sk_scroller_indicator_top");
    sk_bubbleClassList.remove("sk_scroller_indicator_middle");
    sk_bubbleClassList.remove("sk_scroller_indicator_bottom");
  }
  bubbleContent.onscroll = () => {
    clearScrollerIndicator();
    if (bubbleContent.scrollTop === 0) {
      sk_bubbleClassList.add("sk_scroller_indicator_top");
    } else if (bubbleContent.scrollTop + bubbleContent.offsetHeight >= bubbleContent.scrollHeight) {
      sk_bubbleClassList.add("sk_scroller_indicator_bottom");
    } else {
      sk_bubbleClassList.add("sk_scroller_indicator_middle");
    }
  };
  const keystroke = requireElement("#sk_keystroke");
  const [keystrokeText, setKeystrokeText] = createSignal("");
  const [keystrokeHtml, setKeystrokeHtml] = createSignal("");
  const [keystrokeRich, setKeystrokeRich] = createSignal(false);
  render(
    () =>
      KeystrokeView({
        get text() {
          return keystrokeText();
        },
        get html() {
          return keystrokeHtml();
        },
        get rich() {
          return keystrokeRich();
        },
      }),
    keystroke,
  );

  function startInputGuard(): void {}
  function hidePopup(): void {
    if (display && display.style.display !== "none") {
      display.style.display = "none";
      self.flush();
      display.onHide && display.onHide();
      mode.exit();
    }
  }
  actions["hidePopup"] = hidePopup;

  function setDisplay(td: DisplayElement, render?: () => void) {
    if (display && display.style.display !== "none") {
      display.style.display = "none";
      display.onHide && display.onHide();
    }
    display = td;
    display.style.display = "";
    render && render();
    self.startInputGuard();
  }

  function showElement(
    td: DisplayElement,
    render?: () => void,
    onHit?: (matched: unknown) => void,
  ) {
    mode.enter(0, true);
    td.onHit = onHit;
    setDisplay(td, render);
    self.flush();
  }

  const [tabsState, setTabsState] = createSignal<{
    tabs: TabsTab[];
    hintLabels: string[];
    vertical: boolean;
    unitWidth: number;
  }>({ tabs: [], hintLabels: [], vertical: false, unitWidth: 0 });
  render(
    () =>
      TabsView({
        get tabs() {
          return tabsState().tabs;
        },
        get hintLabels() {
          return tabsState().hintLabels;
        },
        get vertical() {
          return tabsState().vertical;
        },
        get unitWidth() {
          return tabsState().unitWidth;
        },
        attachFavicon: attachFaviconToImgSrc,
      }),
    tabsElement,
  );

  function renderTabs(tabs: TabsTab[]) {
    const verticalTabs = runtime.conf.verticalTabs;
    // The inline fallback below depends on the rendered height, so it relies on Solid rendering
    // synchronously when the signal is set.
    tabsElement.className = verticalTabs ? "vertical" : "horizontal";
    setTabsState({
      tabs,
      hintLabels: hints.genLabels(tabs.length - 1),
      vertical: verticalTabs,
      unitWidth: window.innerWidth / tabs.length - 2,
    });
    if (tabsElement.getBoundingClientRect().height > self.topSize[1]) {
      tabsElement.className = "inline";
    }
  }
  function chooseTab(): void {
    const tabsThreshold = Math.min(runtime.conf.tabsThreshold, Math.ceil(window.innerWidth / 26));
    RUNTIME(
      "getTabs",
      { queryInfo: { currentWindow: true }, tabsThreshold },
      (response: { tabs: TabsTab[] }) => {
        if (response.tabs.length > tabsThreshold) {
          showElement(omnibarElement, () => {
            omnibarElement.onShow({ type: "Tabs" });
          });
        } else if (response.tabs.length > 0) {
          showElement(
            tabsElement,
            () => {
              renderTabs(response.tabs);
            },
            (matched) => {
              if (
                matched &&
                typeof matched === "object" &&
                "windowId" in matched &&
                "id" in matched
              ) {
                RUNTIME("focusTab", {
                  windowId: matched.windowId,
                  tabId: matched.id,
                });
              }
            },
          );
        }
      },
    );
  }
  actions["chooseTab"] = chooseTab;

  // The annotation is either a plain string or a [format, ...args] tuple localizeAnnotation expands.
  type UsageMeta = {
    word: string;
    group?: string | undefined;
    annotation?: string | string[] | undefined;
  };

  function localizeAnnotation(
    locale: (s: string) => string,
    annotation: string | string[] | undefined,
  ): string {
    if (Array.isArray(annotation)) {
      const [fmt, ...args] = annotation;
      return format(locale(fmt ?? ""), ...args);
    }
    return locale(annotation ?? "");
  }

  function buildUsage(
    metas: UsageMeta[],
    cb: (result: { groups: string[]; moreHelp: string }) => void,
  ) {
    initL10n((locale) => {
      const itemsByGroup = new Map<FeatureGroup, string[]>();
      const addItem = (group: FeatureGroup, item: string): void => {
        const items = itemsByGroup.get(group);
        if (items != null) {
          items.push(item);
        } else {
          itemsByGroup.set(group, [item]);
        }
      };

      const toggleKey = specialKeys["<Alt-s>"]?.at(-1);
      if (toggleKey != null) {
        addItem(
          "help",
          `<div><span class=kbd-span><kbd>${htmlEncode(toggleKey)}</kbd></span><span class=annotation>${locale("Toggle SurfingKeys on current site")}</span></div>`,
        );
      }

      metas = metas.concat(getAnnotations(omnibar.mappings));
      metas.forEach((meta) => {
        const w = KeyboardUtils.decodeKeystroke(meta.word);
        const annotation = localizeAnnotation(locale, meta.annotation);
        const item = `<div><span class=kbd-span><kbd>${htmlEncode(w)}</kbd></span><span class=annotation>${annotation}</span></div>`;
        // The metas arrive over the message boundary, so a key naming no section is dropped rather
        // than given a heading of its own.
        if (isFeatureGroup(meta.group)) {
          addItem(meta.group, item);
        }
      });
      // <Usage> wraps each of these in its own <div> and renders the footer link itself.
      const groups = featureGroups
        .map(({ key, title }) => {
          const items = itemsByGroup.get(key);
          return items == null
            ? ""
            : `<div class=feature_name><span>${locale(title)}</span></div>${items.join("")}`;
        })
        .filter((s) => s.length);
      cb({ groups, moreHelp: locale("More help") });
    });
  }

  const [usage, setUsage] = createSignal<{ groups: string[]; moreHelp: string }>({
    groups: [],
    moreHelp: "",
  });
  render(
    () =>
      UsageView({
        get groups() {
          return usage().groups;
        },
        get moreHelp() {
          return usage().moreHelp;
        },
      }),
    usageElement,
  );
  const usageMetaSchema = v.object({
    word: v.string(),
    group: v.optional(v.string()),
    annotation: v.optional(v.union([v.string(), v.array(v.string())])),
  });
  actions["showUsage"] = (message: unknown) => {
    const { metas } = v.parse(v.object({ metas: v.array(usageMetaSchema) }), message);
    showElement(usageElement, () => {
      buildUsage(metas, setUsage);
    });
  };
  actions["applyUserSettings"] = (message: { userSettings: Record<string, unknown> }) => {
    const conf: Record<string, unknown> = runtime.conf;
    for (const k in message.userSettings) {
      if (Object.hasOwn(runtime.conf, k)) {
        conf[k] = message.userSettings[k];
      }
    }
    const theme = message.userSettings["theme"];
    if (typeof theme === "string") {
      setSanitizedContent(requireElement("#sk_theme"), theme);
    }
  };
  actions["setHintsCharacters"] = (message: unknown) => {
    const { characters } = v.parse(v.object({ characters: v.string() }), message);
    hints.setCharacters(characters);
  };
  actions["addMapkey"] = (message: unknown) => {
    const { oldKeystroke, newKeystroke, mode } = v.parse(
      v.object({
        oldKeystroke: v.string(),
        newKeystroke: v.string(),
        mode: v.optional(v.string()),
      }),
      message,
    );
    const specialKey = specialKeys[oldKeystroke];
    if (specialKey != null) {
      specialKey.push(newKeystroke);
    } else if (mode != null && Object.hasOwn(modes, mode)) {
      const targetMode = modes[mode];
      if (targetMode != null) {
        mapInMode(targetMode, { newKeystroke, oldKeystroke }, isInUIFrame());
      }
    }
  };
  actions["removeMapkey"] = (message: unknown) => {
    const { keystroke, mode } = v.parse(
      v.object({
        keystroke: v.string(),
        mode: v.string(),
      }),
      message,
    );
    if (!Object.hasOwn(modes, mode)) {
      return;
    }
    modes[mode]?.mappings.remove(KeyboardUtils.encodeKeystroke(keystroke));
  };
  actions["addCommand"] = (message: { name: string; description: string }) => {
    // User command callback: forwards whatever arguments the user-defined command was invoked with.
    // eslint-disable-next-line typescript/no-explicit-any
    const proxyAction = (...args: any[]) => {
      self.contentCommand({
        action: "executeUserCommand",
        name: message.name,
        args: args,
      });
    };
    omnibarCommand(message.name, message.description, proxyAction);
  };
  actions["getUsage"] = (message: unknown) => {
    // The ack flag the dispatcher may attach is irrelevant here; only metas and the correlation id
    // are read, so validate just those and let the schema drop the rest.
    const { metas, id } = v.parse(
      v.object({ metas: v.array(usageMetaSchema), id: v.unknown() }),
      message,
    );
    buildUsage(metas, ({ groups, moreHelp }) => {
      // Content wants the help as one HTML string, so the wrappers <Usage> renders are reassembled
      // here and must stay in sync with it.
      const usageHtml =
        groups.map((g) => `<div>${g}</div>`).join("") +
        `<p style='float:right; width:100%; text-align:right'><a href='https://github.com/brookhong/surfingkeys' target='_blank' style='color:#0095dd'>${moreHelp}</a></p>`;
      top!.postMessage(
        {
          surfingkeysUiHostData: {
            data: usageHtml,
            toContent: true,
            id: id,
          },
        },
        self.topOrigin,
      );
    });
  };

  const [popupHtml, setPopupHtml] = createSignal("");
  render(
    () =>
      PopupView({
        get html() {
          return popupHtml();
        },
      }),
    popup,
  );

  function showPopup(content: string) {
    setPopupHtml(content);
    showElement(popup);
  }

  actions["showPopup"] = (message: { content: string }) => {
    showPopup(message.content);
  };

  actions["showDialog"] = (message: { question: string }) => {
    showElement(
      popup,
      () => {
        const hintLabels = hints.genLabels(2);
        // setPopupHtml renders synchronously, so the tab-hint nodes exist for the query below.
        setPopupHtml(
          `<div>${message.question}</div><div><div class=sk_tab_hint>${hintLabels[0]}</div><span class=sk_tab_group_title>Ok</span><div class=sk_tab_hint>${hintLabels[1]}</div><span class=sk_tab_group_title>Cancel</span></div>`,
        );
        const [okHint, cancelHint] = popup.querySelectorAll<HTMLElement>("div.sk_tab_hint");
        popup.style.textAlign = "center";
        if (okHint && cancelHint) {
          hintLink.set(okHint, "Ok");
          hintLabel.set(okHint, hintLabels[0] ?? "");
          hintLink.set(cancelHint, "Cancel");
          hintLabel.set(cancelHint, hintLabels[1] ?? "");
        }
      },
      (matched) => {
        self.contentCommand({
          action: "dialogResponse",
          result: matched,
        });
      },
    );
  };

  function openOmnibar(message: { style?: string } & Record<string, unknown>): void {
    showElement(omnibarElement, () => {
      omnibarElement.onShow(message);
      const style = message.style || "";
      setSanitizedContent(requireElement("#sk_omnibar style"), `#sk_omnibar {${style}}`);
    });
  }
  actions["openOmnibar"] = openOmnibar;
  actions["openFinder"] = () => {
    Find.open();
  };

  const [bannerText, setBannerText] = createSignal("");
  render(
    () =>
      BannerView({
        get text() {
          return bannerText();
        },
      }),
    banner,
  );

  function showBanner(content: string, lingerTime?: number) {
    setBannerText(content);
    banner.style.cssText = "";
    banner.style.display = "";
    banner.style.top = "0px";
    self.flush();

    const timems = lingerTime || 1600;
    setTimeout(() => {
      setBannerText("");
      banner.style.cssText = "";
      banner.style.display = "none";
      self.flush();
    }, timems);
  }
  actions["showBanner"] = (message: unknown) => {
    const { content, lingerTime } = v.parse(
      v.object({ content: v.string(), lingerTime: v.optional(v.number()) }),
      message,
    );
    showBanner(content, lingerTime);
  };
  actions["showBubble"] = (message: {
    position: {
      left: number;
      top: number;
      winX: number;
      winY: number;
      winWidth: number;
      winHeight: number;
      width: number;
      height: number;
    };
    content: string;
    noPointerEvents?: boolean;
  }) => {
    const pos = message.position;
    pos.left += pos.winX;
    pos.top += pos.winY;
    // set position to (0, 0) to leave enough space for content.
    bubble.style.top = "0px";
    bubble.style.left = "0px";
    setBubbleHtml(message.content);
    bubbleContent.style.maxWidth = pos.winWidth - 32 + "px";
    bubbleContent.scrollTop = 0;
    clearScrollerIndicator();
    bubble.style.display = "";
    const w = bubble.offsetWidth;
    let h = bubble.offsetHeight;
    const left: [number, number] = [pos.left - 11 - w / 2, w / 2];
    if (left[0] < pos.winX) {
      left[1] += left[0] - pos.winX;
      left[0] = pos.winX;
    } else if (left[0] + w > pos.winWidth) {
      left[1] += left[0] - pos.winX - pos.winWidth + w;
      left[0] = pos.winX + pos.winWidth - w;
    }
    bubbleArrow.style.left = left[1] + pos.width / 2 - 2 + "px";
    bubble.style.left = left[0] + "px";
    bubble.noPointerEvents = message.noPointerEvents;

    if (pos.top + pos.height / 2 > pos.winHeight / 2) {
      bubbleArrow.setAttribute("dir", "down");
      bubbleArrow.style.top = "100%";
      bubbleContent.style.maxHeight = pos.top - 12 - 32 + "px";
      h = bubble.offsetHeight;
      bubble.style.top = pos.top - h - 12 + "px";
    } else {
      bubbleArrow.setAttribute("dir", "up");
      bubbleArrow.style.top = "-12px";
      bubbleContent.style.maxHeight = pos.winHeight - (pos.top + pos.height + 12) - 32 + "px";
      h = bubble.offsetHeight;
      bubble.style.top = pos.top + pos.height + 12 + "px";
    }
    if (bubbleContent.scrollHeight > bubbleContent.offsetHeight) {
      bubble.noPointerEvents = false;
      sk_bubbleClassList.add("sk_scroller_indicator_top");
    }
    self.flush();
    if (!bubble.noPointerEvents) {
      setDisplay(bubble);
      mode.enter(0, true);
    }
  };

  actions["hideBubble"] = () => {
    bubble.style.display = "none";
    self.flush();
  };

  actions["visualUpdated"] = () => {
    self.statusBar.querySelector("input")?.focus();
  };

  actions["showStatus"] = (message: unknown) => {
    const statusCell = v.union([v.string(), v.object({ html: v.string() })]);
    const { contents, duration } = v.parse(
      v.object({
        contents: v.array(v.nullish(statusCell)),
        duration: v.optional(v.number()),
      }),
      message,
    );
    StatusBar.show(contents, duration);
  };

  initSKFunctionListener("front", {
    showPopup,
    showBanner,
    openFinder: () => {
      Find.open();
    },
    showStatus: (contents: (StatusCell | null | undefined)[], duration?: number) => {
      StatusBar.show(contents, duration);
    },
  });

  function toggleStatus(visible: boolean): void {
    self.statusBar.style.display = visible ? "" : "none";
  }
  actions["toggleStatus"] = (message: { visible: boolean }) => {
    self.toggleStatus(message.visible);
  };

  let pendingHint: ReturnType<typeof setTimeout> | undefined;
  function clearPendingHint() {
    if (pendingHint) {
      clearTimeout(pendingHint);
      pendingHint = undefined;
    }
  }

  actions["hideKeystroke"] = () => {
    if (keystroke.style.display !== "none") {
      setKeystrokeRich(false);
      setKeystrokeText("");
      setKeystrokeHtml("");
      keystroke.style.display = "none";
      self.flush();
    }
    if (runtime.conf.richHintsForKeystroke > 0 && runtime.conf.richHintsForKeystroke < 10_000) {
      clearPendingHint();
    }
  };

  type KeyHints = {
    key: string;
    accumulated: string;
    candidates: Record<string, { annotation: string | string[] | undefined }>;
  };

  function showRichHints(keyHints: KeyHints) {
    initL10n((locale) => {
      const candidates = keyHints.candidates;
      const words = Object.keys(candidates)
        .toSorted()
        .map((w) => {
          const candidate = candidates[w];
          if (candidate == null) {
            return "";
          }
          const annotation = localizeAnnotation(locale, candidate.annotation);
          if (annotation) {
            const nextKey = w.slice(keyHints.accumulated.length);
            return `<div><span class=kbd-span><kbd>${htmlEncode(KeyboardUtils.decodeKeystroke(keyHints.accumulated))}<span class=candidates>${htmlEncode(KeyboardUtils.decodeKeystroke(nextKey))}</span></kbd></span><span class=annotation>${annotation}</span></div>`;
          } else {
            return "";
          }
        })
        .join("");
      if (words.length > 0 && pendingHint) {
        setKeystrokeHtml(words);
        setKeystrokeRich(true);
        self.flush();
      }
    });
  }
  actions["showKeystroke"] = (message: { keyHints: KeyHints }) => {
    if (keystroke.style.display !== "none" && keystrokeRich()) {
      showRichHints(message.keyHints);
    } else {
      clearPendingHint();
      keystroke.style.display = "";
      self.flush();
      const keys = keystrokeText() + KeyboardUtils.decodeKeystroke(message.keyHints.key);
      setKeystrokeText(keys);

      if (runtime.conf.richHintsForKeystroke > 0 && runtime.conf.richHintsForKeystroke < 10_000) {
        pendingHint = setTimeout(() => {
          showRichHints(message.keyHints);
        }, runtime.conf.richHintsForKeystroke);
      }
    }
  };

  actions["initFrontend"] = (message: { origin: string; winSize: [number, number] }) => {
    self.topOrigin = message.origin;
    self.topSize = message.winSize;
    return Date.now();
  };
  actions["destroyFrontend"] = () => {
    if (display && display.style.display !== "none") {
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
      const parsed = v.safeParse(frontendMessageEnvelopeSchema, event.data);
      if (!parsed.success) {
        return;
      }
      const message = parsed.output.surfingkeysFrontendData;
      const id = message.id;
      const f = id == null ? undefined : callbacks[id];
      if (f) {
        // returns true to make callback stay for coming response.
        if (!f(message) && id != null) {
          delete callbacks[id];
        }
      } else if (message.action && Object.hasOwn(actions, message.action)) {
        const action = actions[message.action];
        const ret = action ? action(message) : undefined;
        if (message.ack) {
          top!.postMessage(
            {
              surfingkeysUiHostData: {
                data: ret,
                action: message.action + "Ack",
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
    if (bubble.style.display !== "none") {
      self.contentCommand({
        action: "updateInlineQuery",
      });
    }
  }

  document.onmouseup = (e) => {
    if (!(e.target instanceof Node) || !bubble.contains(e.target)) {
      bubble.style.display = "none";
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

  bubbleContent.addEventListener(
    "mousewheel",
    (evt: Event) => {
      // "mousewheel" is not in the typed event map, so the listener is seen as a bare Event.
      if (!(evt instanceof WheelEvent)) {
        return;
      }
      if (
        (evt.deltaY > 0 &&
          bubbleContent.scrollTop + bubbleContent.offsetHeight >= bubbleContent.scrollHeight) ||
        (evt.deltaY < 0 && bubbleContent.scrollTop <= 0)
      ) {
        evt.preventDefault();
      }
    },
    { passive: false },
  );

  return self;
})();

/** The status bar displays the status of Surfingkeys current mode: Normal, visual, etc. */
const StatusBar = (() => {
  let timerHide: ReturnType<typeof setTimeout> | null = null;
  const ui = Front.statusBar;

  // mode: 0, search: 1, searchResult: 2
  const [cells, setCells] = createSignal<StatusCell[]>(["", "", ""]);
  // No JSX in this file, so the component is invoked through a getter prop, which is what keeps
  // `cells` reactive.
  render(
    () =>
      StatusBarView({
        get cells() {
          return cells();
        },
      }),
    ui,
  );

  const show = (contents: (StatusCell | null | undefined)[], duration?: number): void => {
    if (timerHide) {
      clearTimeout(timerHide);
      timerHide = null;
    }
    // An undefined entry leaves that cell untouched, and a shorter array leaves the trailing cells.
    const next = cells().slice();
    for (let i = 0; i < contents.length; i++) {
      const cell = contents[i];
      if (cell != null) {
        next[i] = cell;
      }
    }
    setCells(next);
    ui.style.display = next.some((c) => c) ? "block" : "none";
    Front.flush();
    if (duration) {
      timerHide = setTimeout(() => {
        show(["", "", "", ""]);
      }, duration);
    }
  };
  return { show };
})();

const Find = (() => {
  const mode = new ModeHandle("Find", "/");

  mode
    .addEventListener("keydown", (event) => {
      event.sk_suppressed = true;
    })
    .addEventListener("mousedown", (event) => {
      if (event.target !== input) {
        reset();
      }
      event.sk_suppressed = true;
    });

  let input: HTMLInputElement | null = null;
  let historyInc = 0;
  let userInput = "";
  function reset() {
    input = null;
    StatusBar.show(["", ""]);
    mode.exit();
  }

  const open = () => {
    StatusBar.show(["/", { html: '<input id="sk_find" class="sk_theme"/>' }]);
    const inputEl: HTMLInputElement | null = Front.statusBar.querySelector("input");
    input = inputEl;
    if (inputEl == null) {
      return;
    }
    inputEl.oninput = () => {
      if (inputEl.value.length && inputEl.value !== ".") {
        Front.visualCommand({
          action: "visualUpdate",
          query: inputEl.value,
        });
        // Finding in the usage popup moves focus and selection elsewhere; bring them back.
        inputEl.focus();
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      }
    };
    let findHistory: string[] = [];
    RUNTIME(
      "getSettings",
      {
        key: "findHistory",
      },
      (response: { settings: { findHistory: string[] } }) => {
        userInput = "";
        findHistory = response.settings.findHistory;
        historyInc = findHistory.length;
      },
    );
    inputEl.onkeydown = (event) => {
      if (isSpecialKeyOf("<Esc>", event.sk_keyName ?? "")) {
        reset();
        Front.visualCommand({
          action: "visualClear",
        });
      } else if (event.keyCode === KeyboardUtils.keyCodes["enter"]) {
        let query = inputEl.value;
        if (query.length && query !== ".") {
          if (event.ctrlKey) {
            query = String.raw`\b` + query + String.raw`\b`;
          }
          reset();
          RUNTIME("updateInputHistory", { find: query });
          Front.visualCommand({
            action: "visualEnter",
            query: query,
          });
        }
      } else if (
        event.keyCode === KeyboardUtils.keyCodes["upArrow"] ||
        event.keyCode === KeyboardUtils.keyCodes["downArrow"]
      ) {
        if (findHistory.length) {
          const [rotated, nextInc] = rotateInput(
            findHistory,
            event.keyCode === KeyboardUtils.keyCodes["downArrow"],
            historyInc,
            userInput,
          );
          // rotateInput only yields undefined for an out-of-range index, which the length guard
          // above rules out; the fallback just avoids rendering "undefined".
          inputEl.value = rotated ?? inputEl.value;
          historyInc = nextInc;
          Front.visualCommand({
            action: "visualUpdate",
            query: inputEl.value,
          });
          event.preventDefault();
        }
      } else {
        userInput = inputEl.value;
        historyInc = findHistory.length;
      }
    };
    inputEl.focus();
    Front.startInputGuard();
    mode.enter();
  };
  return { open };
})();

export default Front;
