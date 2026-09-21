import * as v from "valibot";

import type { MapOptions, SurfingkeysApi } from "./api";
import { conf } from "./conf";
import type { EngineEnv } from "./engineEnv";
import { dispatchSKEvent } from "./events";
import type { FeatureGroup } from "./featureGroup";
import KeyboardUtils from "./keyboardUtils";
import type { ModeContext } from "./modeGraph";
import { repeatCount } from "./repeatCount";
import { reportError } from "./report";
import {
  getBrowserName,
  getCssSelectorsOfEditable,
  getLargeElements,
  getTextNodePos,
  getWordUnderCursor,
  htmlEncode,
  regExpReplacer,
  removeAttributes,
  setSanitizedContent,
  showBanner,
  showPopup,
  toggleQuote,
} from "./utils";

/**
 * A text-anchor hint match: the text node, the offset within it, and the matched text. An offset of
 * 0 means the whole node's data is the match; otherwise the third element holds the text.
 */
type TextAnchorMatch = [CharacterData, number, string];

/** Parse JSON, yielding `undefined` instead of throwing on malformed input. */
export const parseJsonSafe = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// Clipboard restore reads back JSON the user previously copied, so only the top-level object shape
// is constrained; individual values stay unknown and are narrowed at the use sites.
const clipboardSettingsSchema = v.record(v.string(), v.unknown());
const clipboardFormsSchema = v.record(v.string(), v.record(v.string(), v.unknown()));

/** The action bound to a single default key: its help text, handler, and per-mapping options. */
export type MappingDef = {
  /** The help section this mapping is listed under. */
  group: FeatureGroup;
  annotation: string | string[];
  // User keypress handler of arbitrary signature (same rationale as api.ts's jscode).
  // eslint-disable-next-line typescript/no-explicit-any
  code: (...args: any[]) => void;
  options?: MapOptions;
};

/** The default key map as data, keyed by mode (`nmap`/`vmap`/`imap`) then by key sequence. */
export type DefaultMappings = {
  nmap: Record<string, MappingDef>;
  vmap: Record<string, MappingDef>;
  imap: Record<string, MappingDef>;
};

type SearchSelectedWith = SurfingkeysApi["searchSelectedWith"];

/** A single default mapping tagged with the mode and key it belongs to, before being indexed. */
type ModalMappingDef = { mode: keyof DefaultMappings; keys: string; def: MappingDef };

function getTableColumnHeads(): Element[] {
  const tds: Element[] = [];
  document.querySelectorAll("table").forEach((t) => {
    const tr = t.querySelector("tr");
    if (tr) {
      tds.push(...tr.children);
    }
  });
  return tds;
}

function getFormData(
  form: HTMLFormElement,
  format?: string,
): Record<string, FormDataEntryValue | FormDataEntryValue[]> | string {
  const formData = new FormData(form);
  if (format === "json") {
    const obj: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};

    formData.forEach((value, key) => {
      if (Object.hasOwn(obj, key)) {
        // Only non-empty string values collapse a repeated field into an array; file entries are
        // skipped.
        if (typeof value === "string" && value.length) {
          const p = obj[key];
          if (Array.isArray(p)) {
            p.push(value);
          } else {
            const arr: FormDataEntryValue[] = [];
            if (typeof p === "string" && p.length) {
              arr.push(p);
            }
            arr.push(value);
            obj[key] = arr;
          }
        }
      } else {
        obj[key] = value;
      }
    });

    return obj;
  } else {
    // URLSearchParams' typings omit FormData, though it accepts it at runtime
    // by iterating entries; build it explicitly to keep that behavior typed.
    const params = new URLSearchParams();
    formData.forEach((value, key) => params.append(key, String(value)));
    return params.toString();
  }
}

function generateFormKey(form: HTMLFormElement): string {
  return (form.method || "get") + "::" + new URL(form.action).pathname;
}

function openGoogleTranslate(env: EngineEnv, searchSelectedWith: SearchSelectedWith): void {
  if (window.getSelection()!.toString()) {
    searchSelectedWith("https://translate.google.com/?hl=en#auto/en/");
  } else {
    env.tabOpenLink(
      "https://translate.google.com/translate?js=n&sl=auto&tl=zh-CN&u=" + window.location.href,
    );
  }
}

function definePreviousPage(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "[[",
    def: {
      group: "mouseClick",
      annotation: "Click on the previous link on current page",
      code: ctx.hints.previousPage,
    },
  };
}

function defineNextPage(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "]]",
    def: {
      group: "mouseClick",
      annotation: "Click on the next link on current page",
      code: ctx.hints.nextPage,
    },
  };
}

function defineChooseTab(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "T",
    def: {
      group: "tabs",
      annotation: "Choose a tab",
      code: () => {
        ctx.front.chooseTab();
      },
    },
  };
}

function defineShowUsage(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "?",
    def: {
      group: "help",
      annotation: "Show usage",
      code: () => {
        ctx.front.showUsage();
      },
    },
  };
}

function defineOpenWordTranslation(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "Q",
    def: {
      group: "omnibar",
      annotation: "Open omnibar for word translation",
      code: () => {
        // Built here rather than behind a front helper, because openOmnibar is the only member
        // both the content front and the UI iframe front implement.
        ctx.front.openOmnibar({
          type: "OmniQuery",
          extra: getWordUnderCursor(),
          style: "opacity: 0.8;",
        });
      },
    },
  };
}

function defineToggleQuotes(): ModalMappingDef {
  return {
    mode: "imap",
    keys: "<Ctrl-'>",
    def: {
      group: "insertMode",
      annotation: "Toggle quotes in an input element",
      code: toggleQuote,
    },
  };
}

function defineShowLastAction(): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";ql",
    def: {
      group: "help",
      annotation: "Show last action",
      code: () => {
        showPopup(
          htmlEncode(
            conf.lastKeys
              .map((k) => {
                return KeyboardUtils.decodeKeystroke(k);
              })
              .join(" → "),
          ),
        );
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineGoToFirstEditBox(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gi",
    def: {
      group: "mouseClick",
      annotation: "Go to the first edit box",
      code: () => {
        ctx.hints.createInputLayer();
      },
    },
  };
}

function defineGoToEditBox(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "i",
    def: {
      group: "mouseClick",
      annotation: "Go to edit box",
      code: () => {
        ctx.hints.create(getCssSelectorsOfEditable(), ctx.hints.dispatchMouseClick);
      },
    },
  };
}

