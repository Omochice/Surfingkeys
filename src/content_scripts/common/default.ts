import * as v from "valibot";

import type { SurfingkeysApi } from "./api";
import KeyboardUtils from "./keyboardUtils";
import type { ModeContext } from "./modeGraph";
import { RUNTIME, dispatchSKEvent, runtime } from "./runtime";
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
  tabOpenLink,
  toggleQuote,
} from "./utils";

// Parse JSON without throwing: malformed input becomes undefined so callers can
// route it through schema validation and a graceful fallback.
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

export default function (api: SurfingkeysApi, ctx: ModeContext): void {
  const { clipboard, normal, hints, visual, front } = ctx;
  const { addSearchAlias, cmap, map, mapkey, imapkey, vmapkey, searchSelectedWith } = api;

  mapkey("[[", "#1Click on the previous link on current page", hints.previousPage);
  mapkey("]]", "#1Click on the next link on current page", hints.nextPage);
  mapkey("T", "#3Choose a tab", () => {
    front.chooseTab();
  });
  mapkey("?", "#0Show usage", () => {
    front.showUsage();
  });
  mapkey("Q", "#8Open omnibar for word translation", () => {
    front.openOmniquery({ query: getWordUnderCursor(), style: "opacity: 0.8;" });
  });
  imapkey("<Ctrl-'>", "#14Toggle quotes in an input element", toggleQuote);

  mapkey(
    ";ql",
    "#0Show last action",
    () => {
      showPopup(
        htmlEncode(
          runtime.conf.lastKeys
            .map((k) => {
              return KeyboardUtils.decodeKeystroke(k);
            })
            .join(" → "),
        ),
      );
    },
    { repeatIgnore: true },
  );

  mapkey("gi", "#1Go to the first edit box", () => {
    hints.createInputLayer();
  });
  mapkey("i", "#1Go to edit box", () => {
    hints.create(getCssSelectorsOfEditable(), hints.dispatchMouseClick);
  });
  mapkey("L", "#1Enter regional Hints mode", () => {
    hints.create(getLargeElements(), () => {}, { regionalHints: true });
  });

  mapkey("zv", "#9Enter visual mode, and select whole element", () => {
    visual.toggle("z");
  });
  mapkey("yv", "#7Yank text of an element", () => {
    hints.create(runtime.conf.textAnchorPat, (element: any) => {
      clipboard.write(element[1] === 0 ? element[0].data.trim() : element[2].trim());
    });
  });
  mapkey("ymv", "#7Yank text of multiple elements", () => {
    const textToYank: string[] = [];
    hints.create(
      runtime.conf.textAnchorPat,
      (element: any) => {
        textToYank.push(element[1] === 0 ? element[0].data.trim() : element[2].trim());
        clipboard.write(textToYank.join("\n"));
      },
      { multipleHits: true },
    );
  });

  mapkey("V", "#9Restore visual mode", () => {
    visual.restore();
  });
  mapkey("*", "#9Find selected text in current page", () => {
    visual.star();
    visual.toggle();
  });

  vmapkey("<Ctrl-u>", "#9Backward 20 lines", () => {
    visual.feedkeys("20k");
  });
  vmapkey("<Ctrl-d>", "#9Forward 20 lines", () => {
    visual.feedkeys("20j");
  });

  mapkey("m", "#10Add current URL to vim-like marks", normal.addVIMark);
  mapkey("'", "#10Jump to vim-like mark", normal.jumpVIMark);
  mapkey("<Ctrl-'>", "#10Jump to vim-like mark in new tab.", (mark: string) => {
    normal.jumpVIMark(mark);
  });

  mapkey("w", "#2Switch frames", () => {
    // ensure frontend ready so that ui related actions can be available in iframes.
    dispatchSKEvent("ensureFrontEnd");
    if (window === top) {
      hints
        .create("iframe", (element: any) => {
          element.scrollIntoView({
            behavior: "auto",
            block: "center",
            inline: "center",
          });
          normal.highlightElement(element);
          element.contentWindow.focus();
        })
        .then((hintsTotal) => {
          if (hintsTotal === 0) {
            normal.rotateFrame();
          }
        });
    } else {
      normal.rotateFrame();
    }
  });

  mapkey("yg", "#7Capture current page", () => {
    front.toggleStatus(false);
    setTimeout(() => {
      RUNTIME("captureVisibleTab", null, (response) => {
        front.toggleStatus(true);
        showPopup(`<img src='${response.dataUrl}' />`);
      });
    }, 500);
  });

  mapkey("gu", "#4Go up one path in the URL", () => {
    let pathname = location.pathname;
    if (pathname.length > 1) {
      pathname = pathname.endsWith("/") ? pathname.slice(0, pathname.length - 1) : pathname;
      let last = pathname.lastIndexOf("/");
      let repeats = RUNTIME.repeats;
      RUNTIME.repeats = 1;
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

  mapkey(";m", "#1mouse out last element", () => {
    hints.mouseoutLastElement();
  });

  mapkey(";pp", "#7Paste html on current page", () => {
    clipboard.read((response) => {
      removeAttributes(document.documentElement);
      removeAttributes(document.body);
      setSanitizedContent(
        document.head,
        "<title>" + new Date() + " updated by Surfingkeys</title>",
      );
      setSanitizedContent(document.body, response.data);
    });
  });

  function openGoogleTranslate() {
    if (window.getSelection()!.toString()) {
      searchSelectedWith("https://translate.google.com/?hl=en#auto/en/", false, false, "");
    } else {
      tabOpenLink(
        "https://translate.google.com/translate?js=n&sl=auto&tl=zh-CN&u=" + window.location.href,
      );
    }
  }
  mapkey(";t", "Translate selected text with google", () => {
    if (chrome.surfingkeys) {
      chrome.surfingkeys.translateCurrentPage();
    } else {
      openGoogleTranslate();
    }
  });
  vmapkey("t", "#9Translate selected text with google", openGoogleTranslate);

  mapkey("O", "#1Open detected links from text", () => {
    hints.create(
      runtime.conf.clickablePat,
      (element: any) => {
        window.location.assign(element[2]);
      },
      { statusLine: "Open detected links from text" },
    );
  });

  mapkey(
    ".",
    "#0Repeat last action",
    () => {
      // lastKeys in format: <keys in normal mode>[,(<mode name>\t<keys in this mode>)*], examples
      // ['se']
      // ['f', 'Hints\tBA']
      const lastKeys = runtime.conf.lastKeys;
      const firstKey = lastKeys[0];
      if (firstKey != null) {
        normal.feedkeys(firstKey);
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
                hints.feedkeys(hintKeys);
              }
            };
          };
          setTimeout(closureWrapper(), 120 + i * 100);
        }
      }
    },
    { repeatIgnore: true },
  );

  mapkey(
    "f",
    "#1Open a link, press SHIFT to flip overlapped hints, hold SPACE to hide hints",
    () => {
      hints.create("", hints.dispatchMouseClick);
    },
    { repeatIgnore: true },
  );

  mapkey(
    "v",
    "#9Toggle visual mode",
    () => {
      visual.toggle();
    },
    { repeatIgnore: true },
  );

  mapkey(
    "n",
    "#9Next found text",
    () => {
      visual.next(false);
    },
    { repeatIgnore: true },
  );

  mapkey(
    "N",
    "#9Previous found text",
    () => {
      visual.next(true);
    },
    { repeatIgnore: true },
  );

  mapkey(";fs", "#1Display hints to focus scrollable elements", () => {
    hints.create(normal.refreshScrollableElements(), hints.dispatchMouseClick);
  });

  vmapkey("q", "#9Translate word under cursor", () => {
    const w = getWordUnderCursor();
    const b = visual.getCursorPixelPos();
    front.performInlineQuery(
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

  mapkey("cq", "#7Query word with Hints", () => {
    hints.create(runtime.conf.textAnchorPat, (element: any) => {
      const word = element[2].trim().replace(/[^A-z].*$/, "");
      const b = getTextNodePos(element[0], element[1], element[2].length);
      front.performInlineQuery(
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

  map("g0", ":feedkeys 99E", 0, "#3Go to the first tab");
  map("g$", ":feedkeys 99R", 0, "#3Go to the last tab");
  mapkey("zr", "#3zoom reset", () => {
    RUNTIME("setZoom", {
      zoomFactor: 0,
    });
  });
  mapkey("zi", "#3zoom in", () => {
    RUNTIME("setZoom", {
      zoomFactor: 0.1,
    });
  });
  mapkey("zo", "#3zoom out", () => {
    RUNTIME("setZoom", {
      zoomFactor: -0.1,
    });
  });

  map("ZQ", ":quit");
  mapkey("ZZ", "#5Save session and quit", () => {
    RUNTIME("createSession", {
      name: "LAST",
      quitAfterSaved: true,
    });
  });
  mapkey("ZR", "#5Restore last session", () => {
    RUNTIME("openSession", {
      name: "LAST",
    });
  });
  map("u", "e");
  mapkey("af", "#1Open a link in active new tab", () => {
    hints.create("", hints.dispatchMouseClick, { tabbed: true, active: true });
  });
  mapkey("gf", "#1Open a link in non-active new tab", () => {
    hints.create("", hints.dispatchMouseClick, { tabbed: true, active: false });
  });
  mapkey("cf", "#1Open multiple links in a new tab", () => {
    hints.create("", hints.dispatchMouseClick, { multipleHits: true });
  });
  map("C", "gf");
  mapkey("<Ctrl-h>", "#1Mouse over elements.", () => {
    hints.create(
      "",
      (element: any) => {
        if (chrome.surfingkeys) {
          const r = element.getClientRects()[0];
          chrome.surfingkeys.sendMouseEvent(
            2,
            Math.round(r.x + r.width / 2),
            Math.round(r.y + r.height / 2),
            0,
          );
        } else {
          hints.dispatchMouseClick(element);
        }
      },
      { mouseEvents: ["mouseover"] },
    );
  });
  mapkey("<Ctrl-j>", "#1Mouse out elements.", () => {
    hints.create("", hints.dispatchMouseClick, { mouseEvents: ["mouseout"] });
  });
  mapkey("ya", "#7Copy a link URL to the clipboard", () => {
    hints.create("*[href]", (element: any) => {
      clipboard.write(element.href);
    });
  });
  mapkey("yma", "#7Copy multiple link URLs to the clipboard", () => {
    const linksToYank: string[] = [];
    hints.create(
      "*[href]",
      (element: any) => {
        linksToYank.push(element.href);
        clipboard.write(linksToYank.join("\n"));
      },
      { multipleHits: true },
    );
  });
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
  mapkey("yc", "#7Copy a column of a table", () => {
    hints.create(getTableColumnHeads(), (element: any) => {
      const column = Array.from(element.closest("table").querySelectorAll("tr")).map((tr: any) => {
        return tr.children.length > element.cellIndex
          ? tr.children[element.cellIndex].innerText
          : "";
      });
      clipboard.write(column.join("\n"));
    });
  });
  mapkey("ymc", "#7Copy multiple columns of a table", () => {
    let rows: string[] | null = null;
    hints.create(
      getTableColumnHeads(),
      (element: any) => {
        const column: string[] = Array.from(element.closest("table").querySelectorAll("tr")).map(
          (tr: any) => {
            return tr.children.length > element.cellIndex
              ? tr.children[element.cellIndex].innerText
              : "";
          },
        );
        if (!rows) {
          rows = column;
        } else {
          column.forEach((c, i) => {
            rows![i] += "\t" + c;
          });
        }
        clipboard.write(rows.join("\n"));
      },
      { multipleHits: true },
    );
  });
  mapkey("yq", "#7Copy pre text", () => {
    hints.create("pre", (element: any) => {
      clipboard.write(element.innerText);
    });
  });

  cmap("<ArrowDown>", "<Ctrl-n>");
  cmap("<ArrowUp>", "<Ctrl-p>");
  mapkey("q", "#1Click on an Image or a button", () => {
    hints.create("img, button", hints.dispatchMouseClick);
  });
  mapkey("<Alt-p>", "#3pin/unpin current tab", () => {
    RUNTIME("togglePinTab");
  });
  mapkey("<Alt-m>", "#3mute/unmute current tab", () => {
    RUNTIME("muteTab");
  });
  mapkey(
    "B",
    "#4Go one tab history back",
    () => {
      RUNTIME("historyTab", { backward: true });
    },
    { repeatIgnore: true },
  );
  mapkey(
    "F",
    "#4Go one tab history forward",
    () => {
      RUNTIME("historyTab", { backward: false });
    },
    { repeatIgnore: true },
  );
  mapkey("<Ctrl-6>", "#4Go to last used tab", () => {
    RUNTIME("goToLastTab");
  });
  mapkey(
    "gT",
    "#4Go to first activated tab",
    () => {
      RUNTIME("historyTab", { index: 0 });
    },
    { repeatIgnore: true },
  );
  mapkey(
    "gt",
    "#4Go to last activated tab",
    () => {
      RUNTIME("historyTab", { index: -1 });
    },
    { repeatIgnore: true },
  );
  mapkey(
    "gp",
    "#4Go to the playing tab",
    () => {
      RUNTIME("getTabs", { queryInfo: { audible: true } }, (response) => {
        if (response.tabs?.at(0)) {
          const tab = response.tabs[0];
          RUNTIME("focusTab", {
            windowId: tab.windowId,
            tabId: tab.id,
          });
        }
      });
    },
    { repeatIgnore: true },
  );
  mapkey(
    "S",
    "#4Go back in history",
    () => {
      history.go(-1);
    },
    { repeatIgnore: true },
  );
  mapkey(
    "D",
    "#4Go forward in history",
    () => {
      history.go(1);
    },
    { repeatIgnore: true },
  );
  mapkey("r", "#4Reload the page", () => {
    RUNTIME("reloadTab", { nocache: false });
  });
  mapkey("oi", "#8Open incognito window", () => {
    RUNTIME("openIncognito", {
      url: window.location.href,
    });
  });

  mapkey("H", "#8Open opened URL in current tab", () => {
    front.openOmnibar({ type: "TabURLs" });
  });
  mapkey("om", "#8Open URL from vim-like marks", () => {
    front.openOmnibar({ type: "VIMarks" });
  });
  mapkey(":", "#8Open commands", () => {
    front.openOmnibar({ type: "Commands" });
  });
  mapkey("yi", "#7Yank text of an input", () => {
    hints.create("input, textarea, select", (element: any) => {
      clipboard.write(element.value);
    });
  });
  mapkey("x", "#3Close current tab", () => {
    RUNTIME("closeTab");
  });
  mapkey(";w", "#2Focus top window", () => {
    top!.focus();
  });
  mapkey("cc", "#7Open selected link or link from clipboard", () => {
    if (window.getSelection()!.toString()) {
      tabOpenLink(window.getSelection()!.toString());
    } else {
      clipboard.read((response) => {
        tabOpenLink(response.data);
      });
    }
  });
  mapkey(";cq", "#7Clear all URLs in queue to be opened", () => {
    RUNTIME("clearQueueURLs");
  });
  mapkey("ys", "#7Copy current page's source", () => {
    const aa = document.documentElement.cloneNode(true);
    if (aa instanceof Element) {
      clipboard.write(aa.outerHTML);
    }
  });
  mapkey("yj", "#7Copy current settings", () => {
    RUNTIME(
      "getSettings",
      {
        key: "RAW",
      },
      (response) => {
        clipboard.write(JSON.stringify(response.settings, regExpReplacer, 4));
      },
    );
  });
  mapkey(";pj", "#7Restore settings data from clipboard", () => {
    clipboard.read((response) => {
      const result = v.safeParse(clipboardSettingsSchema, parseJsonSafe(response.data.trim()));
      if (!result.success) {
        showBanner("Clipboard does not contain valid settings data.");
        return;
      }
      RUNTIME("updateSettings", { settings: result.output });
    });
  });
  mapkey("yt", "#3Duplicate current tab", () => {
    RUNTIME("duplicateTab");
  });
  mapkey("yT", "#3Duplicate current tab in background", () => {
    RUNTIME("duplicateTab", { active: false });
  });
  mapkey("yy", "#7Copy current page's URL", () => {
    clipboard.write(window.location.href);
  });
  mapkey("yY", "#7Copy all tabs's url", () => {
    RUNTIME("getTabs", null, (response) => {
      clipboard.write(response.tabs.map((tab: any) => tab.url).join("\n"));
    });
  });
  mapkey("yh", "#7Copy current page's host", () => {
    const url = new URL(window.location.href);
    clipboard.write(url.host);
  });
  mapkey("yl", "#7Copy current page's title", () => {
    clipboard.write(document.title);
  });
  mapkey("yQ", "#7Copy all query history of OmniQuery.", () => {
    RUNTIME(
      "getSettings",
      {
        key: "OmniQueryHistory",
      },
      (response) => {
        clipboard.write(response.settings.OmniQueryHistory.join("\n"));
      },
    );
  });

  function getFormData(form: HTMLFormElement, format?: string): Record<string, any> | string {
    const formData = new FormData(form);
    if (format === "json") {
      const obj: Record<string, any> = {};

      formData.forEach((value: any, key) => {
        if (Object.hasOwn(obj, key)) {
          if (value.length) {
            const p = obj[key];
            if (p.constructor.name === "Array") {
              p.push(value);
            } else {
              obj[key] = [];
              if (p.length) {
                obj[key].push(p);
              }
              obj[key].push(value);
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
  mapkey("yf", "#7Copy form data in JSON on current page", () => {
    const fd: Record<string, unknown> = {};
    document.querySelectorAll("form").forEach((form) => {
      fd[generateFormKey(form)] = getFormData(form, "json");
    });
    clipboard.write(JSON.stringify(fd, null, 4));
  });
  mapkey(";pf", "#7Fill form with data from yf", () => {
    hints.create("form", (element: any) => {
      const formKey = generateFormKey(element);
      clipboard.read((response) => {
        const result = v.safeParse(clipboardFormsSchema, parseJsonSafe(response.data.trim()));
        const forms: Record<string, Record<string, unknown>> = result.success ? result.output : {};
        const fd = forms[formKey];
        if (fd) {
          element.querySelectorAll("input, textarea").forEach((ip: any) => {
            const value = fd[ip.name];
            if (Object.hasOwn(fd, ip.name) && ip.type !== "hidden") {
              if (ip.type === "radio") {
                const op = element.querySelector(
                  `input[name='${ip.name}'][value='${String(value)}']`,
                );
                if (op) {
                  op.checked = true;
                }
              } else if (Array.isArray(value)) {
                element.querySelectorAll(`input[name='${ip.name}']`).forEach((ip2: any) => {
                  ip2.checked = false;
                });
                value.forEach((v: any) => {
                  const op = element.querySelector(`input[name='${ip.name}'][value='${v}']`);
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
  mapkey("yp", "#7Copy form data for POST on current page", () => {
    const aa: Record<string, unknown>[] = [];
    document.querySelectorAll("form").forEach((form) => {
      const fd: Record<string, unknown> = {};
      fd[(form.method || "get") + "::" + form.action] = getFormData(form);
      aa.push(fd);
    });
    clipboard.write(JSON.stringify(aa, null, 4));
  });

  mapkey("g?", "#4Reload current page without query string(all parts after question mark)", () => {
    window.location.href = window.location.href.replace(/\?[^?]*$/, "");
  });
  mapkey("g#", "#4Reload current page without hash fragment", () => {
    window.location.href = window.location.href.replace(/#[^#]*$/, "");
  });
  mapkey("gU", "#4Go to root of current URL hierarchy", () => {
    window.location.href = window.location.origin;
  });
  mapkey("gxt", "#3Close tab on left", () => {
    RUNTIME("closeTabLeft");
  });
  mapkey("gxT", "#3Close tab on right", () => {
    RUNTIME("closeTabRight");
  });
  mapkey("gx0", "#3Close all tabs on left", () => {
    RUNTIME("closeTabsToLeft");
  });
  mapkey("gx$", "#3Close all tabs on right", () => {
    RUNTIME("closeTabsToRight");
  });
  mapkey("gxx", "#3Close all tabs except current one", () => {
    RUNTIME("tabOnly");
  });
  mapkey("gxp", "#3Close playing tab", () => {
    RUNTIME("closeAudibleTab");
  });
  mapkey(";e", "#11Edit Settings", () => {
    tabOpenLink("/options.html");
  });
  addSearchAlias(
    "g",
    "google",
    "https://www.google.com/search?q=",
    "s",
    "https://www.google.com/complete/search?client=chrome-omni&gs_ri=chrome-ext&oit=1&cp=1&pgcl=7&q=",
    (response: any) => {
      const result = v.safeParse(openSearchSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output[1] : [];
    },
  );
  addSearchAlias(
    "d",
    "duckduckgo",
    "https://duckduckgo.com/?q=",
    "s",
    "https://duckduckgo.com/ac/?q=",
    (response: any) => {
      const result = v.safeParse(duckduckgoSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output.map((r) => r.phrase) : [];
    },
  );
  addSearchAlias(
    "b",
    "baidu",
    "https://www.baidu.com/s?wd=",
    "s",
    "https://suggestion.baidu.com/su?cb=&wd=",
    (response: any) => {
      const res = response.text.match(/,s:\[("[^\]]+")]}/);
      return res ? res[1].replaceAll('"', "").split(",") : [];
    },
  );

  addSearchAlias(
    "e",
    "wikipedia",
    "https://en.wikipedia.org/wiki/",
    "s",
    "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&formatversion=2&namespace=0&limit=40&search=",
    (response: any) => {
      const result = v.safeParse(openSearchSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output[1] : [];
    },
  );
  addSearchAlias(
    "w",
    "bing",
    "https://www.bing.com/search?setmkt=en-us&setlang=en-us&q=",
    "s",
    "https://api.bing.com/osjson.aspx?query=",
    (response: any) => {
      const result = v.safeParse(openSearchSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output[1] : [];
    },
  );
  addSearchAlias("s", "stackoverflow", "https://stackoverflow.com/search?q=");
  addSearchAlias(
    "h",
    "github",
    "https://github.com/search?q=",
    "s",
    "https://api.github.com/search/repositories?order=desc&q=",
    (response: any) => {
      const result = v.safeParse(githubRepoSuggestSchema, parseJsonSafe(response.text));
      return result.success
        ? result.output.items.map((r) => ({ title: r.description, url: r.html_url }))
        : [];
    },
  );
  addSearchAlias(
    "y",
    "youtube",
    "https://www.youtube.com/results?search_query=",
    "s",
    "https://clients1.google.com/complete/search?client=youtube&ds=yt&callback=cb&q=",
    (response: any) => {
      const result = v.safeParse(
        youtubeSuggestSchema,
        parseJsonSafe(response.text.slice(9, response.text.length - 1)),
      );
      return result.success ? result.output[1].map((d) => d[0]) : [];
    },
  );

  const bn = getBrowserName();
  if (bn === "Firefox") {
    mapkey("on", "#3Open newtab", () => {
      tabOpenLink("about:blank");
    });
  } else if (bn === "Chrome") {
    mapkey("on", "#3Open newtab", () => {
      tabOpenLink("chrome://newtab/");
    });
    mapkey("ga", "#12Open Chrome About", () => {
      tabOpenLink("chrome://help/");
    });
    mapkey("gb", "#12Open Chrome Bookmarks", () => {
      tabOpenLink("chrome://bookmarks/");
    });
    mapkey("gc", "#12Open Chrome Cache", () => {
      tabOpenLink("chrome://cache/");
    });
    mapkey("gd", "#12Open Chrome Downloads", () => {
      tabOpenLink("chrome://downloads/");
    });
    mapkey("gh", "#12Open Chrome History", () => {
      tabOpenLink("chrome://history/");
    });
    mapkey("gk", "#12Open Chrome Cookies", () => {
      tabOpenLink("chrome://settings/cookies");
    });
    mapkey("ge", "#12Open Chrome Extensions", () => {
      tabOpenLink("chrome://extensions/");
    });
    mapkey(";i", "#12Open Chrome Inspect", () => {
      tabOpenLink("chrome://inspect/#devices");
    });
  }

  mapkey("X", "#3Restore closed tab", () => {
    RUNTIME("openLast");
  });

  mapkey("t", "#8Open a URL", () => {
    front.openOmnibar({ type: "URLs" });
  });
  mapkey("go", "#8Open a URL in current tab", () => {
    front.openOmnibar({ type: "URLs", tabbed: false });
  });
  mapkey("ox", "#8Open recently closed URL", () => {
    front.openOmnibar({ type: "RecentlyClosed" });
  });
  mapkey("b", "#8Open a bookmark", () => {
    front.openOmnibar({ type: "Bookmarks" });
  });
  mapkey(";x", "#3Close tabs by URL", () => {
    front.openOmnibar({ type: "CloseTabs" });
  });
  mapkey("ab", "#8Bookmark current page to selected folder", () => {
    const page = {
      url: window.location.href,
      title: document.title,
    };
    front.openOmnibar({ type: "AddBookmark", extra: page });
  });
  mapkey("oh", "#8Open URL from history", () => {
    front.openOmnibar({ type: "History" });
  });
  mapkey("W", "#3Move current tab to another window", () => {
    front.openOmnibar({ type: "Windows" });
  });
  mapkey(";gt", "#3Gather filtered tabs into current window", () => {
    front.openOmnibar({
      type: "Tabs",
      extra: {
        action: "gather",
      },
    });
  });
  mapkey(";gw", "#3Gather all tabs into current window", () => {
    RUNTIME("gatherWindows");
  });
  mapkey("<<", "#3Move current tab to left", () => {
    RUNTIME("moveTab", {
      step: -1,
    });
  });
  mapkey(">>", "#3Move current tab to right", () => {
    RUNTIME("moveTab", {
      step: 1,
    });
  });
  mapkey("yd", "#7Copy current downloading URL", () => {
    RUNTIME(
      "getDownloads",
      {
        query: { state: "in_progress" },
      },
      (response) => {
        const items = response.downloads.map((o: any) => {
          return o.url;
        });
        clipboard.write(items.join(","));
      },
    );
  });
  mapkey("gs", "#12View page source", () => {
    RUNTIME("viewSource", { tab: { tabbed: true } });
  });
  mapkey(";di", "#1Download image", () => {
    hints.create("img", (element: any) => {
      RUNTIME("download", {
        url: element.src,
      });
    });
  });
  mapkey(";j", "#12Close Downloads Shelf", () => {
    RUNTIME("closeDownloadsShelf", { clearHistory: true });
  });
  mapkey(";dh", "#13Delete history older than 30 days", () => {
    RUNTIME("deleteHistoryOlderThan", {
      days: 30,
    });
  });
  mapkey(";yh", "#13Yank histories", () => {
    RUNTIME("getHistory", {}, (response) => {
      clipboard.write(response.history.map((h: any) => h.url).join("\n"));
    });
  });
  mapkey(";ph", "#13Put histories from clipboard", () => {
    clipboard.read((response) => {
      RUNTIME("addHistories", { history: response.data.split("\n") });
    });
  });
  mapkey(";db", "#13Remove bookmark for current page", () => {
    RUNTIME("removeBookmark");
  });
}
