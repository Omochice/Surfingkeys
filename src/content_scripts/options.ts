import { Result } from "@praha/byethrow";

import { type ChromeRuntimeError, reportOnFail } from "../common/result";
import { reportError } from "./common/report";
import type { StoredSettings } from "./common/runtime";

type RuntimeFn = (
  action: string,
  args?: Record<string, unknown> | null,
  callback?: (resp: any) => void,
) => Result.Result<void, ChromeRuntimeError>;
type KeyboardUtilsLike = {
  encodeKeystroke(k: string): string;
  decodeKeystroke(k: string): string;
};
type ModeCtor = new (name: string) => any;

export default function (
  RUNTIME: RuntimeFn,
  KeyboardUtils: KeyboardUtilsLike,
  Mode: ModeCtor,
  createElementWithContent: (
    tag: string,
    content?: string,
    attrs?: Record<string, string>,
  ) => HTMLElement,
  getBrowserName: () => string,
  htmlEncode: (s: string) => string,
  initL10n: (cb: (locale: (s: string) => string) => void) => void,
  reportIssue: (title: string, desc: string) => void,
  setSanitizedContent: (elm: Element, str: string) => void,
  showBanner: (msg: string, timeout?: number) => void,
): void {
  let mappingsEditor: any = null;
  function createMappingEditor(elmId: string): any {
    const existing = document.getElementById(elmId);
    let textarea: HTMLTextAreaElement;
    if (existing && existing.tagName === "TEXTAREA") {
      textarea = existing as HTMLTextAreaElement;
    } else {
      textarea = document.createElement("textarea");
      textarea.id = elmId;
      textarea.style.width = "100%";
      textarea.style.height = "400px";
      textarea.style.fontFamily = "monospace";
      textarea.style.fontSize = "13px";
      if (existing) {
        existing.parentNode!.replaceChild(textarea, existing);
      }
    }

    const self = new Mode("mappingsEditor");

    self.container = textarea;
    self.setValue = (v: string, cursorPos: number) => {
      textarea.value = v;
      if (cursorPos === -1) {
        textarea.setSelectionRange(0, 0);
      }
    };
    self.getValue = () => {
      return textarea.value;
    };

    return self;
  }

  if (getBrowserName() === "Firefox") {
    (document.querySelector("#localPathForSettings") as HTMLElement).style.display = "";
  }

  const basicSettingsDiv = document.getElementById("basicSettings") as HTMLElement;
  const basicMappingsDiv = document.getElementById("basicMappings") as HTMLElement;
  const advancedSettingDiv = document.getElementById("advancedSetting") as HTMLElement;
  const advancedToggler = document.getElementById("advancedToggler") as HTMLInputElement;
  function showAdvanced(flag?: boolean): void {
    if (flag) {
      basicSettingsDiv.hide();
      advancedSettingDiv.show();
      advancedToggler.setAttribute("checked", "checked");
    } else {
      basicSettingsDiv.show();
      advancedSettingDiv.hide();
      advancedToggler.removeAttribute("checked");
    }
  }

  let localPathSaved = "";
  const localPathInput = document.getElementById("localPath") as HTMLInputElement;
  const sample = (document.getElementById("sample") as HTMLElement).innerHTML;
  function renderSettings(rs: StoredSettings): void {
    if (rs.isMV3) {
      (document.getElementById("advancedTip") as HTMLElement).innerText =
        "First turn on 'Developer mode' in chrome://extensions/, then turn on 'Allow User Scripts' in Surfingkeys extension details, then toggle the 'Advanced mode' flag here.";
      advancedToggler.disabled = !rs.isUserScriptsAvailable;
      showAdvanced(rs.isUserScriptsAvailable && rs.showAdvanced);
    } else {
      showAdvanced(rs.showAdvanced);
    }
    if (rs.localPath) {
      localPathInput.value = rs.localPath;
      localPathSaved = rs.localPath;
    }
    if (rs.snippets && rs.snippets.length) {
      mappingsEditor.setValue(rs.snippets, -1);
    } else {
      mappingsEditor.setValue(sample, -1);
    }
  }

  advancedToggler.onclick = () => {
    const newFlag = advancedToggler.checked;
    reportOnFail(
      RUNTIME(
        "updateSettings",
        {
          settings: {
            showAdvanced: newFlag,
          },
        },
        (resp) => {
          if (resp.error) {
            showBanner(resp.error, 3000);
          } else {
            showAdvanced(newFlag);
          }
        },
      ),
      reportError,
    );
  };
  const resetBtn = document.getElementById("resetSettings") as HTMLElement;
  resetBtn.onclick = () => {
    if (resetBtn.innerText === "Reset") {
      resetBtn.innerText =
        "WARNING! This will clear all your settings. Click this again to continue.";
    } else {
      reportOnFail(
        RUNTIME("resetSettings", null, (response) => {
          renderSettings(response.settings);
          renderKeyMappings(response.settings);
          showBanner("Settings reset", 1000);
        }),
        reportError,
      );
    }
  };

  const infoPointer = document.querySelector(".infoPointer") as HTMLElement;
  infoPointer.onclick = () => {
    const f = document.getElementById(infoPointer.getAttribute("for")!) as HTMLElement;
    if (f.style.display === "none") {
      f.style.display = "";
    } else {
      f.style.display = "none";
    }
  };

  function getURIPath(fn: string): string {
    if (fn.length && !/^\w+:\/\/\w+/i.test(fn) && fn.indexOf("file:///") === -1) {
      fn = fn.replace(/\\/g, "/");
      if (fn[0] === "/") {
        fn = fn.substr(1);
      }
      fn = "file:///" + fn;
    }
    return fn;
  }
  function saveSettings(): void {
    const settingsCode = mappingsEditor.getValue();
    const localPath = getURIPath(localPathInput.value.trim());
    if (localPath.length && localPath !== localPathSaved) {
      reportOnFail(
        RUNTIME(
          "loadSettingsFromUrl",
          {
            url: localPath,
          },
          (res) => {
            showBanner(res.status + " to load settings from " + localPath, 5000);
            renderKeyMappings(res);
            if (res.snippets && res.snippets.length) {
              localPathSaved = localPath;
              mappingsEditor.setValue(res.snippets, -1);
            } else if (settingsCode === "") {
              mappingsEditor.setValue(sample, -1);
            }
          },
        ),
        reportError,
      );
    } else {
      reportOnFail(
        RUNTIME("updateSettings", {
          settings: {
            snippets: settingsCode,
            localPath: getURIPath(localPathInput.value),
          },
        }),
        reportError,
      );

      showBanner("Settings saved", 1000);
    }
  }
  (document.getElementById("save_button") as HTMLElement).onclick = saveSettings;

  let basicMappings: any[] = [
    "d",
    "R",
    "f",
    "E",
    "e",
    "x",
    "gg",
    "j",
    "/",
    "n",
    "r",
    "k",
    "S",
    "C",
    "on",
    "G",
    "v",
    "i",
    ";e",
    "og",
    "g0",
    "t",
    "<Ctrl-6>",
    "yy",
    "g$",
    "D",
    "ob",
    "X",
    "sg",
    "cf",
    "yv",
    "yt",
    "N",
    "l",
    "cc",
    "$",
    "yf",
    "w",
    "0",
    "yg",
    "ow",
    "cs",
    "b",
    "om",
    "ya",
    "h",
    "gU",
    "W",
    "B",
    "F",
    ";j",
  ];

  document.addEventListener("surfingkeys:defaultSettingsLoaded", (evt) => {
    const { normal } = (evt as CustomEvent).detail;
    basicMappings = basicMappings
      .map((w) => {
        const binding = normal.mappings.find(KeyboardUtils.encodeKeystroke(w));
        if (binding) {
          return {
            origin: w,
            annotation: binding.meta.annotation,
          };
        } else {
          return null;
        }
      })
      .filter((m) => m !== null);
  });

  function renderSearchAlias(frontCommand: any, disabledSearchAliases: Record<string, any>): void {
    new Promise<Record<string, any>>((r) => {
      const getSearchAliases = () => {
        frontCommand(
          {
            action: "getSearchAliases",
          },
          (response: any) => {
            if (Object.keys(response.aliases).length > 0) {
              r(response.aliases);
            } else {
              setTimeout(getSearchAliases, 300);
            }
          },
        );
      };
      getSearchAliases();
    }).then((aliases) => {
      const allAliases: Record<string, { prompt: string; checked: string }> = {};
      for (const key in aliases) {
        const alias = aliases[key];
        if (alias === undefined) {
          continue;
        }
        // The omnibar prompt is either a plain label or an `{ html }` icon (the search-engine
        // image); the options row shows the label text or the icon markup respectively.
        const raw = alias.prompt;
        const prompt = raw && typeof raw === "object" ? raw.html : raw;
        allAliases[key] = { prompt, checked: "checked" };
      }
      for (const key in disabledSearchAliases) {
        const prompt = disabledSearchAliases[key];
        if (prompt !== undefined) {
          allAliases[key] = { prompt, checked: "" };
        }
      }
      for (const key in allAliases) {
        const entry = allAliases[key];
        if (entry === undefined) {
          continue;
        }
        const { prompt, checked } = entry;
        const elm = createElementWithContent(
          "div",
          `<div class='remove'><input type="checkbox" ${checked} /></div><span class='prompt'>${prompt}</span>`,
        );
        document.querySelector("#searchAliases")!.appendChild(elm);

        (elm.querySelector("input") as HTMLInputElement).onchange = () => {
          if (Object.prototype.hasOwnProperty.call(disabledSearchAliases, key)) {
            delete disabledSearchAliases[key];
          } else {
            disabledSearchAliases[key] = prompt;
          }

          reportOnFail(
            RUNTIME("updateSettings", {
              settings: {
                disabledSearchAliases,
              },
            }),
            reportError,
          );
        };
      }
    });
  }

  function renderKeyMappings(rs: StoredSettings): void {
    initL10n((locale) => {
      const customization = basicMappings.map((w) => {
        let newKey = w.origin;
        if (rs.basicMappings && Object.prototype.hasOwnProperty.call(rs.basicMappings, w.origin)) {
          newKey = rs.basicMappings[w.origin];
        }
        return `<div>
                    <span class=annotation>${locale(w.annotation)}</span>
                    <span class=kbd-span><kbd data-origin="${w.origin}" data-custom="${newKey}">${newKey ? htmlEncode(newKey) : "🚫"}</kbd></span>
                </div>`;
      });

      setSanitizedContent(basicMappingsDiv, customization.join(""));
      basicMappingsDiv.querySelectorAll("kbd").forEach((d) => {
        (d as HTMLElement).onclick = () => {
          KeyPicker.enter(d);
        };
      });
    });
  }

  document.addEventListener("surfingkeys:userSettingsLoaded", (evt) => {
    const { settings, disabledSearchAliases, frontCommand } = (evt as CustomEvent).detail;
    mappingsEditor = createMappingEditor("mappings");
    renderSettings(settings);
    if ("error" in settings) {
      showBanner(settings.error, 5000);
    }
    renderSearchAlias(frontCommand, disabledSearchAliases || {});
    renderKeyMappings(settings);
  });

  const KeyPicker = (() => {
    const self = new Mode("KeyPicker");

    function showKey() {
      let s = htmlEncode(_key);
      if (!s) {
        s = "&nbsp;";
      }
      setSanitizedContent(document.getElementById("inputKey")!, s);
    }

    let _key = "";
    const keyPickerDiv = document.getElementById("keyPicker") as HTMLElement;
    self.addEventListener("keydown", (event: any) => {
      if (event.keyCode === 27) {
        keyPickerDiv.hide();
        self.exit();
      } else if (event.keyCode === 8) {
        let ek = KeyboardUtils.encodeKeystroke(_key);
        ek = ek.substr(0, ek.length - 1);
        _key = KeyboardUtils.decodeKeystroke(ek);
        showKey();
      } else if (event.keyCode === 13) {
        keyPickerDiv.hide();
        self.exit();
        setSanitizedContent(_elm, _key !== "" ? htmlEncode(_key) : "🚫");
        _elm.dataset["custom"] = _key;
        const realDefMap: Record<string, string> = {};
        Array.from(basicMappingsDiv.querySelectorAll("kbd")).forEach((m) => {
          const el = m as HTMLElement;
          const n = el.dataset["custom"];
          if (el.dataset["origin"] !== n) {
            realDefMap[el.dataset["origin"]!] = n!;
          }
        });
        reportOnFail(
          RUNTIME("updateSettings", {
            settings: {
              basicMappings: realDefMap,
            },
          }),
          reportError,
        );
      } else {
        if (event.sk_keyName.length > 1) {
          const keyStr = JSON.stringify(
            {
              metaKey: event.metaKey,
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              shiftKey: event.shiftKey,
              keyCode: event.keyCode,
              code: event.code,
              composed: event.composed,
              key: event.key,
            },
            null,
            4,
          );
          reportIssue(`Unrecognized key event: ${event.sk_keyName}`, keyStr);
        } else {
          _key += KeyboardUtils.decodeKeystroke(event.sk_keyName);
          showKey();
        }
      }
      event.sk_stopPropagation = true;
    });

    let _elm: any;
    const _enter = self.enter;
    self.enter = (elm: any) => {
      _enter.call(self);

      _key = elm.innerText;
      if (_key === "🚫") {
        _key = "";
      }

      showKey();
      keyPickerDiv.show();
      _elm = elm;
    };

    return self;
  })();
}