function defineRegionalHints(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "L",
    def: {
      group: "mouseClick",
      annotation: "Enter regional Hints mode",
      code: () => {
        ctx.hints.create(getLargeElements(), () => {}, { regionalHints: true });
      },
    },
  };
}

function defineVisualWholeElement(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "zv",
    def: {
      group: "visualMode",
      annotation: "Enter visual mode, and select whole element",
      code: () => {
        ctx.visual.toggle("z");
      },
    },
  };
}

function defineYankElementText(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yv",
    def: {
      group: "clipboard",
      annotation: "Yank text of an element",
      code: () => {
        ctx.hints.create(conf.textAnchorPattern, (element: TextAnchorMatch) => {
          ctx.clipboard.write(element[1] === 0 ? element[0].data.trim() : element[2].trim());
        });
      },
    },
  };
}

function defineYankMultipleElementsText(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "ymv",
    def: {
      group: "clipboard",
      annotation: "Yank text of multiple elements",
      code: () => {
        const textToYank: string[] = [];
        ctx.hints.create(
          conf.textAnchorPattern,
          (element: TextAnchorMatch) => {
            textToYank.push(element[1] === 0 ? element[0].data.trim() : element[2].trim());
            ctx.clipboard.write(textToYank.join("\n"));
          },
          { multipleHits: true },
        );
      },
    },
  };
}

function defineRestoreVisualMode(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "V",
    def: {
      group: "visualMode",
      annotation: "Restore visual mode",
      code: () => {
        ctx.visual.restore();
      },
    },
  };
}

function defineFindSelectedText(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "*",
    def: {
      group: "visualMode",
      annotation: "Find selected text in current page",
      code: () => {
        ctx.visual.star();
        ctx.visual.toggle();
      },
    },
  };
}

function defineVisualBackward20Lines(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "vmap",
    keys: "<Ctrl-u>",
    def: {
      group: "visualMode",
      annotation: "Backward 20 lines",
      code: () => {
        ctx.visual.feedkeys("20k");
      },
    },
  };
}

function defineVisualForward20Lines(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "vmap",
    keys: "<Ctrl-d>",
    def: {
      group: "visualMode",
      annotation: "Forward 20 lines",
      code: () => {
        ctx.visual.feedkeys("20j");
      },
    },
  };
}

function defineAddVIMark(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "m",
    def: {
      group: "marks",
      annotation: "Add current URL to vim-like marks",
      code: ctx.normal.addVIMark,
    },
  };
}

function defineJumpVIMark(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "'",
    def: { group: "marks", annotation: "Jump to vim-like mark", code: ctx.normal.jumpVIMark },
  };
}

function defineJumpVIMarkNewTab(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "<Ctrl-'>",
    def: {
      group: "marks",
      annotation: "Jump to vim-like mark in new tab.",
      code: (mark: string) => {
        ctx.normal.jumpVIMark(mark);
      },
    },
  };
}

function defineSwitchFrames(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "w",
    def: {
      group: "scroll",
      annotation: "Switch frames",
      code: () => {
        // ui related actions are only available in iframes once the frontend is ready.
        dispatchSKEvent("ensureFrontEnd");
        if (window === top) {
          ctx.hints
            .create("iframe", (element: HTMLIFrameElement) => {
              element.scrollIntoView({
                behavior: "auto",
                block: "center",
                inline: "center",
              });
              ctx.normal.highlightElement(element);
              element.contentWindow?.focus();
            })
            .then((hintsTotal) => {
              if (hintsTotal === 0) {
                ctx.normal.rotateFrame();
              }
            });
        } else {
          ctx.normal.rotateFrame();
        }
      },
    },
  };
}

function defineCapturePage(ctx: ModeContext, env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yg",
    def: {
      group: "clipboard",
      annotation: "Capture current page",
      code: () => {
        ctx.front.toggleStatus(false);
        setTimeout(() => {
          env.request<{ dataUrl: string }>("captureVisibleTab").then((response) => {
            ctx.front.toggleStatus(true);
            showPopup(`<img src='${response.dataUrl}' />`);
          }, reportError);
        }, 500);
      },
    },
  };
}

function defineGoUpUrlPath(): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gu",
    def: {
      group: "pageNavigation",
      annotation: "Go up one path in the URL",
      code: () => {
        let pathname = location.pathname;
        if (pathname.length > 1) {
          pathname = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
          let last = pathname.lastIndexOf("/");
          let repeats = repeatCount.value;
          repeatCount.value = 1;
          while (repeats-- > 1) {
            const p = pathname.lastIndexOf("/", last - 1);
            if (p === -1) {
              break;
            } else {
              last = p;
            }
          }
          pathname = pathname.slice(0, last);
        }
        window.location.href = location.origin + pathname;
      },
    },
  };
}

function defineMouseOutLastElement(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";m",
    def: {
      group: "mouseClick",
      annotation: "mouse out last element",
      code: () => {
        ctx.hints.mouseoutLastElement();
      },
    },
  };
}

function definePasteHtml(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";pp",
    def: {
      group: "clipboard",
      annotation: "Paste html on current page",
      code: () => {
        ctx.clipboard.read((response) => {
          removeAttributes(document.documentElement);
          removeAttributes(document.body);
          setSanitizedContent(
            document.head,
            "<title>" + new Date() + " updated by Surfingkeys</title>",
          );
          setSanitizedContent(document.body, response.data);
        });
      },
    },
  };
}

function defineTranslateSelectedText(
  env: EngineEnv,
  searchSelectedWith: SearchSelectedWith,
): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";t",
    def: {
      // The only built-in that never carried a `#N`, so Misc is where the mode default already put
      // it; picking a better section is a separate decision.
      group: "misc",
      annotation: "Translate selected text with google",
      code: () => {
        if (env.surfingkeys) {
          env.surfingkeys.translateCurrentPage();
        } else {
          openGoogleTranslate(env, searchSelectedWith);
        }
      },
    },
  };
}

