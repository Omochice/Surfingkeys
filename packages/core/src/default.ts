import * as v from "valibot";

import type { SurfingkeysApi } from "./api";
import { conf } from "./conf";
import type { EngineEnv } from "./engineEnv";
import { dispatchSKEvent } from "./events";
import KeyboardUtils from "./keyboardUtils";
import type { ModeContext } from "./modeGraph";
import { repeatCount } from "./repeatCount";
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

// Parse JSON without throwing: malformed input becomes undefined so callers can
// route it through schema validation and a graceful fallback.
/**
 * A text-anchor / clickable-text hint match: the text node, the offset within it, and the matched
 * text. `offset === 0` means the whole node's data is the match; otherwise element[2] holds the
 * text.
 */
type TextAnchorMatch = [CharacterData, number, string];

const parseJsonSafe = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// External suggestion endpoints return untrusted data validated below; the
// leading element echoes the query (sometimes null), so only the suggestion
// list at index 1 is constrained.
const openSearchSuggestSchema = v.tupleWithRest([v.unknown(), v.array(v.string())], v.unknown());
const duckduckgoSuggestSchema = v.array(v.object({ phrase: v.string() }));
const githubRepoSuggestSchema = v.object({
  items: v.array(v.object({ description: v.nullable(v.string()), html_url: v.string() })),
});
const youtubeSuggestSchema = v.tupleWithRest(
  [v.unknown(), v.array(v.tupleWithRest([v.string()], v.unknown()))],
  v.unknown(),
);

// Clipboard restore reads back JSON the user previously copied; only the
// top-level object shape is constrained, individual values stay unknown and are
// narrowed at the use sites.
const clipboardSettingsSchema = v.record(v.string(), v.unknown());
const clipboardFormsSchema = v.record(v.string(), v.record(v.string(), v.unknown()));

/** Shared dependencies handed to every default-mapping registration function. */
type DefaultMappingContext = {
  api: SurfingkeysApi;
  ctx: ModeContext;
  env: EngineEnv;
};

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
        // Only non-empty string values collapse a repeated field into an array (file
        // entries have no length and were skipped here historically).
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

function openGoogleTranslate(api: SurfingkeysApi, env: EngineEnv): void {
  if (window.getSelection()!.toString()) {
    api.searchSelectedWith("https://translate.google.com/?hl=en#auto/en/", false, false, "");
  } else {
    env.tabOpenLink(
      "https://translate.google.com/translate?js=n&sl=auto&tl=zh-CN&u=" + window.location.href,
    );
  }
}

