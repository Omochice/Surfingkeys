import { createSignal } from "solid-js";
import { render } from "solid-js/web";

import createAPI from "../common/api";
import createDefaultMappings from "../common/default";
import KeyboardUtils from "../common/keyboardUtils";
import Mode from "../common/mode";
import createModeGraph, { type ModeContext } from "../common/modeGraph";
import { RUNTIME, runtime } from "../common/runtime";
import {
  attachFaviconToImgSrc,
  format,
  generateQuickGuid,
  getAnnotations,
  getWordUnderCursor,
  hintLabel,
  hintLink,
  htmlEncode,
  initL10n,
  initSKFunctionListener,
  refreshHints,
  requireElement,
  rotateInput,
  setSanitizedContent,
  mapInMode,
} from "../common/utils";
import createCommands from "./command";
import { Banner as BannerView } from "./components/Banner";
import { Bubble as BubbleView } from "./components/Bubble";
import { Keystroke as KeystrokeView } from "./components/Keystroke";
import { Popup as PopupView } from "./components/Popup";
import { StatusBar as StatusBarView } from "./components/StatusBar";
import type { StatusCell } from "./components/StatusBar";
import { Tabs as TabsView } from "./components/Tabs";
import { Usage as UsageView } from "./components/Usage";
import createOmnibar from "./omnibar";