function defineVisualTranslateSelectedText(
  env: EngineEnv,
  searchSelectedWith: SearchSelectedWith,
): ModalMappingDef {
  return {
    mode: "vmap",
    keys: "t",
    def: {
      group: "visualMode",
      annotation: "Translate selected text with google",
      code: () => {
        openGoogleTranslate(env, searchSelectedWith);
      },
    },
  };
}

function defineOpenDetectedLinks(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "O",
    def: {
      group: "mouseClick",
      annotation: "Open detected links from text",
      code: () => {
        ctx.hints.create(
          conf.clickablePattern,
          (element: TextAnchorMatch) => {
            window.location.assign(element[2]);
          },
          { statusLine: "Open detected links from text" },
        );
      },
    },
  };
}

function defineRepeatLastAction(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ".",
    def: {
      group: "help",
      annotation: "Repeat last action",
      code: () => {
        // lastKeys in format: <keys in normal mode>[,(<mode name>\t<keys in this mode>)*], examples
        // ['se']
        // ['f', 'Hints\tBA']
        const lastKeys = conf.lastKeys;
        const firstKey = lastKeys[0];
        if (firstKey != null) {
          ctx.normal.feedkeys(firstKey);
        }
        const modeKeys = lastKeys.slice(1);
        for (let i = 0; i < modeKeys.length; i++) {
          const entry = modeKeys[i];
          if (entry == null) {
            continue;
          }
          const modeKey = entry.split("\t");
          if (modeKey[0] === "Hints") {
            const closureWrapper = () => {
              const hintKeys = modeKey[1];
              return () => {
                if (hintKeys != null) {
                  ctx.hints.feedkeys(hintKeys);
                }
              };
            };
            setTimeout(closureWrapper(), 120 + i * 100);
          }
        }
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineOpenLink(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "f",
    def: {
      group: "mouseClick",
      annotation: "Open a link, press SHIFT to flip overlapped hints, hold SPACE to hide hints",
      code: () => {
        ctx.hints.create("", ctx.hints.dispatchMouseClick);
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineToggleVisualMode(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "v",
    def: {
      group: "visualMode",
      annotation: "Toggle visual mode",
      code: () => {
        ctx.visual.toggle();
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineNextFoundText(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "n",
    def: {
      group: "visualMode",
      annotation: "Next found text",
      code: () => {
        ctx.visual.next(false);
      },
      options: { repeatIgnore: true },
    },
  };
}

function definePreviousFoundText(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "N",
    def: {
      group: "visualMode",
      annotation: "Previous found text",
      code: () => {
        ctx.visual.next(true);
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineFocusScrollableElements(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";fs",
    def: {
      group: "mouseClick",
      annotation: "Display hints to focus scrollable elements",
      code: () => {
        ctx.hints.create(ctx.normal.refreshScrollableElements(), ctx.hints.dispatchMouseClick);
      },
    },
  };
}

function defineVisualTranslateWord(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "vmap",
    keys: "q",
    def: {
      group: "visualMode",
      annotation: "Translate word under cursor",
      code: () => {
        const w = getWordUnderCursor();
        const b = ctx.visual.getCursorPixelPos();
        ctx.front.performInlineQuery?.(
          w ?? "",
          {
            top: b.top,
            left: b.left,
            height: b.height,
            width: b.width,
          },
          (pos, queryResult) => {
            dispatchSKEvent("front", ["showBubble", pos, queryResult, true]);
          },
        );
      },
    },
  };
}

function defineQueryWordWithHints(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "cq",
    def: {
      group: "clipboard",
      annotation: "Query word with Hints",
      code: () => {
        // Bail out before creating hints, so a front without the member gets a clean no-op key
        // instead of hint labels whose selection could never do anything.
        const performInlineQuery = ctx.front.performInlineQuery;
        if (performInlineQuery == null) {
          return;
        }
        ctx.hints.create(conf.textAnchorPattern, (element: TextAnchorMatch) => {
          const word = element[2].trim().replace(/[^A-z].*$/, "");
          const b = getTextNodePos(element[0], element[1], element[2].length);
          performInlineQuery(
            word,
            {
              top: b.top,
              left: b.left,
              height: b.height ?? 0,
              width: b.width ?? 0,
            },
            (pos, queryResult) => {
              dispatchSKEvent("front", ["showBubble", pos, queryResult, false]);
            },
          );
        });
      },
    },
  };
}

function defineZoomReset(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "zr",
    def: {
      group: "tabs",
      annotation: "zoom reset",
      code: () => {
        env.RUNTIME("setZoom", {
          zoomFactor: 0,
        });
      },
    },
  };
}

function defineZoomIn(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "zi",
    def: {
      group: "tabs",
      annotation: "zoom in",
      code: () => {
        env.RUNTIME("setZoom", {
          zoomFactor: 0.1,
        });
      },
    },
  };
}

function defineZoomOut(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "zo",
    def: {
      group: "tabs",
      annotation: "zoom out",
      code: () => {
        env.RUNTIME("setZoom", {
          zoomFactor: -0.1,
        });
      },
    },
  };
}

function defineSaveSessionAndQuit(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "ZZ",
    def: {
      group: "sessions",
      annotation: "Save session and quit",
      code: () => {
        env.RUNTIME("createSession", {
          name: "LAST",
          quitAfterSaved: true,
        });
      },
    },
  };
}

function defineRestoreLastSession(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "ZR",
    def: {
      group: "sessions",
      annotation: "Restore last session",
      code: () => {
        env.RUNTIME("openSession", {
          name: "LAST",
        });
      },
    },
  };
}

function defineOpenLinkActiveNewTab(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "af",
    def: {
      group: "mouseClick",
      annotation: "Open a link in active new tab",
      code: () => {
        ctx.hints.create("", ctx.hints.dispatchMouseClick, { tabbed: true, active: true });
      },
    },
  };
}

function defineOpenLinkBackgroundNewTab(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gf",
    def: {
      group: "mouseClick",
      annotation: "Open a link in non-active new tab",
      code: () => {
        ctx.hints.create("", ctx.hints.dispatchMouseClick, { tabbed: true, active: false });
      },
    },
  };
}

function defineOpenMultipleLinksNewTab(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "cf",
    def: {
      group: "mouseClick",
      annotation: "Open multiple links in a new tab",
      code: () => {
        ctx.hints.create("", ctx.hints.dispatchMouseClick, { multipleHits: true });
      },
    },
  };
}