function registerPreviousPage({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("[[", "#1Click on the previous link on current page", ctx.hints.previousPage);
}

function registerNextPage({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("]]", "#1Click on the next link on current page", ctx.hints.nextPage);
}

function registerChooseTab({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("T", "#3Choose a tab", () => {
    ctx.front.chooseTab();
  });
}

function registerShowUsage({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("?", "#0Show usage", () => {
    ctx.front.showUsage();
  });
}

function registerOpenWordTranslation({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("Q", "#8Open omnibar for word translation", () => {
    ctx.front.openOmniquery({ query: getWordUnderCursor(), style: "opacity: 0.8;" });
  });
}

function registerToggleQuotes({ api }: DefaultMappingContext): void {
  api.imapkey("<Ctrl-'>", "#14Toggle quotes in an input element", toggleQuote);
}

function registerShowLastAction({ api }: DefaultMappingContext): void {
  api.mapkey(
    ";ql",
    "#0Show last action",
    () => {
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
    { repeatIgnore: true },
  );
}

function registerGoToFirstEditBox({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("gi", "#1Go to the first edit box", () => {
    ctx.hints.createInputLayer();
  });
}

function registerGoToEditBox({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("i", "#1Go to edit box", () => {
    ctx.hints.create(getCssSelectorsOfEditable(), ctx.hints.dispatchMouseClick);
  });
}

function registerRegionalHints({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("L", "#1Enter regional Hints mode", () => {
    ctx.hints.create(getLargeElements(), () => {}, { regionalHints: true });
  });
}

function registerVisualWholeElement({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("zv", "#9Enter visual mode, and select whole element", () => {
    ctx.visual.toggle("z");
  });
}

function registerYankElementText({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("yv", "#7Yank text of an element", () => {
    ctx.hints.create(conf.textAnchorPat, (element: TextAnchorMatch) => {
      ctx.clipboard.write(element[1] === 0 ? element[0].data.trim() : element[2].trim());
    });
  });
}

function registerYankMultipleElementsText({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("ymv", "#7Yank text of multiple elements", () => {
    const textToYank: string[] = [];
    ctx.hints.create(
      conf.textAnchorPat,
      (element: TextAnchorMatch) => {
        textToYank.push(element[1] === 0 ? element[0].data.trim() : element[2].trim());
        ctx.clipboard.write(textToYank.join("\n"));
      },
      { multipleHits: true },
    );
  });
}

function registerRestoreVisualMode({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("V", "#9Restore visual mode", () => {
    ctx.visual.restore();
  });
}

function registerFindSelectedText({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("*", "#9Find selected text in current page", () => {
    ctx.visual.star();
    ctx.visual.toggle();
  });
}

function registerVisualBackward20Lines({ api, ctx }: DefaultMappingContext): void {
  api.vmapkey("<Ctrl-u>", "#9Backward 20 lines", () => {
    ctx.visual.feedkeys("20k");
  });
}

function registerVisualForward20Lines({ api, ctx }: DefaultMappingContext): void {
  api.vmapkey("<Ctrl-d>", "#9Forward 20 lines", () => {
    ctx.visual.feedkeys("20j");
  });
}

function registerAddVIMark({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("m", "#10Add current URL to vim-like marks", ctx.normal.addVIMark);
}

function registerJumpVIMark({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("'", "#10Jump to vim-like mark", ctx.normal.jumpVIMark);
}

function registerJumpVIMarkNewTab({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("<Ctrl-'>", "#10Jump to vim-like mark in new tab.", (mark: string) => {
    ctx.normal.jumpVIMark(mark);
  });
}

function registerSwitchFrames({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("w", "#2Switch frames", () => {
    // ensure frontend ready so that ui related actions can be available in iframes.
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
  });
}

function registerCapturePage({ api, ctx, env }: DefaultMappingContext): void {
  api.mapkey("yg", "#7Capture current page", () => {
    ctx.front.toggleStatus(false);
    setTimeout(() => {
      env.RUNTIME("captureVisibleTab", null, (response: { dataUrl: string }) => {
        ctx.front.toggleStatus(true);
        showPopup(`<img src='${response.dataUrl}' />`);
      });
    }, 500);
  });
}

function registerGoUpUrlPath({ api }: DefaultMappingContext): void {
  api.mapkey("gu", "#4Go up one path in the URL", () => {
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
  });
}

function registerMouseOutLastElement({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(";m", "#1mouse out last element", () => {
    ctx.hints.mouseoutLastElement();
  });
}

function registerPasteHtml({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(";pp", "#7Paste html on current page", () => {
    ctx.clipboard.read((response) => {
      removeAttributes(document.documentElement);
      removeAttributes(document.body);
      setSanitizedContent(
        document.head,
        "<title>" + new Date() + " updated by Surfingkeys</title>",
      );
      setSanitizedContent(document.body, response.data);
    });
  });
}

function registerTranslateSelectedText({ api, env }: DefaultMappingContext): void {
  api.mapkey(";t", "Translate selected text with google", () => {
    if (env.surfingkeys) {
      env.surfingkeys.translateCurrentPage();
    } else {
      openGoogleTranslate(api, env);
    }
  });
}

function registerVisualTranslateSelectedText({ api, env }: DefaultMappingContext): void {
  api.vmapkey("t", "#9Translate selected text with google", () => {
    openGoogleTranslate(api, env);
  });
}

function registerOpenDetectedLinks({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("O", "#1Open detected links from text", () => {
    ctx.hints.create(
      conf.clickablePat,
      (element: TextAnchorMatch) => {
        window.location.assign(element[2]);
      },
      { statusLine: "Open detected links from text" },
    );
  });
}

function registerRepeatLastAction({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(
    ".",
    "#0Repeat last action",
    () => {
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
    { repeatIgnore: true },
  );
}

function registerOpenLink({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(
    "f",
    "#1Open a link, press SHIFT to flip overlapped hints, hold SPACE to hide hints",
    () => {
      ctx.hints.create("", ctx.hints.dispatchMouseClick);
    },
    { repeatIgnore: true },
  );
}

function registerToggleVisualMode({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(
    "v",
    "#9Toggle visual mode",
    () => {
      ctx.visual.toggle();
    },
    { repeatIgnore: true },
  );
}

function registerNextFoundText({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(
    "n",
    "#9Next found text",
    () => {
      ctx.visual.next(false);
    },
    { repeatIgnore: true },
  );
}

function registerPreviousFoundText({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(
    "N",
    "#9Previous found text",
    () => {
      ctx.visual.next(true);
    },
    { repeatIgnore: true },
  );
}

function registerFocusScrollableElements({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(";fs", "#1Display hints to focus scrollable elements", () => {
    ctx.hints.create(ctx.normal.refreshScrollableElements(), ctx.hints.dispatchMouseClick);
  });
}

function registerVisualTranslateWord({ api, ctx }: DefaultMappingContext): void {
  api.vmapkey("q", "#9Translate word under cursor", () => {
    const w = getWordUnderCursor();
    const b = ctx.visual.getCursorPixelPos();
    ctx.front.performInlineQuery(
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
  });
}

function registerQueryWordWithHints({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("cq", "#7Query word with Hints", () => {
    ctx.hints.create(conf.textAnchorPat, (element: TextAnchorMatch) => {
      const word = element[2].trim().replace(/[^A-z].*$/, "");
      const b = getTextNodePos(element[0], element[1], element[2].length);
      ctx.front.performInlineQuery(
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
  });
}

function registerGoToFirstTab({ api }: DefaultMappingContext): void {
  api.map("g0", ":feedkeys 99E", 0, "#3Go to the first tab");
}

function registerGoToLastTab({ api }: DefaultMappingContext): void {
  api.map("g$", ":feedkeys 99R", 0, "#3Go to the last tab");
}

function registerZoomReset({ api, env }: DefaultMappingContext): void {
  api.mapkey("zr", "#3zoom reset", () => {
    env.RUNTIME("setZoom", {
      zoomFactor: 0,
    });
  });
}

function registerZoomIn({ api, env }: DefaultMappingContext): void {
  api.mapkey("zi", "#3zoom in", () => {
    env.RUNTIME("setZoom", {
      zoomFactor: 0.1,
    });
  });
}

function registerZoomOut({ api, env }: DefaultMappingContext): void {
  api.mapkey("zo", "#3zoom out", () => {
    env.RUNTIME("setZoom", {
      zoomFactor: -0.1,
    });
  });
}

function registerQuit({ api }: DefaultMappingContext): void {
  api.map("ZQ", ":quit");
}

function registerSaveSessionAndQuit({ api, env }: DefaultMappingContext): void {
  api.mapkey("ZZ", "#5Save session and quit", () => {
    env.RUNTIME("createSession", {
      name: "LAST",
      quitAfterSaved: true,
    });
  });
}

function registerRestoreLastSession({ api, env }: DefaultMappingContext): void {
  api.mapkey("ZR", "#5Restore last session", () => {
    env.RUNTIME("openSession", {
      name: "LAST",
    });
  });
}

function registerScrollFullPageUp({ api }: DefaultMappingContext): void {
  api.map("u", "e");
}

function registerOpenLinkActiveNewTab({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("af", "#1Open a link in active new tab", () => {
    ctx.hints.create("", ctx.hints.dispatchMouseClick, { tabbed: true, active: true });
  });
}

function registerOpenLinkBackgroundNewTab({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("gf", "#1Open a link in non-active new tab", () => {
    ctx.hints.create("", ctx.hints.dispatchMouseClick, { tabbed: true, active: false });
  });
}

function registerOpenMultipleLinksNewTab({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("cf", "#1Open multiple links in a new tab", () => {
    ctx.hints.create("", ctx.hints.dispatchMouseClick, { multipleHits: true });
  });
}

function registerOpenLinkBackgroundTabAlias({ api }: DefaultMappingContext): void {
  api.map("C", "gf");
}

function registerMouseOverElements({ api, ctx, env }: DefaultMappingContext): void {
  api.mapkey("<Ctrl-h>", "#1Mouse over elements.", () => {
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
  });
}

function registerMouseOutElements({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("<Ctrl-j>", "#1Mouse out elements.", () => {
    ctx.hints.create("", ctx.hints.dispatchMouseClick, { mouseEvents: ["mouseout"] });
  });
}

function registerCopyLinkUrl({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("ya", "#7Copy a link URL to the clipboard", () => {
    ctx.hints.create("*[href]", (element: HTMLAnchorElement) => {
      ctx.clipboard.write(element.href);
    });
  });
}

function registerCopyMultipleLinkUrls({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("yma", "#7Copy multiple link URLs to the clipboard", () => {
    const linksToYank: string[] = [];
    ctx.hints.create(
      "*[href]",
      (element: HTMLAnchorElement) => {
        linksToYank.push(element.href);
        ctx.clipboard.write(linksToYank.join("\n"));
      },
      { multipleHits: true },
    );
  });
}

function registerCopyTableColumn({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("yc", "#7Copy a column of a table", () => {
    ctx.hints.create(getTableColumnHeads(), (element: HTMLTableCellElement) => {
      const table = element.closest("table");
      const trs = table ? Array.from(table.querySelectorAll<HTMLTableRowElement>("tr")) : [];
      const column = trs.map((tr) => {
        const cell = tr.children[element.cellIndex];
        return cell instanceof HTMLElement ? cell.innerText : "";
      });
      ctx.clipboard.write(column.join("\n"));
    });
  });
}

function registerCopyMultipleTableColumns({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("ymc", "#7Copy multiple columns of a table", () => {
    let rows: string[] | null = null;
    ctx.hints.create(
      getTableColumnHeads(),
      (element: HTMLTableCellElement) => {
        const table = element.closest("table");
        const trs = table ? Array.from(table.querySelectorAll<HTMLTableRowElement>("tr")) : [];
        const column: string[] = trs.map((tr) => {
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
  });
}

function registerCopyPreText({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("yq", "#7Copy pre text", () => {
    ctx.hints.create("pre", (element: HTMLElement) => {
      ctx.clipboard.write(element.innerText);
    });
  });
}

function registerOmnibarArrowDown({ api }: DefaultMappingContext): void {
  api.cmap("<ArrowDown>", "<Ctrl-n>");
}

function registerOmnibarArrowUp({ api }: DefaultMappingContext): void {
  api.cmap("<ArrowUp>", "<Ctrl-p>");
}

function registerClickImageOrButton({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("q", "#1Click on an Image or a button", () => {
    ctx.hints.create("img, button", ctx.hints.dispatchMouseClick);
  });
}

function registerTogglePinTab({ api, env }: DefaultMappingContext): void {
  api.mapkey("<Alt-p>", "#3pin/unpin current tab", () => {
    env.RUNTIME("togglePinTab");
  });
}

function registerToggleMuteTab({ api, env }: DefaultMappingContext): void {
  api.mapkey("<Alt-m>", "#3mute/unmute current tab", () => {
    env.RUNTIME("muteTab");
  });
}

function registerTabHistoryBack({ api, env }: DefaultMappingContext): void {
  api.mapkey(
    "B",
    "#4Go one tab history back",
    () => {
      env.RUNTIME("historyTab", { backward: true });
    },
    { repeatIgnore: true },
  );
}

function registerTabHistoryForward({ api, env }: DefaultMappingContext): void {
  api.mapkey(
    "F",
    "#4Go one tab history forward",
    () => {
      env.RUNTIME("historyTab", { backward: false });
    },
    { repeatIgnore: true },
  );
}

function registerGoToLastUsedTab({ api, env }: DefaultMappingContext): void {
  api.mapkey("<Ctrl-6>", "#4Go to last used tab", () => {
    env.RUNTIME("goToLastTab");
  });
}

function registerGoToFirstActivatedTab({ api, env }: DefaultMappingContext): void {
  api.mapkey(
    "gT",
    "#4Go to first activated tab",
    () => {
      env.RUNTIME("historyTab", { index: 0 });
    },
    { repeatIgnore: true },
  );
}

function registerGoToLastActivatedTab({ api, env }: DefaultMappingContext): void {
  api.mapkey(
    "gt",
    "#4Go to last activated tab",
    () => {
      env.RUNTIME("historyTab", { index: -1 });
    },
    { repeatIgnore: true },
  );
}

function registerGoToPlayingTab({ api, env }: DefaultMappingContext): void {
  api.mapkey(
    "gp",
    "#4Go to the playing tab",
    () => {
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
    { repeatIgnore: true },
  );
}

function registerGoBackInHistory({ api }: DefaultMappingContext): void {
  api.mapkey(
    "S",
    "#4Go back in history",
    () => {
      history.go(-1);
    },
    { repeatIgnore: true },
  );
}

function registerGoForwardInHistory({ api }: DefaultMappingContext): void {
  api.mapkey(
    "D",
    "#4Go forward in history",
    () => {
      history.go(1);
    },
    { repeatIgnore: true },
  );
}

function registerReloadPage({ api, env }: DefaultMappingContext): void {
  api.mapkey("r", "#4Reload the page", () => {
    env.RUNTIME("reloadTab", { nocache: false });
  });
}

function registerOpenIncognitoWindow({ api, env }: DefaultMappingContext): void {
  api.mapkey("oi", "#8Open incognito window", () => {
    env.RUNTIME("openIncognito", {
      url: window.location.href,
    });
  });
}

function registerOpenTabUrlsOmnibar({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("H", "#8Open opened URL in current tab", () => {
    ctx.front.openOmnibar({ type: "TabURLs" });
  });
}

function registerOpenVIMarksOmnibar({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("om", "#8Open URL from vim-like marks", () => {
    ctx.front.openOmnibar({ type: "VIMarks" });
  });
}

function registerOpenCommandsOmnibar({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(":", "#8Open commands", () => {
    ctx.front.openOmnibar({ type: "Commands" });
  });
}

function registerYankInputText({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("yi", "#7Yank text of an input", () => {
    ctx.hints.create(
      "input, textarea, select",
      (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
        ctx.clipboard.write(element.value);
      },
    );
  });
}

function registerCloseTab({ api, env }: DefaultMappingContext): void {
  api.mapkey("x", "#3Close current tab", () => {
    env.RUNTIME("closeTab");
  });
}

function registerFocusTopWindow({ api }: DefaultMappingContext): void {
  api.mapkey(";w", "#2Focus top window", () => {
    top!.focus();
  });
}

function registerOpenSelectedOrClipboardLink({ api, ctx, env }: DefaultMappingContext): void {
  api.mapkey("cc", "#7Open selected link or link from clipboard", () => {
    if (window.getSelection()!.toString()) {
      env.tabOpenLink(window.getSelection()!.toString());
    } else {
      ctx.clipboard.read((response) => {
        env.tabOpenLink(response.data);
      });
    }
  });
}

function registerClearQueueUrls({ api, env }: DefaultMappingContext): void {
  api.mapkey(";cq", "#7Clear all URLs in queue to be opened", () => {
    env.RUNTIME("clearQueueURLs");
  });
}

function registerCopyPageSource({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("ys", "#7Copy current page's source", () => {
    const aa = document.documentElement.cloneNode(true);
    if (aa instanceof Element) {
      ctx.clipboard.write(aa.outerHTML);
    }
  });
}

function registerCopySettings({ api, ctx, env }: DefaultMappingContext): void {
  api.mapkey("yj", "#7Copy current settings", () => {
    env.RUNTIME(
      "getSettings",
      {
        key: "RAW",
      },
      (response: { settings: unknown }) => {
        ctx.clipboard.write(JSON.stringify(response.settings, regExpReplacer, 4));
      },
    );
  });
}

function registerRestoreSettings({ api, ctx, env }: DefaultMappingContext): void {
  api.mapkey(";pj", "#7Restore settings data from clipboard", () => {
    ctx.clipboard.read((response) => {
      const result = v.safeParse(clipboardSettingsSchema, parseJsonSafe(response.data.trim()));
      if (!result.success) {
        showBanner("Clipboard does not contain valid settings data.");
        return;
      }
      env.RUNTIME("updateSettings", { settings: result.output });
    });
  });
}

function registerDuplicateTab({ api, env }: DefaultMappingContext): void {
  api.mapkey("yt", "#3Duplicate current tab", () => {
    env.RUNTIME("duplicateTab");
  });
}

function registerDuplicateTabBackground({ api, env }: DefaultMappingContext): void {
  api.mapkey("yT", "#3Duplicate current tab in background", () => {
    env.RUNTIME("duplicateTab", { active: false });
  });
}

function registerCopyPageUrl({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("yy", "#7Copy current page's URL", () => {
    ctx.clipboard.write(window.location.href);
  });
}

function registerCopyAllTabUrls({ api, ctx, env }: DefaultMappingContext): void {
  api.mapkey("yY", "#7Copy all tabs's url", () => {
    env.RUNTIME("getTabs", null, (response) => {
      const { tabs } = v.parse(
        v.object({ tabs: v.array(v.object({ url: v.optional(v.string()) })) }),
        response,
      );
      ctx.clipboard.write(tabs.map((tab) => tab.url ?? "").join("\n"));
    });
  });
}

function registerCopyPageHost({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("yh", "#7Copy current page's host", () => {
    const url = new URL(window.location.href);
    ctx.clipboard.write(url.host);
  });
}

function registerCopyPageTitle({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("yl", "#7Copy current page's title", () => {
    ctx.clipboard.write(document.title);
  });
}

function registerCopyOmniQueryHistory({ api, ctx, env }: DefaultMappingContext): void {
  api.mapkey("yQ", "#7Copy all query history of OmniQuery.", () => {
    env.RUNTIME(
      "getSettings",
      {
        key: "OmniQueryHistory",
      },
      (response: { settings: { OmniQueryHistory: string[] } }) => {
        ctx.clipboard.write(response.settings.OmniQueryHistory.join("\n"));
      },
    );
  });
}

function registerCopyFormData({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("yf", "#7Copy form data in JSON on current page", () => {
    const fd: Record<string, unknown> = {};
    document.querySelectorAll("form").forEach((form) => {
      fd[generateFormKey(form)] = getFormData(form, "json");
    });
    ctx.clipboard.write(JSON.stringify(fd, null, 4));
  });
}

function registerFillForm({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(";pf", "#7Fill form with data from yf", () => {
    ctx.hints.create("form", (element: HTMLFormElement) => {
      const formKey = generateFormKey(element);
      ctx.clipboard.read((response) => {
        const result = v.safeParse(clipboardFormsSchema, parseJsonSafe(response.data.trim()));
        const forms: Record<string, Record<string, unknown>> = result.success ? result.output : {};
        const fd = forms[formKey];
        if (fd) {
          element.querySelectorAll<HTMLInputElement>("input, textarea").forEach((ip) => {
            const value = fd[ip.name];
            if (Object.hasOwn(fd, ip.name) && ip.type !== "hidden") {
              if (ip.type === "radio") {
                const op = element.querySelector<HTMLInputElement>(
                  `input[name='${ip.name}'][value='${String(value)}']`,
                );
                if (op) {
                  op.checked = true;
                }
              } else if (Array.isArray(value)) {
                element
                  .querySelectorAll<HTMLInputElement>(`input[name='${ip.name}']`)
                  .forEach((ip2) => {
                    ip2.checked = false;
                  });
                value.forEach((v) => {
                  const op = element.querySelector<HTMLInputElement>(
                    `input[name='${ip.name}'][value='${v}']`,
                  );
                  if (op) {
                    op.checked = true;
                  }
                });
              } else if (typeof value === "string") {
                ip.value = value;
              }
            }
          });
        } else {
          showBanner("No form data found for your selection from clipboard.");
        }
      });
    });
  });
}

function registerCopyFormDataForPost({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("yp", "#7Copy form data for POST on current page", () => {
    const aa: Record<string, unknown>[] = [];
    document.querySelectorAll("form").forEach((form) => {
      const fd: Record<string, unknown> = {
        [(form.method || "get") + "::" + form.action]: getFormData(form),
      };
      aa.push(fd);
    });
    ctx.clipboard.write(JSON.stringify(aa, null, 4));
  });
}

function registerReloadWithoutQueryString({ api }: DefaultMappingContext): void {
  api.mapkey(
    "g?",
    "#4Reload current page without query string(all parts after question mark)",
    () => {
      window.location.href = window.location.href.replace(/\?[^?]*$/, "");
    },
  );
}

function registerReloadWithoutHash({ api }: DefaultMappingContext): void {
  api.mapkey("g#", "#4Reload current page without hash fragment", () => {
    window.location.href = window.location.href.replace(/#[^#]*$/, "");
  });
}

function registerGoToUrlRoot({ api }: DefaultMappingContext): void {
  api.mapkey("gU", "#4Go to root of current URL hierarchy", () => {
    window.location.href = window.location.origin;
  });
}

function registerCloseTabLeft({ api, env }: DefaultMappingContext): void {
  api.mapkey("gxt", "#3Close tab on left", () => {
    env.RUNTIME("closeTabLeft");
  });
}

function registerCloseTabRight({ api, env }: DefaultMappingContext): void {
  api.mapkey("gxT", "#3Close tab on right", () => {
    env.RUNTIME("closeTabRight");
  });
}

function registerCloseAllTabsLeft({ api, env }: DefaultMappingContext): void {
  api.mapkey("gx0", "#3Close all tabs on left", () => {
    env.RUNTIME("closeTabsToLeft");
  });
}

function registerCloseAllTabsRight({ api, env }: DefaultMappingContext): void {
  api.mapkey("gx$", "#3Close all tabs on right", () => {
    env.RUNTIME("closeTabsToRight");
  });
}

function registerCloseOtherTabs({ api, env }: DefaultMappingContext): void {
  api.mapkey("gxx", "#3Close all tabs except current one", () => {
    env.RUNTIME("tabOnly");
  });
}

function registerClosePlayingTab({ api, env }: DefaultMappingContext): void {
  api.mapkey("gxp", "#3Close playing tab", () => {
    env.RUNTIME("closeAudibleTab");
  });
}

function registerEditSettings({ api, env }: DefaultMappingContext): void {
  api.mapkey(";e", "#11Edit Settings", () => {
    env.tabOpenLink("/options.html");
  });
}

function registerGoogleSearchAlias({ api }: DefaultMappingContext): void {
  api.addSearchAlias(
    "g",
    "google",
    "https://www.google.com/search?q=",
    "s",
    "https://www.google.com/complete/search?client=chrome-omni&gs_ri=chrome-ext&oit=1&cp=1&pgcl=7&q=",
    (response: { text: string }) => {
      const result = v.safeParse(openSearchSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output[1] : [];
    },
  );
}

function registerDuckDuckGoSearchAlias({ api }: DefaultMappingContext): void {
  api.addSearchAlias(
    "d",
    "duckduckgo",
    "https://duckduckgo.com/?q=",
    "s",
    "https://duckduckgo.com/ac/?q=",
    (response: { text: string }) => {
      const result = v.safeParse(duckduckgoSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output.map((r) => r.phrase) : [];
    },
  );
}

function registerBaiduSearchAlias({ api }: DefaultMappingContext): void {
  api.addSearchAlias(
    "b",
    "baidu",
    "https://www.baidu.com/s?wd=",
    "s",
    "https://suggestion.baidu.com/su?cb=&wd=",
    (response: { text: string }) => {
      const res = response.text.match(/,s:\[("[^\]]+")]}/);
      return res?.[1] ? res[1].replaceAll('"', "").split(",") : [];
    },
  );
}

function registerWikipediaSearchAlias({ api }: DefaultMappingContext): void {
  api.addSearchAlias(
    "e",
    "wikipedia",
    "https://en.wikipedia.org/wiki/",
    "s",
    "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&formatversion=2&namespace=0&limit=40&search=",
    (response: { text: string }) => {
      const result = v.safeParse(openSearchSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output[1] : [];
    },
  );
}

function registerBingSearchAlias({ api }: DefaultMappingContext): void {
  api.addSearchAlias(
    "w",
    "bing",
    "https://www.bing.com/search?setmkt=en-us&setlang=en-us&q=",
    "s",
    "https://api.bing.com/osjson.aspx?query=",
    (response: { text: string }) => {
      const result = v.safeParse(openSearchSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output[1] : [];
    },
  );
}

function registerStackOverflowSearchAlias({ api }: DefaultMappingContext): void {
  api.addSearchAlias("s", "stackoverflow", "https://stackoverflow.com/search?q=");
}

function registerGithubSearchAlias({ api }: DefaultMappingContext): void {
  api.addSearchAlias(
    "h",
    "github",
    "https://github.com/search?q=",
    "s",
    "https://api.github.com/search/repositories?order=desc&q=",
    (response: { text: string }) => {
      const result = v.safeParse(githubRepoSuggestSchema, parseJsonSafe(response.text));
      return result.success
        ? result.output.items.map((r) => ({ title: r.description, url: r.html_url }))
        : [];
    },
  );
}

function registerYoutubeSearchAlias({ api }: DefaultMappingContext): void {
  api.addSearchAlias(
    "y",
    "youtube",
    "https://www.youtube.com/results?search_query=",
    "s",
    "https://clients1.google.com/complete/search?client=youtube&ds=yt&callback=cb&q=",
    (response: { text: string }) => {
      const result = v.safeParse(youtubeSuggestSchema, parseJsonSafe(response.text.slice(9, -1)));
      return result.success ? result.output[1].map((d) => d[0]) : [];
    },
  );
}

function registerBrowserSpecificMappings({ api, env }: DefaultMappingContext): void {
  const bn = getBrowserName();
  if (bn === "Firefox") {
    api.mapkey("on", "#3Open newtab", () => {
      env.tabOpenLink("about:blank");
    });
  } else if (bn === "Chrome") {
    api.mapkey("on", "#3Open newtab", () => {
      env.tabOpenLink("chrome://newtab/");
    });
    api.mapkey("ga", "#12Open Chrome About", () => {
      env.tabOpenLink("chrome://help/");
    });
    api.mapkey("gb", "#12Open Chrome Bookmarks", () => {
      env.tabOpenLink("chrome://bookmarks/");
    });
    api.mapkey("gc", "#12Open Chrome Cache", () => {
      env.tabOpenLink("chrome://cache/");
    });
    api.mapkey("gd", "#12Open Chrome Downloads", () => {
      env.tabOpenLink("chrome://downloads/");
    });
    api.mapkey("gh", "#12Open Chrome History", () => {
      env.tabOpenLink("chrome://history/");
    });
    api.mapkey("gk", "#12Open Chrome Cookies", () => {
      env.tabOpenLink("chrome://settings/cookies");
    });
    api.mapkey("ge", "#12Open Chrome Extensions", () => {
      env.tabOpenLink("chrome://extensions/");
    });
    api.mapkey(";i", "#12Open Chrome Inspect", () => {
      env.tabOpenLink("chrome://inspect/#devices");
    });
  }
}

function registerRestoreClosedTab({ api, env }: DefaultMappingContext): void {
  api.mapkey("X", "#3Restore closed tab", () => {
    env.RUNTIME("openLast");
  });
}

function registerOpenUrlOmnibar({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("t", "#8Open a URL", () => {
    ctx.front.openOmnibar({ type: "URLs" });
  });
}

function registerOpenUrlCurrentTab({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("go", "#8Open a URL in current tab", () => {
    ctx.front.openOmnibar({ type: "URLs", tabbed: false });
  });
}

function registerOpenRecentlyClosed({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("ox", "#8Open recently closed URL", () => {
    ctx.front.openOmnibar({ type: "RecentlyClosed" });
  });
}

function registerOpenBookmark({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("b", "#8Open a bookmark", () => {
    ctx.front.openOmnibar({ type: "Bookmarks" });
  });
}

function registerCloseTabsByUrl({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(";x", "#3Close tabs by URL", () => {
    ctx.front.openOmnibar({ type: "CloseTabs" });
  });
}

function registerBookmarkCurrentPage({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("ab", "#8Bookmark current page to selected folder", () => {
    const page = {
      url: window.location.href,
      title: document.title,
    };
    ctx.front.openOmnibar({ type: "AddBookmark", extra: page });
  });
}

function registerOpenHistoryOmnibar({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("oh", "#8Open URL from history", () => {
    ctx.front.openOmnibar({ type: "History" });
  });
}

function registerMoveTabToWindow({ api, ctx }: DefaultMappingContext): void {
  api.mapkey("W", "#3Move current tab to another window", () => {
    ctx.front.openOmnibar({ type: "Windows" });
  });
}

function registerGatherFilteredTabs({ api, ctx }: DefaultMappingContext): void {
  api.mapkey(";gt", "#3Gather filtered tabs into current window", () => {
    ctx.front.openOmnibar({
      type: "Tabs",
      extra: {
        action: "gather",
      },
    });
  });
}

function registerGatherAllTabs({ api, env }: DefaultMappingContext): void {
  api.mapkey(";gw", "#3Gather all tabs into current window", () => {
    env.RUNTIME("gatherWindows");
  });
}

function registerMoveTabLeft({ api, env }: DefaultMappingContext): void {
  api.mapkey("<<", "#3Move current tab to left", () => {
    env.RUNTIME("moveTab", {
      step: -1,
    });
  });
}

function registerMoveTabRight({ api, env }: DefaultMappingContext): void {
  api.mapkey(">>", "#3Move current tab to right", () => {
    env.RUNTIME("moveTab", {
      step: 1,
    });
  });
}

function registerCopyDownloadingUrl({ api, ctx, env }: DefaultMappingContext): void {
  api.mapkey("yd", "#7Copy current downloading URL", () => {
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
  });
}

function registerViewPageSource({ api, env }: DefaultMappingContext): void {
  api.mapkey("gs", "#12View page source", () => {
    env.RUNTIME("viewSource", { tab: { tabbed: true } });
  });
}

function registerDownloadImage({ api, ctx, env }: DefaultMappingContext): void {
  api.mapkey(";di", "#1Download image", () => {
    ctx.hints.create("img", (element: HTMLImageElement) => {
      env.RUNTIME("download", {
        url: element.src,
      });
    });
  });
}

function registerCloseDownloadsShelf({ api, env }: DefaultMappingContext): void {
  api.mapkey(";j", "#12Close Downloads Shelf", () => {
    env.RUNTIME("closeDownloadsShelf", { clearHistory: true });
  });
}

function registerDeleteOldHistory({ api, env }: DefaultMappingContext): void {
  api.mapkey(";dh", "#13Delete history older than 30 days", () => {
    env.RUNTIME("deleteHistoryOlderThan", {
      days: 30,
    });
  });
}

function registerYankHistories({ api, ctx, env }: DefaultMappingContext): void {
  api.mapkey(";yh", "#13Yank histories", () => {
    env.RUNTIME("getHistory", {}, (response) => {
      const { history } = v.parse(
        v.object({ history: v.array(v.object({ url: v.optional(v.string()) })) }),
        response,
      );
      ctx.clipboard.write(history.map((h) => h.url ?? "").join("\n"));
    });
  });
}

function registerPutHistories({ api, ctx, env }: DefaultMappingContext): void {
  api.mapkey(";ph", "#13Put histories from clipboard", () => {
    ctx.clipboard.read((response) => {
      env.RUNTIME("addHistories", { history: response.data.split("\n") });
    });
  });
}

function registerRemoveBookmark({ api, env }: DefaultMappingContext): void {
  api.mapkey(";db", "#13Remove bookmark for current page", () => {
    env.RUNTIME("removeBookmark");
  });
}

export default function createDefaultMappings(
  api: SurfingkeysApi,
  ctx: ModeContext,
  env: EngineEnv,
): void {
  const context: DefaultMappingContext = { api, ctx, env };

  registerPreviousPage(context);
  registerNextPage(context);
  registerChooseTab(context);
  registerShowUsage(context);
  registerOpenWordTranslation(context);
  registerToggleQuotes(context);
  registerShowLastAction(context);
  registerGoToFirstEditBox(context);
  registerGoToEditBox(context);
  registerRegionalHints(context);
  registerVisualWholeElement(context);
  registerYankElementText(context);
  registerYankMultipleElementsText(context);
  registerRestoreVisualMode(context);
  registerFindSelectedText(context);
  registerVisualBackward20Lines(context);
  registerVisualForward20Lines(context);
  registerAddVIMark(context);
  registerJumpVIMark(context);
  registerJumpVIMarkNewTab(context);
  registerSwitchFrames(context);
  registerCapturePage(context);
  registerGoUpUrlPath(context);
  registerMouseOutLastElement(context);
  registerPasteHtml(context);
  registerTranslateSelectedText(context);
  registerVisualTranslateSelectedText(context);
  registerOpenDetectedLinks(context);
  registerRepeatLastAction(context);
  registerOpenLink(context);
  registerToggleVisualMode(context);
  registerNextFoundText(context);
  registerPreviousFoundText(context);
  registerFocusScrollableElements(context);
  registerVisualTranslateWord(context);
  registerQueryWordWithHints(context);
  registerGoToFirstTab(context);
  registerGoToLastTab(context);
  registerZoomReset(context);
  registerZoomIn(context);
  registerZoomOut(context);
  registerQuit(context);
  registerSaveSessionAndQuit(context);
  registerRestoreLastSession(context);
  registerScrollFullPageUp(context);
  registerOpenLinkActiveNewTab(context);
  registerOpenLinkBackgroundNewTab(context);
  registerOpenMultipleLinksNewTab(context);
  registerOpenLinkBackgroundTabAlias(context);
  registerMouseOverElements(context);
  registerMouseOutElements(context);
  registerCopyLinkUrl(context);
  registerCopyMultipleLinkUrls(context);
  registerCopyTableColumn(context);
  registerCopyMultipleTableColumns(context);
  registerCopyPreText(context);
  registerOmnibarArrowDown(context);
  registerOmnibarArrowUp(context);
  registerClickImageOrButton(context);
  registerTogglePinTab(context);
  registerToggleMuteTab(context);
  registerTabHistoryBack(context);
  registerTabHistoryForward(context);
  registerGoToLastUsedTab(context);
  registerGoToFirstActivatedTab(context);
  registerGoToLastActivatedTab(context);
  registerGoToPlayingTab(context);
  registerGoBackInHistory(context);
  registerGoForwardInHistory(context);
  registerReloadPage(context);
  registerOpenIncognitoWindow(context);
  registerOpenTabUrlsOmnibar(context);
  registerOpenVIMarksOmnibar(context);
  registerOpenCommandsOmnibar(context);
  registerYankInputText(context);
  registerCloseTab(context);
  registerFocusTopWindow(context);
  registerOpenSelectedOrClipboardLink(context);
  registerClearQueueUrls(context);
  registerCopyPageSource(context);
  registerCopySettings(context);
  registerRestoreSettings(context);
  registerDuplicateTab(context);
  registerDuplicateTabBackground(context);
  registerCopyPageUrl(context);
  registerCopyAllTabUrls(context);
  registerCopyPageHost(context);
  registerCopyPageTitle(context);
  registerCopyOmniQueryHistory(context);
  registerCopyFormData(context);
  registerFillForm(context);
  registerCopyFormDataForPost(context);
  registerReloadWithoutQueryString(context);
  registerReloadWithoutHash(context);
  registerGoToUrlRoot(context);
  registerCloseTabLeft(context);
  registerCloseTabRight(context);
  registerCloseAllTabsLeft(context);
  registerCloseAllTabsRight(context);
  registerCloseOtherTabs(context);
  registerClosePlayingTab(context);
  registerEditSettings(context);
  registerGoogleSearchAlias(context);
  registerDuckDuckGoSearchAlias(context);
  registerBaiduSearchAlias(context);
  registerWikipediaSearchAlias(context);
  registerBingSearchAlias(context);
  registerStackOverflowSearchAlias(context);
  registerGithubSearchAlias(context);
  registerYoutubeSearchAlias(context);
  registerBrowserSpecificMappings(context);
  registerRestoreClosedTab(context);
  registerOpenUrlOmnibar(context);
  registerOpenUrlCurrentTab(context);
  registerOpenRecentlyClosed(context);
  registerOpenBookmark(context);
  registerCloseTabsByUrl(context);
  registerBookmarkCurrentPage(context);
  registerOpenHistoryOmnibar(context);
  registerMoveTabToWindow(context);
  registerGatherFilteredTabs(context);
  registerGatherAllTabs(context);
  registerMoveTabLeft(context);
  registerMoveTabRight(context);
  registerCopyDownloadingUrl(context);
  registerViewPageSource(context);
  registerDownloadImage(context);
  registerCloseDownloadsShelf(context);
  registerDeleteOldHistory(context);
  registerYankHistories(context);
  registerPutHistories(context);
  registerRemoveBookmark(context);
}