const Front = (() => {
  Mode.init();
  const { clipboard, insert, normal, hints, visual } = createModeGraph();

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

  const ctx: ModeContext = { clipboard, insert, normal, hints, visual, front: self };
  const api = createAPI(ctx);
  createDefaultMappings(api, ctx);

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
        if (event.keyCode === KeyboardUtils.keyCodes["backspace"]) {
          if (pressedHintKeys.length > 0) {
            pressedHintKeys = pressedHintKeys.substring(0, pressedHintKeys.length - 1);
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
  const _usage = requireElement("#sk_usage");
  const _popup = requireElement("#sk_popup");
  const _tabs = requireElement("#sk_tabs");
  const _banner = requireElement("#sk_banner");
  const _bubble: any = document.getElementById("sk_bubble");
  const sk_bubble_content: any = _bubble.querySelector("div.sk_bubble_content");
  const sk_bubble_arrow = _bubble.querySelector("div.sk_arrow") as HTMLElement;
  const sk_bubbleClassList = sk_bubble_content.classList;
  const [bubbleHtml, setBubbleHtml] = createSignal("");
  render(
    () =>
      BubbleView({
        get html() {
          return bubbleHtml();
        },
      }),
    sk_bubble_content,
  );
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

  const [tabsState, setTabsState] = createSignal<{
    tabs: any[];
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
    _tabs,
  );

  function renderTabs(tabs: any[]) {
    const verticalTabs = runtime.conf.verticalTabs;
    // The container class drives the layout; the per-tab styling lives in the
    // component. The inline fallback below depends on the rendered height, so
    // it relies on Solid rendering synchronously when the signal is set.
    _tabs.className = verticalTabs ? "vertical" : "horizontal";
    setTabsState({
      tabs,
      hintLabels: hints.genLabels(tabs.length - 1),
      vertical: verticalTabs,
      unitWidth: window.innerWidth / tabs.length - 2,
    });
    if (_tabs.getBoundingClientRect().height > self.topSize[1]) {
      _tabs.className = "inline";
    }
  }
  _actions["chooseTab"] = () => {
    const tabsThreshold = Math.min(runtime.conf.tabsThreshold, Math.ceil(window.innerWidth / 26));
    RUNTIME("getTabs", { queryInfo: { currentWindow: true }, tabsThreshold }, (response: any) => {
      if (response.tabs.length > tabsThreshold) {
        showElement(_omnibar, () => {
          _omnibar.onShow({ type: "Tabs" });
        });
      } else if (response.tabs.length > 0) {
        showElement(
          _tabs,
          () => {
            renderTabs(response.tabs);
          },
          (matched) => {
            RUNTIME("focusTab", {
              windowId: matched.windowId,
              tabId: matched.id,
            });
          },
        );
      }
    });
  };
  self.chooseTab = _actions["chooseTab"];

  function localizeAnnotation(locale: (s: string) => string, annotation: any) {
    if (annotation.constructor.name === "Array") {
      const fmt = annotation[0];
      return format(locale(fmt), ...annotation.slice(1));
    } else {
      return locale(annotation);
    }
  }

  function buildUsage(metas: any[], cb: (result: { groups: string[]; moreHelp: string }) => void) {
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
      "Misc", // 13
      "Insert Mode", // 14
      "Lurk Mode", // 15
      "Regional Hints Mode", // 16
    ];

    initL10n((locale) => {
      const help_groups: string[][] = feature_groups.map(() => []);
      const altSKeys = Mode.specialKeys["<Alt-s>"];
      const lh = altSKeys?.length ?? 0;
      const firstGroup = help_groups[0];
      if (lh > 0 && altSKeys != null && firstGroup != null) {
        const last = altSKeys[lh - 1];
        if (last != null) {
          firstGroup.push(
            format(
              "<div><span class=kbd-span><kbd>{0}</kbd></span><span class=annotation>{1}</span></div>",
              htmlEncode(last),
              locale("Toggle SurfingKeys on current site"),
            ),
          );
        }
      }

      metas = metas.concat(getAnnotations(omnibar.mappings));
      metas.forEach((meta) => {
        const w = KeyboardUtils.decodeKeystroke(meta.word);
        const annotation = localizeAnnotation(locale, meta.annotation);
        const item = `<div><span class=kbd-span><kbd>${htmlEncode(w)}</kbd></span><span class=annotation>${annotation}</span></div>`;
        const group = meta.feature_group != null ? help_groups[meta.feature_group] : undefined;
        if (group != null) {
          group.push(item);
        }
      });
      // Each non-empty group becomes one <div> child of #sk_usage (the
      // <Usage> component wraps the string below in that div); the footer
      // link is rendered by the component, so only the localized text is
      // returned here.
      const groups = help_groups
        .map((g, i) =>
          g.length
            ? format(
                "<div class=feature_name><span>{0}</span></div>{1}",
                locale(feature_groups[i] ?? ""),
                g.join(""),
              )
            : "",
        )
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
    _usage,
  );
  _actions["showUsage"] = (message: any) => {
    showElement(_usage, () => {
      buildUsage(message.metas, setUsage);
    });
  };
  _actions["applyUserSettings"] = (message: any) => {
    const conf = runtime.conf as Record<string, any>;
    for (const k in message.userSettings) {
      if (Object.hasOwn(runtime.conf, k)) {
        conf[k] = message.userSettings[k];
      }
    }
    if ("theme" in message.userSettings) {
      setSanitizedContent(requireElement("#sk_theme"), message.userSettings.theme);
    }
  };
  _actions["setHintsCharacters"] = (message: any) => {
    hints.setCharacters(message.characters);
  };
  _actions["addMapkey"] = (message: any) => {
    const specialKey = Mode.specialKeys[message.old_keystroke];
    if (specialKey != null) {
      specialKey.push(message.new_keystroke);
    } else if (Object.hasOwn(modes, message.mode)) {
      const mode = modes[message.mode];
      if (mode != null) {
        mapInMode(mode, message.new_keystroke, message.old_keystroke);
      }
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
    buildUsage(message.metas, ({ groups, moreHelp }) => {
      // Content gets the help as one HTML string; reassemble the per-group
      // <div> wrappers and the footer link (kept in sync with <Usage>).
      const usageHtml =
        groups.map((g) => `<div>${g}</div>`).join("") +
        `<p style='float:right; width:100%; text-align:right'><a href='https://github.com/brookhong/surfingkeys' target='_blank' style='color:#0095dd'>${moreHelp}</a></p>`;
      top!.postMessage(
        {
          surfingkeys_uihost_data: {
            data: usageHtml,
            toContent: true,
            id: message.id,
          },
        },
        self.topOrigin,
      );
    });
  };

  self.showUsage = self.hidePopup;

  const [popupHtml, setPopupHtml] = createSignal("");
  render(
    () =>
      PopupView({
        get html() {
          return popupHtml();
        },
      }),
    _popup,
  );

  function showPopup(content: string) {
    setPopupHtml(content);
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
        // setPopupHtml renders synchronously, so the tab-hint nodes exist
        // for the expando query below, matching the legacy ordering.
        setPopupHtml(
          `<div>${message.question}</div><div><div class=sk_tab_hint>${hintLabels[0]}</div><span class=sk_tab_group_title>Ok</span><div class=sk_tab_hint>${hintLabels[1]}</div><span class=sk_tab_group_title>Cancel</span></div>`,
        );
        const tabHints: any = _popup.querySelectorAll("div.sk_tab_hint");
        _popup.style.textAlign = "center";
        hintLink.set(tabHints[0], "Ok");
        hintLabel.set(tabHints[0], hintLabels[0] ?? "");
        hintLink.set(tabHints[1], "Cancel");
        hintLabel.set(tabHints[1], hintLabels[1] ?? "");
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

  const [bannerText, setBannerText] = createSignal("");
  render(
    () =>
      BannerView({
        get text() {
          return bannerText();
        },
      }),
    _banner,
  );

  function showBanner(content: string, linger_time?: number) {
    setBannerText(content);
    _banner.style.cssText = "";
    _banner.style.display = "";
    _banner.style.top = "0px";
    self.flush();

    const timems = linger_time || 1600;
    setTimeout(() => {
      setBannerText("");
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
    setBubbleHtml(message.content);
    sk_bubble_content.style.maxWidth = pos.winWidth - 32 + "px";
    sk_bubble_content.scrollTop = 0;
    clearScrollerIndicator();
    _bubble.style.display = "";
    const w = _bubble.offsetWidth;
    let h = _bubble.offsetHeight;
    const left: [number, number] = [pos.left - 11 - w / 2, w / 2];
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
      sk_bubble_content.style.maxHeight = pos.winHeight - (pos.top + pos.height + 12) - 32 + "px";
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
      setKeystrokeRich(false);
      setKeystrokeText("");
      setKeystrokeHtml("");
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
            const nextKey = w.substring(keyHints.accumulated.length);
            return `<div><span class=kbd-span><kbd>${htmlEncode(KeyboardUtils.decodeKeystroke(keyHints.accumulated))}<span class=candidates>${htmlEncode(KeyboardUtils.decodeKeystroke(nextKey))}</span></kbd></span><span class=annotation>${annotation}</span></div>`;
          } else {
            return "";
          }
        })
        .join("");
      if (words.length > 0 && _pendingHint) {
        setKeystrokeHtml(words);
        setKeystrokeRich(true);
        self.flush();
      }
    });
  }
  _actions["showKeystroke"] = (message: any) => {
    if (keystroke.style.display !== "none" && keystrokeRich()) {
      showRichHints(message.keyHints);
    } else {
      clearPendingHint();
      keystroke.style.display = "";
      self.flush();
      const keys = keystrokeText() + KeyboardUtils.decodeKeystroke(message.keyHints.key);
      setKeystrokeText(keys);

      if (runtime.conf.richHintsForKeystroke > 0 && runtime.conf.richHintsForKeystroke < 10000) {
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
      if (_message == null) {
        return;
      }
      const f = _callbacks[_message.id];
      if (f) {
        // returns true to make callback stay for coming response.
        if (!f(_message)) {
          delete _callbacks[_message.id];
        }
      } else if (_message.action && Object.hasOwn(_actions, _message.action)) {
        const action = _actions[_message.action];
        const ret = action ? action(_message) : undefined;
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
 * @param {Object} ui
 * @returns {StatusBar} StatusBar instance
 * @kind function
 */
const StatusBar = (() => {
  const self: any = {};
  let timerHide: ReturnType<typeof setTimeout> | null = null;
  const ui = Front.statusBar;

  // mode: 0, search: 1, searchResult: 2
  const [cells, setCells] = createSignal<StatusCell[]>(["", "", ""]);
  // frontend.ts is plain TS (no JSX), so the component is invoked through a
  // getter prop that keeps `cells` reactive across the postMessage boundary.
  render(
    () =>
      StatusBarView({
        get cells() {
          return cells();
        },
      }),
    ui,
  );

  self.show = (contents: any[], duration?: number) => {
    if (timerHide) {
      clearTimeout(timerHide);
      timerHide = null;
    }
    // An undefined entry leaves that cell untouched; a shorter array leaves
    // the trailing cells (e.g. find clears mode+search but keeps results).
    const next = cells().slice();
    for (let i = 0; i < contents.length; i++) {
      if (contents[i] != null) {
        next[i] = contents[i];
      }
    }
    setCells(next);
    ui.style.display = next.some((c) => c) ? "block" : "none";
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

  self
    .addEventListener("keydown", (event: any) => {
      // prevent this event to be handled by Surfingkeys' other listeners
      event.sk_suppressed = true;
    })
    .addEventListener("mousedown", (event: any) => {
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
   * @returns {undefined}
   * @instance
   */
  self.open = () => {
    StatusBar.show(["/", { html: '<input id="sk_find" class="sk_theme"/>' }]);
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
      } else if (event.keyCode === KeyboardUtils.keyCodes["enter"]) {
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
        event.keyCode === KeyboardUtils.keyCodes["upArrow"] ||
        event.keyCode === KeyboardUtils.keyCodes["downArrow"]
      ) {
        if (findHistory.length) {
          [input.value, historyInc] = rotateInput(
            findHistory,
            event.keyCode === KeyboardUtils.keyCodes["downArrow"],
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