function defineMouseOverElements(ctx: ModeContext, env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "<Ctrl-h>",
    def: {
      group: "mouseClick",
      annotation: "Mouse over elements.",
      code: () => {
        ctx.hints.create(
          "",
          (element: HTMLElement) => {
            if (env.surfingkeys) {
              const r = element.getClientRects()[0];
              if (r) {
                env.surfingkeys.sendMouseEvent(
                  2,
                  Math.round(r.x + r.width / 2),
                  Math.round(r.y + r.height / 2),
                  0,
                );
              }
            } else {
              ctx.hints.dispatchMouseClick(element);
            }
          },
          { mouseEvents: ["mouseover"] },
        );
      },
    },
  };
}

function defineMouseOutElements(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "<Ctrl-j>",
    def: {
      group: "mouseClick",
      annotation: "Mouse out elements.",
      code: () => {
        ctx.hints.create("", ctx.hints.dispatchMouseClick, { mouseEvents: ["mouseout"] });
      },
    },
  };
}

function defineCopyLinkUrl(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "ya",
    def: {
      group: "clipboard",
      annotation: "Copy a link URL to the clipboard",
      code: () => {
        ctx.hints.create("*[href]", (element: HTMLAnchorElement) => {
          ctx.clipboard.write(element.href);
        });
      },
    },
  };
}

function defineCopyMultipleLinkUrls(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yma",
    def: {
      group: "clipboard",
      annotation: "Copy multiple link URLs to the clipboard",
      code: () => {
        const linksToYank: string[] = [];
        ctx.hints.create(
          "*[href]",
          (element: HTMLAnchorElement) => {
            linksToYank.push(element.href);
            ctx.clipboard.write(linksToYank.join("\n"));
          },
          { multipleHits: true },
        );
      },
    },
  };
}

function defineCopyTableColumn(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yc",
    def: {
      group: "clipboard",
      annotation: "Copy a column of a table",
      code: () => {
        ctx.hints.create(getTableColumnHeads(), (element: HTMLTableCellElement) => {
          const table = element.closest("table");
          const tableRows = table
            ? Array.from(table.querySelectorAll<HTMLTableRowElement>("tr"))
            : [];
          const column = tableRows.map((tr) => {
            const cell = tr.children[element.cellIndex];
            return cell instanceof HTMLElement ? cell.innerText : "";
          });
          ctx.clipboard.write(column.join("\n"));
        });
      },
    },
  };
}

function defineCopyMultipleTableColumns(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "ymc",
    def: {
      group: "clipboard",
      annotation: "Copy multiple columns of a table",
      code: () => {
        let rows: string[] | null = null;
        ctx.hints.create(
          getTableColumnHeads(),
          (element: HTMLTableCellElement) => {
            const table = element.closest("table");
            const tableRows = table
              ? Array.from(table.querySelectorAll<HTMLTableRowElement>("tr"))
              : [];
            const column: string[] = tableRows.map((tr) => {
              const cell = tr.children[element.cellIndex];
              return cell instanceof HTMLElement ? cell.innerText : "";
            });
            if (!rows) {
              rows = column;
            } else {
              column.forEach((c, i) => {
                rows![i] += "\t" + c;
              });
            }
            ctx.clipboard.write(rows.join("\n"));
          },
          { multipleHits: true },
        );
      },
    },
  };
}

function defineCopyPreText(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yq",
    def: {
      group: "clipboard",
      annotation: "Copy pre text",
      code: () => {
        ctx.hints.create("pre", (element: HTMLElement) => {
          ctx.clipboard.write(element.innerText);
        });
      },
    },
  };
}

function defineClickImageOrButton(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "q",
    def: {
      group: "mouseClick",
      annotation: "Click on an Image or a button",
      code: () => {
        ctx.hints.create("img, button", ctx.hints.dispatchMouseClick);
      },
    },
  };
}

function defineTogglePinTab(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "<Alt-p>",
    def: {
      group: "tabs",
      annotation: "pin/unpin current tab",
      code: () => {
        env.RUNTIME("togglePinTab");
      },
    },
  };
}

function defineToggleMuteTab(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "<Alt-m>",
    def: {
      group: "tabs",
      annotation: "mute/unmute current tab",
      code: () => {
        env.RUNTIME("muteTab");
      },
    },
  };
}

function defineTabHistoryBack(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "B",
    def: {
      group: "pageNavigation",
      annotation: "Go one tab history back",
      code: () => {
        env.RUNTIME("historyTab", { backward: true });
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineTabHistoryForward(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "F",
    def: {
      group: "pageNavigation",
      annotation: "Go one tab history forward",
      code: () => {
        env.RUNTIME("historyTab", { backward: false });
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineGoToLastUsedTab(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "<Ctrl-6>",
    def: {
      group: "pageNavigation",
      annotation: "Go to last used tab",
      code: () => {
        env.RUNTIME("goToLastTab");
      },
    },
  };
}

function defineGoToFirstActivatedTab(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gT",
    def: {
      group: "pageNavigation",
      annotation: "Go to first activated tab",
      code: () => {
        env.RUNTIME("historyTab", { index: 0 });
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineGoToLastActivatedTab(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gt",
    def: {
      group: "pageNavigation",
      annotation: "Go to last activated tab",
      code: () => {
        env.RUNTIME("historyTab", { index: -1 });
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineGoToPlayingTab(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gp",
    def: {
      group: "pageNavigation",
      annotation: "Go to the playing tab",
      code: () => {
        env.RUNTIME(
          "getTabs",
          { queryInfo: { audible: true } },
          (response: { tabs?: { windowId: number; id: number }[] }) => {
            const tab = response.tabs?.[0];
            if (tab) {
              env.RUNTIME("focusTab", {
                windowId: tab.windowId,
                tabId: tab.id,
              });
            }
          },
        );
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineGoBackInHistory(): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "S",
    def: {
      group: "pageNavigation",
      annotation: "Go back in history",
      code: () => {
        history.go(-1);
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineGoForwardInHistory(): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "D",
    def: {
      group: "pageNavigation",
      annotation: "Go forward in history",
      code: () => {
        history.go(1);
      },
      options: { repeatIgnore: true },
    },
  };
}

function defineReloadPage(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "r",
    def: {
      group: "pageNavigation",
      annotation: "Reload the page",
      code: () => {
        env.RUNTIME("reloadTab", { nocache: false });
      },
    },
  };
}

function defineOpenIncognitoWindow(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "oi",
    def: {
      group: "omnibar",
      annotation: "Open incognito window",
      code: () => {
        env.RUNTIME("openIncognito", {
          url: window.location.href,
        });
      },
    },
  };
}

function defineOpenTabUrlsOmnibar(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "H",
    def: {
      group: "omnibar",
      annotation: "Open opened URL in current tab",
      code: () => {
        ctx.front.openOmnibar({ type: "TabURLs" });
      },
    },
  };
}

function defineOpenVIMarksOmnibar(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "om",
    def: {
      group: "omnibar",
      annotation: "Open URL from vim-like marks",
      code: () => {
        ctx.front.openOmnibar({ type: "VIMarks" });
      },
    },
  };
}

function defineOpenCommandsOmnibar(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ":",
    def: {
      group: "omnibar",
      annotation: "Open commands",
      code: () => {
        ctx.front.openOmnibar({ type: "Commands" });
      },
    },
  };
}

function defineYankInputText(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yi",
    def: {
      group: "clipboard",
      annotation: "Yank text of an input",
      code: () => {
        ctx.hints.create(
          "input, textarea, select",
          (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
            ctx.clipboard.write(element.value);
          },
        );
      },
    },
  };
}

function defineCloseTab(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "x",
    def: {
      group: "tabs",
      annotation: "Close current tab",
      code: () => {
        env.RUNTIME("closeTab");
      },
    },
  };
}

function defineFocusTopWindow(): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";w",
    def: {
      group: "scroll",
      annotation: "Focus top window",
      code: () => {
        top!.focus();
      },
    },
  };
}

function defineOpenSelectedOrClipboardLink(ctx: ModeContext, env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "cc",
    def: {
      group: "clipboard",
      annotation: "Open selected link or link from clipboard",
      code: () => {
        if (window.getSelection()!.toString()) {
          env.tabOpenLink(window.getSelection()!.toString());
        } else {
          ctx.clipboard.read((response) => {
            env.tabOpenLink(response.data);
          });
        }
      },
    },
  };
}

function defineClearQueueUrls(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";cq",
    def: {
      group: "clipboard",
      annotation: "Clear all URLs in queue to be opened",
      code: () => {
        env.RUNTIME("clearQueueURLs");
      },
    },
  };
}

function defineCopyPageSource(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "ys",
    def: {
      group: "clipboard",
      annotation: "Copy current page's source",
      code: () => {
        const documentClone = document.documentElement.cloneNode(true);
        if (documentClone instanceof Element) {
          ctx.clipboard.write(documentClone.outerHTML);
        }
      },
    },
  };
}

function defineCopySettings(ctx: ModeContext, env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yj",
    def: {
      group: "clipboard",
      annotation: "Copy current settings",
      code: () => {
        env.RUNTIME(
          "getSettings",
          {
            key: "RAW",
          },
          (response: { settings: unknown }) => {
            ctx.clipboard.write(JSON.stringify(response.settings, regExpReplacer, 4));
          },
        );
      },
    },
  };
}

function defineRestoreSettings(ctx: ModeContext, env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";pj",
    def: {
      group: "clipboard",
      annotation: "Restore settings data from clipboard",
      code: () => {
        ctx.clipboard.read((response) => {
          const result = v.safeParse(clipboardSettingsSchema, parseJsonSafe(response.data.trim()));
          if (!result.success) {
            showBanner("Clipboard does not contain valid settings data.");
            return;
          }
          env.RUNTIME("updateSettings", { settings: result.output });
        });
      },
    },
  };
}

function defineDuplicateTab(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yt",
    def: {
      group: "tabs",
      annotation: "Duplicate current tab",
      code: () => {
        env.RUNTIME("duplicateTab");
      },
    },
  };
}

function defineDuplicateTabBackground(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yT",
    def: {
      group: "tabs",
      annotation: "Duplicate current tab in background",
      code: () => {
        env.RUNTIME("duplicateTab", { active: false });
      },
    },
  };
}

function defineCopyPageUrl(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yy",
    def: {
      group: "clipboard",
      annotation: "Copy current page's URL",
      code: () => {
        ctx.clipboard.write(window.location.href);
      },
    },
  };
}

function defineCopyAllTabUrls(ctx: ModeContext, env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yY",
    def: {
      group: "clipboard",
      annotation: "Copy all tabs's url",
      code: () => {
        env.request("getTabs").then((response) => {
          const { tabs } = v.parse(
            v.object({ tabs: v.array(v.object({ url: v.optional(v.string()) })) }),
            response,
          );
          ctx.clipboard.write(tabs.map((tab) => tab.url ?? "").join("\n"));
        }, reportError);
      },
    },
  };
}

function defineCopyPageHost(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yh",
    def: {
      group: "clipboard",
      annotation: "Copy current page's host",
      code: () => {
        const url = new URL(window.location.href);
        ctx.clipboard.write(url.host);
      },
    },
  };
}

function defineCopyPageTitle(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yl",
    def: {
      group: "clipboard",
      annotation: "Copy current page's title",
      code: () => {
        ctx.clipboard.write(document.title);
      },
    },
  };
}

function defineCopyOmniQueryHistory(ctx: ModeContext, env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yQ",
    def: {
      group: "clipboard",
      annotation: "Copy all query history of OmniQuery.",
      code: () => {
        env.RUNTIME(
          "getSettings",
          {
            key: "OmniQueryHistory",
          },
          (response: { settings: { OmniQueryHistory: string[] } }) => {
            ctx.clipboard.write(response.settings.OmniQueryHistory.join("\n"));
          },
        );
      },
    },
  };
}

function defineCopyFormData(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yf",
    def: {
      group: "clipboard",
      annotation: "Copy form data in JSON on current page",
      code: () => {
        const formsData: Record<string, unknown> = {};
        document.querySelectorAll("form").forEach((form) => {
          formsData[generateFormKey(form)] = getFormData(form, "json");
        });
        ctx.clipboard.write(JSON.stringify(formsData, null, 4));
      },
    },
  };
}

function defineFillForm(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";pf",
    def: {
      group: "clipboard",
      annotation: "Fill form with data from yf",
      code: () => {
        ctx.hints.create("form", (element: HTMLFormElement) => {
          const formKey = generateFormKey(element);
          ctx.clipboard.read((response) => {
            const result = v.safeParse(clipboardFormsSchema, parseJsonSafe(response.data.trim()));
            const forms: Record<string, Record<string, unknown>> = result.success
              ? result.output
              : {};
            const formValues = forms[formKey];
            if (formValues) {
              element.querySelectorAll<HTMLInputElement>("input, textarea").forEach((input) => {
                const value = formValues[input.name];
                if (Object.hasOwn(formValues, input.name) && input.type !== "hidden") {
                  if (input.type === "radio") {
                    const option = element.querySelector<HTMLInputElement>(
                      `input[name='${input.name}'][value='${String(value)}']`,
                    );
                    if (option) {
                      option.checked = true;
                    }
                  } else if (Array.isArray(value)) {
                    element
                      .querySelectorAll<HTMLInputElement>(`input[name='${input.name}']`)
                      .forEach((ip2) => {
                        ip2.checked = false;
                      });
                    value.forEach((v) => {
                      const option = element.querySelector<HTMLInputElement>(
                        `input[name='${input.name}'][value='${v}']`,
                      );
                      if (option) {
                        option.checked = true;
                      }
                    });
                  } else if (typeof value === "string") {
                    input.value = value;
                  }
                }
              });
            } else {
              showBanner("No form data found for your selection from clipboard.");
            }
          });
        });
      },
    },
  };
}

function defineCopyFormDataForPost(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yp",
    def: {
      group: "clipboard",
      annotation: "Copy form data for POST on current page",
      code: () => {
        const formsData: Record<string, unknown>[] = [];
        document.querySelectorAll("form").forEach((form) => {
          const formEntry: Record<string, unknown> = {
            [(form.method || "get") + "::" + form.action]: getFormData(form),
          };
          formsData.push(formEntry);
        });
        ctx.clipboard.write(JSON.stringify(formsData, null, 4));
      },
    },
  };
}

function defineReloadWithoutQueryString(): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "g?",
    def: {
      group: "pageNavigation",
      annotation: "Reload current page without query string(all parts after question mark)",
      code: () => {
        window.location.href = window.location.href.replace(/\?[^?]*$/, "");
      },
    },
  };
}

function defineReloadWithoutHash(): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "g#",
    def: {
      group: "pageNavigation",
      annotation: "Reload current page without hash fragment",
      code: () => {
        window.location.href = window.location.href.replace(/#[^#]*$/, "");
      },
    },
  };
}

function defineGoToUrlRoot(): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gU",
    def: {
      group: "pageNavigation",
      annotation: "Go to root of current URL hierarchy",
      code: () => {
        window.location.href = window.location.origin;
      },
    },
  };
}

function defineCloseTabLeft(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gxt",
    def: {
      group: "tabs",
      annotation: "Close tab on left",
      code: () => {
        env.RUNTIME("closeTabLeft");
      },
    },
  };
}

function defineCloseTabRight(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gxT",
    def: {
      group: "tabs",
      annotation: "Close tab on right",
      code: () => {
        env.RUNTIME("closeTabRight");
      },
    },
  };
}

function defineCloseAllTabsLeft(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gx0",
    def: {
      group: "tabs",
      annotation: "Close all tabs on left",
      code: () => {
        env.RUNTIME("closeTabsToLeft");
      },
    },
  };
}

function defineCloseAllTabsRight(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gx$",
    def: {
      group: "tabs",
      annotation: "Close all tabs on right",
      code: () => {
        env.RUNTIME("closeTabsToRight");
      },
    },
  };
}

function defineCloseOtherTabs(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gxx",
    def: {
      group: "tabs",
      annotation: "Close all tabs except current one",
      code: () => {
        env.RUNTIME("tabOnly");
      },
    },
  };
}

function defineClosePlayingTab(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gxp",
    def: {
      group: "tabs",
      annotation: "Close playing tab",
      code: () => {
        env.RUNTIME("closeAudibleTab");
      },
    },
  };
}

function defineEditSettings(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";e",
    def: {
      group: "settings",
      annotation: "Edit Settings",
      code: () => {
        env.tabOpenLink("/options.html");
      },
    },
  };
}

function defineBrowserSpecificMappings(env: EngineEnv): ModalMappingDef[] {
  const browserName = getBrowserName();
  if (browserName === "Firefox") {
    return [
      {
        mode: "nmap",
        keys: "on",
        def: {
          group: "tabs",
          annotation: "Open newtab",
          code: () => {
            env.tabOpenLink("about:blank");
          },
        },
      },
    ];
  }
  if (browserName === "Chrome") {
    const openChromePage = (
      keys: string,
      url: string,
      { group, annotation }: { group: FeatureGroup; annotation: string },
    ): ModalMappingDef => ({
      mode: "nmap",
      keys,
      def: {
        group,
        annotation,
        code: () => {
          env.tabOpenLink(url);
        },
      },
    });
    return [
      openChromePage("on", "chrome://newtab/", { group: "tabs", annotation: "Open newtab" }),
      openChromePage("ga", "chrome://help/", {
        group: "chromeUrls",
        annotation: "Open Chrome About",
      }),
      openChromePage("gb", "chrome://bookmarks/", {
        group: "chromeUrls",
        annotation: "Open Chrome Bookmarks",
      }),
      openChromePage("gc", "chrome://cache/", {
        group: "chromeUrls",
        annotation: "Open Chrome Cache",
      }),
      openChromePage("gd", "chrome://downloads/", {
        group: "chromeUrls",
        annotation: "Open Chrome Downloads",
      }),
      openChromePage("gh", "chrome://history/", {
        group: "chromeUrls",
        annotation: "Open Chrome History",
      }),
      openChromePage("gk", "chrome://settings/cookies", {
        group: "chromeUrls",
        annotation: "Open Chrome Cookies",
      }),
      openChromePage("ge", "chrome://extensions/", {
        group: "chromeUrls",
        annotation: "Open Chrome Extensions",
      }),
      openChromePage(";i", "chrome://inspect/#devices", {
        group: "chromeUrls",
        annotation: "Open Chrome Inspect",
      }),
    ];
  }
  return [];
}

function defineRestoreClosedTab(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "X",
    def: {
      group: "tabs",
      annotation: "Restore closed tab",
      code: () => {
        env.RUNTIME("openLast");
      },
    },
  };
}

function defineOpenUrlOmnibar(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "t",
    def: {
      group: "omnibar",
      annotation: "Open a URL",
      code: () => {
        ctx.front.openOmnibar({ type: "URLs" });
      },
    },
  };
}

function defineOpenUrlCurrentTab(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "go",
    def: {
      group: "omnibar",
      annotation: "Open a URL in current tab",
      code: () => {
        ctx.front.openOmnibar({ type: "URLs", tabbed: false });
      },
    },
  };
}

function defineOpenRecentlyClosed(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "ox",
    def: {
      group: "omnibar",
      annotation: "Open recently closed URL",
      code: () => {
        ctx.front.openOmnibar({ type: "RecentlyClosed" });
      },
    },
  };
}

function defineOpenBookmark(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "b",
    def: {
      group: "omnibar",
      annotation: "Open a bookmark",
      code: () => {
        ctx.front.openOmnibar({ type: "Bookmarks" });
      },
    },
  };
}

function defineCloseTabsByUrl(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";x",
    def: {
      group: "tabs",
      annotation: "Close tabs by URL",
      code: () => {
        ctx.front.openOmnibar({ type: "CloseTabs" });
      },
    },
  };
}

function defineBookmarkCurrentPage(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "ab",
    def: {
      group: "omnibar",
      annotation: "Bookmark current page to selected folder",
      code: () => {
        const page = {
          url: window.location.href,
          title: document.title,
        };
        ctx.front.openOmnibar({ type: "AddBookmark", extra: page });
      },
    },
  };
}

function defineOpenHistoryOmnibar(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "oh",
    def: {
      group: "omnibar",
      annotation: "Open URL from history",
      code: () => {
        ctx.front.openOmnibar({ type: "History" });
      },
    },
  };
}

function defineMoveTabToWindow(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "W",
    def: {
      group: "tabs",
      annotation: "Move current tab to another window",
      code: () => {
        ctx.front.openOmnibar({ type: "Windows" });
      },
    },
  };
}

function defineGatherFilteredTabs(ctx: ModeContext): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";gt",
    def: {
      group: "tabs",
      annotation: "Gather filtered tabs into current window",
      code: () => {
        ctx.front.openOmnibar({
          type: "Tabs",
          extra: {
            action: "gather",
          },
        });
      },
    },
  };
}

function defineGatherAllTabs(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";gw",
    def: {
      group: "tabs",
      annotation: "Gather all tabs into current window",
      code: () => {
        env.RUNTIME("gatherWindows");
      },
    },
  };
}

function defineMoveTabLeft(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "<<",
    def: {
      group: "tabs",
      annotation: "Move current tab to left",
      code: () => {
        env.RUNTIME("moveTab", {
          step: -1,
        });
      },
    },
  };
}

function defineMoveTabRight(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ">>",
    def: {
      group: "tabs",
      annotation: "Move current tab to right",
      code: () => {
        env.RUNTIME("moveTab", {
          step: 1,
        });
      },
    },
  };
}

function defineCopyDownloadingUrl(ctx: ModeContext, env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "yd",
    def: {
      group: "clipboard",
      annotation: "Copy current downloading URL",
      code: () => {
        env.RUNTIME(
          "getDownloads",
          {
            query: { state: "in_progress" },
          },
          (response) => {
            const { downloads } = v.parse(
              v.object({ downloads: v.array(v.object({ url: v.optional(v.string()) })) }),
              response,
            );
            const items = downloads.map((o) => {
              return o.url ?? "";
            });
            ctx.clipboard.write(items.join(","));
          },
        );
      },
    },
  };
}

function defineViewPageSource(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: "gs",
    def: {
      group: "chromeUrls",
      annotation: "View page source",
      code: () => {
        env.RUNTIME("viewSource", { tab: { tabbed: true } });
      },
    },
  };
}

function defineDownloadImage(ctx: ModeContext, env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";di",
    def: {
      group: "mouseClick",
      annotation: "Download image",
      code: () => {
        ctx.hints.create("img", (element: HTMLImageElement) => {
          env.RUNTIME("download", {
            url: element.src,
          });
        });
      },
    },
  };
}

function defineCloseDownloadsShelf(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";j",
    def: {
      group: "chromeUrls",
      annotation: "Close Downloads Shelf",
      code: () => {
        env.RUNTIME("closeDownloadsShelf", { clearHistory: true });
      },
    },
  };
}

function defineDeleteOldHistory(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";dh",
    def: {
      group: "misc",
      annotation: "Delete history older than 30 days",
      code: () => {
        env.RUNTIME("deleteHistoryOlderThan", {
          days: 30,
        });
      },
    },
  };
}

function defineYankHistories(ctx: ModeContext, env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";yh",
    def: {
      group: "misc",
      annotation: "Yank histories",
      code: () => {
        env.RUNTIME("getHistory", {}, (response) => {
          const { history } = v.parse(
            v.object({ history: v.array(v.object({ url: v.optional(v.string()) })) }),
            response,
          );
          ctx.clipboard.write(history.map((h) => h.url ?? "").join("\n"));
        });
      },
    },
  };
}

function definePutHistories(ctx: ModeContext, env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";ph",
    def: {
      group: "misc",
      annotation: "Put histories from clipboard",
      code: () => {
        ctx.clipboard.read((response) => {
          env.RUNTIME("addHistories", { history: response.data.split("\n") });
        });
      },
    },
  };
}

function defineRemoveBookmark(env: EngineEnv): ModalMappingDef {
  return {
    mode: "nmap",
    keys: ";db",
    def: {
      group: "misc",
      annotation: "Remove bookmark for current page",
      code: () => {
        env.RUNTIME("removeBookmark");
      },
    },
  };
}

/** Build the default key map as data, keyed by mode then by key sequence, registering nothing. */
export default function createDefaultMappings(
  ctx: ModeContext,
  env: EngineEnv,
  searchSelectedWith: SearchSelectedWith,
): DefaultMappings {
  const entries: ModalMappingDef[] = [
    definePreviousPage(ctx),
    defineNextPage(ctx),
    defineChooseTab(ctx),
    defineShowUsage(ctx),
    defineOpenWordTranslation(ctx),
    defineToggleQuotes(),
    defineShowLastAction(),
    defineGoToFirstEditBox(ctx),
    defineGoToEditBox(ctx),
    defineRegionalHints(ctx),
    defineVisualWholeElement(ctx),
    defineYankElementText(ctx),
    defineYankMultipleElementsText(ctx),
    defineRestoreVisualMode(ctx),
    defineFindSelectedText(ctx),
    defineVisualBackward20Lines(ctx),
    defineVisualForward20Lines(ctx),
    defineAddVIMark(ctx),
    defineJumpVIMark(ctx),
    defineJumpVIMarkNewTab(ctx),
    defineSwitchFrames(ctx),
    defineCapturePage(ctx, env),
    defineGoUpUrlPath(),
    defineMouseOutLastElement(ctx),
    definePasteHtml(ctx),
    defineTranslateSelectedText(env, searchSelectedWith),
    defineVisualTranslateSelectedText(env, searchSelectedWith),
    defineOpenDetectedLinks(ctx),
    defineRepeatLastAction(ctx),
    defineOpenLink(ctx),
    defineToggleVisualMode(ctx),
    defineNextFoundText(ctx),
    definePreviousFoundText(ctx),
    defineFocusScrollableElements(ctx),
    defineVisualTranslateWord(ctx),
    defineQueryWordWithHints(ctx),
    defineZoomReset(env),
    defineZoomIn(env),
    defineZoomOut(env),
    defineSaveSessionAndQuit(env),
    defineRestoreLastSession(env),
    defineOpenLinkActiveNewTab(ctx),
    defineOpenLinkBackgroundNewTab(ctx),
    defineOpenMultipleLinksNewTab(ctx),
    defineMouseOverElements(ctx, env),
    defineMouseOutElements(ctx),
    defineCopyLinkUrl(ctx),
    defineCopyMultipleLinkUrls(ctx),
    defineCopyTableColumn(ctx),
    defineCopyMultipleTableColumns(ctx),
    defineCopyPreText(ctx),
    defineClickImageOrButton(ctx),
    defineTogglePinTab(env),
    defineToggleMuteTab(env),
    defineTabHistoryBack(env),
    defineTabHistoryForward(env),
    defineGoToLastUsedTab(env),
    defineGoToFirstActivatedTab(env),
    defineGoToLastActivatedTab(env),
    defineGoToPlayingTab(env),
    defineGoBackInHistory(),
    defineGoForwardInHistory(),
    defineReloadPage(env),
    defineOpenIncognitoWindow(env),
    defineOpenTabUrlsOmnibar(ctx),
    defineOpenVIMarksOmnibar(ctx),
    defineOpenCommandsOmnibar(ctx),
    defineYankInputText(ctx),
    defineCloseTab(env),
    defineFocusTopWindow(),
    defineOpenSelectedOrClipboardLink(ctx, env),
    defineClearQueueUrls(env),
    defineCopyPageSource(ctx),
    defineCopySettings(ctx, env),
    defineRestoreSettings(ctx, env),
    defineDuplicateTab(env),
    defineDuplicateTabBackground(env),
    defineCopyPageUrl(ctx),
    defineCopyAllTabUrls(ctx, env),
    defineCopyPageHost(ctx),
    defineCopyPageTitle(ctx),
    defineCopyOmniQueryHistory(ctx, env),
    defineCopyFormData(ctx),
    defineFillForm(ctx),
    defineCopyFormDataForPost(ctx),
    defineReloadWithoutQueryString(),
    defineReloadWithoutHash(),
    defineGoToUrlRoot(),
    defineCloseTabLeft(env),
    defineCloseTabRight(env),
    defineCloseAllTabsLeft(env),
    defineCloseAllTabsRight(env),
    defineCloseOtherTabs(env),
    defineClosePlayingTab(env),
    defineEditSettings(env),
    ...defineBrowserSpecificMappings(env),
    defineRestoreClosedTab(env),
    defineOpenUrlOmnibar(ctx),
    defineOpenUrlCurrentTab(ctx),
    defineOpenRecentlyClosed(ctx),
    defineOpenBookmark(ctx),
    defineCloseTabsByUrl(ctx),
    defineBookmarkCurrentPage(ctx),
    defineOpenHistoryOmnibar(ctx),
    defineMoveTabToWindow(ctx),
    defineGatherFilteredTabs(ctx),
    defineGatherAllTabs(env),
    defineMoveTabLeft(env),
    defineMoveTabRight(env),
    defineCopyDownloadingUrl(ctx, env),
    defineViewPageSource(env),
    defineDownloadImage(ctx, env),
    defineCloseDownloadsShelf(env),
    defineDeleteOldHistory(env),
    defineYankHistories(ctx, env),
    definePutHistories(ctx, env),
    defineRemoveBookmark(env),
  ];

  const result: DefaultMappings = { nmap: {}, vmap: {}, imap: {} };
  for (const { mode, keys, def } of entries) {
    result[mode][keys] = def;
  }
  return result;
}
