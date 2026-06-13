import { Result } from "@praha/byethrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import optionsMain from "./options";

// Build the minimal DOM that options.ts reads at init time.
// All IDs match the options.html structure the module depends on.
function buildDOM(): void {
  document.body.innerHTML = `
    <div id="keyPicker" style="display:none">
      <div class="pressedKey"><kbd id="inputKey">&nbsp;</kbd></div>
    </div>
    <input id="advancedToggler" type="checkbox" />
    <span id="advancedTip"></span>
    <div id="basicSettings"></div>
    <div id="basicMappings"></div>
    <div id="advancedSetting" style="display:none"></div>
    <div id="searchAliases"></div>
    <div id="localPathForSettings" style="display:none"></div>
    <input id="localPath" type="text" value="" />
    <span class="infoPointer" for="infoTarget">?</span>
    <div id="infoTarget" style="display:none"></div>
    <script type="text/plain" id="sample">sample snippet</script>
    <input id="save_button" type="button" value="Save" />
    <div id="mappings_container">
      <textarea id="mappings" style="width:100%;height:400px;font-family:monospace;font-size:13px"></textarea>
    </div>
    <h3 id="resetSettings">Reset</h3>
  `;
}

// Minimal dependency stubs.
function makeRUNTIME() {
  return vi.fn(
    (_action: string, _args?: Record<string, unknown> | null, _cb?: (resp: any) => void) =>
      Result.succeed(undefined),
  );
}

function makeKeyboardUtils() {
  return {
    encodeKeystroke: (k: string) => k,
    decodeKeystroke: (k: string) => k,
  };
}

function makeMode() {
  // A minimal Mode-like constructor: returns an object with enough surface.
  return class FakeMode {
    name: string;
    container?: unknown;
    eventListeners: Record<string, (...args: any[]) => void> = {};

    constructor(name: string) {
      this.name = name;
    }

    addEventListener(evt: string, fn: (...args: any[]) => void) {
      this.eventListeners[evt] = fn;
      return this;
    }

    enter(..._args: unknown[]) {}
    exit(..._args: unknown[]) {}
  };
}

function makeCreateElementWithContent() {
  return (tag: string, content = "", attrs: Record<string, string> = {}): HTMLElement => {
    const el = document.createElement(tag);
    el.innerHTML = content;
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    return el;
  };
}

// options.ts init dispatches nothing, but several behaviors are triggered
// by DOM events.  Helper to invoke options and get the RUNTIME spy back.
function initOptions(runtimeSpy = makeRUNTIME()) {
  optionsMain(
    runtimeSpy,
    makeKeyboardUtils(),
    makeMode() as any,
    makeCreateElementWithContent(),
    () => "Chrome",
    (s: string) => s,
    (cb: (locale: (s: string) => string) => void) => cb((s) => s),
    (_title: string, _desc: string) => {},
    (elm: Element, str: string) => {
      elm.innerHTML = str;
    },
    (_msg: string, _timeout?: number) => {},
  );
  return runtimeSpy;
}

// Fire the surfingkeys:userSettingsLoaded event to simulate settings load.
function fireUserSettingsLoaded(settings: Record<string, unknown> = {}) {
  document.dispatchEvent(
    new CustomEvent("surfingkeys:userSettingsLoaded", {
      detail: {
        settings,
        disabledSearchAliases: {},
        frontCommand: (_req: unknown, cb: (r: any) => void) => cb({ aliases: {} }),
      },
    }),
  );
}

describe("options page initialization", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("calls RUNTIME to update settings with showAdvanced when the advanced toggler is clicked", () => {
    const RUNTIME = initOptions();
    // Check the toggler, then click it.
    const toggler = document.getElementById("advancedToggler") as HTMLInputElement;
    toggler.checked = true;
    toggler.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    expect(RUNTIME).toHaveBeenCalledWith(
      "updateSettings",
      { settings: { showAdvanced: true } },
      expect.any(Function),
    );
  });

  it("calls RUNTIME with showAdvanced=false when toggler is unchecked before click", () => {
    const RUNTIME = initOptions();
    const toggler = document.getElementById("advancedToggler") as HTMLInputElement;
    toggler.checked = false;
    toggler.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    expect(RUNTIME).toHaveBeenCalledWith(
      "updateSettings",
      { settings: { showAdvanced: false } },
      expect.any(Function),
    );
  });
});

describe("showAdvanced toggle behavior", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("showBanner is called with the error from RUNTIME callback when error occurs", () => {
    const showBanner = vi.fn();
    const RUNTIME = vi.fn((_action: string, _args: any, cb?: (r: any) => void) => {
      cb?.({ error: "something went wrong" });
      return Result.succeed(undefined);
    });

    optionsMain(
      RUNTIME as any,
      makeKeyboardUtils(),
      makeMode() as any,
      makeCreateElementWithContent(),
      () => "Chrome",
      (s: string) => s,
      (cb: (locale: (s: string) => string) => void) => cb((s) => s),
      (_title: string, _desc: string) => {},
      (elm: Element, str: string) => {
        elm.innerHTML = str;
      },
      showBanner,
    );

    const toggler = document.getElementById("advancedToggler") as HTMLInputElement;
    toggler.checked = true;
    toggler.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    expect(showBanner).toHaveBeenCalledWith("something went wrong", 3000);
  });
});

describe("resetSettings button", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("changes reset button text to a warning on first click", () => {
    initOptions();
    const btn = document.getElementById("resetSettings") as HTMLElement;
    btn.innerText = "Reset";
    btn.onclick!(new MouseEvent("click") as unknown as PointerEvent);
    expect(btn.innerText).toContain("WARNING");
  });

  it("calls RUNTIME resetSettings on the second click", () => {
    const RUNTIME = initOptions();
    const btn = document.getElementById("resetSettings") as HTMLElement;
    btn.innerText = "Reset";
    // First click shows warning.
    btn.onclick!(new MouseEvent("click") as unknown as PointerEvent);
    expect(RUNTIME).not.toHaveBeenCalledWith("resetSettings", expect.anything(), expect.anything());

    // Second click fires the reset.
    btn.onclick!(new MouseEvent("click") as unknown as PointerEvent);
    expect(RUNTIME).toHaveBeenCalledWith("resetSettings", null, expect.any(Function));
  });
});

describe("infoPointer toggle", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("toggles the target element from display:none to visible on click", () => {
    initOptions();
    const pointer = document.querySelector(".infoPointer") as HTMLElement;
    const target = document.getElementById("infoTarget") as HTMLElement;
    target.style.display = "none";

    pointer.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    expect(target.style.display).toBe("");
  });

  it("toggles the target element back to display:none when visible", () => {
    initOptions();
    const pointer = document.querySelector(".infoPointer") as HTMLElement;
    const target = document.getElementById("infoTarget") as HTMLElement;
    target.style.display = "";

    pointer.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    expect(target.style.display).toBe("none");
  });
});

describe("renderSettings", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("populates localPath input when settings contain a localPath", () => {
    initOptions();
    fireUserSettingsLoaded({ localPath: "/home/user/.surfingkeys.js" });

    const localPathInput = document.getElementById("localPath") as HTMLInputElement;
    expect(localPathInput.value).toBe("/home/user/.surfingkeys.js");
  });

  it("shows advanced setting div when showAdvanced is true (non-MV3)", () => {
    initOptions();
    fireUserSettingsLoaded({ showAdvanced: true });

    const advancedDiv = document.getElementById("advancedSetting") as HTMLElement;
    // show() sets style.display = ""
    expect(advancedDiv.style.display).toBe("");
  });

  it("hides advanced setting div and shows basic settings when showAdvanced is false", () => {
    initOptions();
    fireUserSettingsLoaded({ showAdvanced: false });

    const basicDiv = document.getElementById("basicSettings") as HTMLElement;
    const advancedDiv = document.getElementById("advancedSetting") as HTMLElement;
    expect(basicDiv.style.display).toBe("");
    expect(advancedDiv.style.display).toBe("none");
  });
});

describe("saveSettings via save_button", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("calls RUNTIME updateSettings with snippets when saving without a local path", () => {
    const RUNTIME = initOptions();
    // Settings must be loaded first so mappingsEditor is created.
    fireUserSettingsLoaded({});

    // Set a value in the textarea created for "mappings"
    const textarea = document.getElementById("mappings") as HTMLTextAreaElement;
    textarea.value = "api.mapkey('x', 'test', function(){});";

    const saveBtn = document.getElementById("save_button") as HTMLInputElement;
    saveBtn.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    expect(RUNTIME).toHaveBeenCalledWith("updateSettings", {
      settings: {
        snippets: "api.mapkey('x', 'test', function(){});",
        localPath: "",
      },
    });
  });

  it("calls RUNTIME loadSettingsFromUrl when a new localPath is set", () => {
    const RUNTIME = initOptions();
    fireUserSettingsLoaded({});

    const localPathInput = document.getElementById("localPath") as HTMLInputElement;
    localPathInput.value = "https://example.com/settings.js";

    const saveBtn = document.getElementById("save_button") as HTMLInputElement;
    saveBtn.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    expect(RUNTIME).toHaveBeenCalledWith(
      "loadSettingsFromUrl",
      { url: "https://example.com/settings.js" },
      expect.any(Function),
    );
  });
});

describe("getURIPath (via saveSettings)", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("prefixes a bare file path with file:///", () => {
    const RUNTIME = initOptions();
    fireUserSettingsLoaded({});

    const localPathInput = document.getElementById("localPath") as HTMLInputElement;
    // A bare absolute path gets converted to file:/// URI
    localPathInput.value = "/home/user/settings.js";

    const saveBtn = document.getElementById("save_button") as HTMLInputElement;
    saveBtn.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    expect(RUNTIME).toHaveBeenCalledWith(
      "loadSettingsFromUrl",
      { url: "file:///home/user/settings.js" },
      expect.any(Function),
    );
  });

  it("leaves an http URL unchanged", () => {
    const RUNTIME = initOptions();
    fireUserSettingsLoaded({});

    const localPathInput = document.getElementById("localPath") as HTMLInputElement;
    localPathInput.value = "http://example.com/settings.js";

    const saveBtn = document.getElementById("save_button") as HTMLInputElement;
    saveBtn.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    expect(RUNTIME).toHaveBeenCalledWith(
      "loadSettingsFromUrl",
      { url: "http://example.com/settings.js" },
      expect.any(Function),
    );
  });

  it("converts a Windows-style backslash path to file:/// with forward slashes", () => {
    const RUNTIME = initOptions();
    fireUserSettingsLoaded({});

    const localPathInput = document.getElementById("localPath") as HTMLInputElement;
    // Backslashes get replaced with forward slashes; leading / is dropped then file:/// is prepended
    localPathInput.value = String.raw`C:\Users\user\settings.js`;

    const saveBtn = document.getElementById("save_button") as HTMLInputElement;
    saveBtn.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    expect(RUNTIME).toHaveBeenCalledWith(
      "loadSettingsFromUrl",
      { url: "file:///C:/Users/user/settings.js" },
      expect.any(Function),
    );
  });
});

describe("Firefox-specific localPathForSettings display", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows #localPathForSettings when the browser is Firefox", () => {
    const localPathDiv = document.getElementById("localPathForSettings") as HTMLElement;
    localPathDiv.style.display = "none";

    optionsMain(
      makeRUNTIME() as any,
      makeKeyboardUtils(),
      makeMode() as any,
      makeCreateElementWithContent(),
      () => "Firefox",
      (s: string) => s,
      (cb: (locale: (s: string) => string) => void) => cb((s) => s),
      (_title: string, _desc: string) => {},
      (elm: Element, str: string) => {
        elm.innerHTML = str;
      },
      (_msg: string, _timeout?: number) => {},
    );

    expect(localPathDiv.style.display).toBe("");
  });

  it("does not show #localPathForSettings when the browser is Chrome", () => {
    const localPathDiv = document.getElementById("localPathForSettings") as HTMLElement;
    localPathDiv.style.display = "none";

    initOptions(); // uses Chrome

    expect(localPathDiv.style.display).toBe("none");
  });
});

describe("MV3 advanced toggler", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("disables the toggler when isMV3 is true and user scripts are not available", () => {
    initOptions();
    fireUserSettingsLoaded({ isMV3: true, isUserScriptsAvailable: false });

    const toggler = document.getElementById("advancedToggler") as HTMLInputElement;
    expect(toggler.disabled).toBe(true);
  });

  it("keeps toggler enabled when isMV3 is false", () => {
    initOptions();
    fireUserSettingsLoaded({ isMV3: false, showAdvanced: true });

    const toggler = document.getElementById("advancedToggler") as HTMLInputElement;
    // non-MV3 path does not set disabled
    expect(toggler.disabled).toBe(false);
  });

  it("updates the advancedTip text for MV3", () => {
    initOptions();
    fireUserSettingsLoaded({ isMV3: true, isUserScriptsAvailable: false });

    const tip = document.getElementById("advancedTip") as HTMLElement;
    expect(tip.innerText).toContain("Developer mode");
  });
});

describe("advancedToggler checked attribute", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("sets the checked attribute on the toggler when showAdvanced is true", () => {
    initOptions();
    fireUserSettingsLoaded({ showAdvanced: true });

    const toggler = document.getElementById("advancedToggler") as HTMLInputElement;
    expect(toggler.getAttribute("checked")).toBe("checked");
  });

  it("removes the checked attribute on the toggler when showAdvanced is false", () => {
    initOptions();
    // First set it, then clear it.
    fireUserSettingsLoaded({ showAdvanced: true });
    fireUserSettingsLoaded({ showAdvanced: false });

    const toggler = document.getElementById("advancedToggler") as HTMLInputElement;
    expect(toggler.getAttribute("checked")).toBeNull();
  });
});

describe("surfingkeys:defaultSettingsLoaded event", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("filters basicMappings to only those found in normal.mappings", () => {
    initOptions();

    const mockMapping = {
      meta: { annotation: "scroll down" },
    };
    const normalMock = {
      mappings: {
        find: (key: string) => (key === "j" ? mockMapping : null),
      },
    };

    document.dispatchEvent(
      new CustomEvent("surfingkeys:defaultSettingsLoaded", {
        detail: { normal: normalMock },
      }),
    );

    // After firing the event, trigger renderKeyMappings via userSettingsLoaded
    // so we can check the DOM output.
    fireUserSettingsLoaded({});

    const mappingsDiv = document.getElementById("basicMappings") as HTMLElement;
    // "j" was found, so it should appear; other unmapped keys should not.
    expect(mappingsDiv.innerHTML).toContain("scroll down");
  });
});

// A Mode factory that records every created instance so tests can retrieve
// named instances (e.g. "KeyPicker") without reaching into module internals.
function makeTrackingMode() {
  const instances: Map<string, any> = new Map();

  const ModeClass = class TrackingFakeMode {
    name: string;
    container?: unknown;
    eventListeners: Record<string, (...args: any[]) => void> = {};

    constructor(name: string) {
      this.name = name;
      instances.set(name, this);
    }

    addEventListener(evt: string, fn: (...args: any[]) => void) {
      this.eventListeners[evt] = fn;
      return this;
    }

    // The base stack-push enter the KeyPicker controller delegates to.
    enter(..._args: unknown[]) {}

    exit(..._args: unknown[]) {}
  };

  return { ModeClass, instances };
}

// Helper to fire userSettingsLoaded with an explicit frontCommand.
function fireUserSettingsLoadedWith(
  settings: Record<string, unknown>,
  frontCommand: (req: unknown, cb: (r: any) => void) => void,
) {
  document.dispatchEvent(
    new CustomEvent("surfingkeys:userSettingsLoaded", {
      detail: {
        settings,
        disabledSearchAliases: {},
        frontCommand,
      },
    }),
  );
}

describe("KeyPicker keydown: Escape hides the picker", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("hides the keyPicker div when Escape is pressed", () => {
    const { ModeClass, instances } = makeTrackingMode();

    optionsMain(
      makeRUNTIME() as any,
      makeKeyboardUtils(),
      ModeClass as any,
      makeCreateElementWithContent(),
      () => "Chrome",
      (s: string) => s,
      (cb: (locale: (s: string) => string) => void) => cb((s) => s),
      (_title: string, _desc: string) => {},
      (elm: Element, str: string) => {
        elm.innerHTML = str;
      },
      (_msg: string, _timeout?: number) => {},
    );

    const kp = instances.get("KeyPicker");
    expect(kp).toBeDefined();

    const keyPickerDiv = document.getElementById("keyPicker") as HTMLElement;
    keyPickerDiv.style.display = "";

    const event: Record<string, unknown> = { keyCode: 27, sk_keyName: "<Esc>" };
    kp.eventListeners["keydown"]?.(event);

    // hide() should have set display to "none".
    expect(keyPickerDiv.style.display).toBe("none");
    expect(event["sk_stopPropagation"]).toBe(true);
  });
});

describe("KeyPicker keydown: regular character appends to key", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("appends a character to the key display when a regular key is pressed", () => {
    const { ModeClass, instances } = makeTrackingMode();

    optionsMain(
      makeRUNTIME() as any,
      makeKeyboardUtils(),
      ModeClass as any,
      makeCreateElementWithContent(),
      () => "Chrome",
      (s: string) => s,
      (cb: (locale: (s: string) => string) => void) => cb((s) => s),
      (_title: string, _desc: string) => {},
      (elm: Element, str: string) => {
        elm.innerHTML = str;
      },
      (_msg: string, _timeout?: number) => {},
    );

    const kp = instances.get("KeyPicker");
    // Press 'a' — sk_keyName length is 1 so it goes to the char-append branch.
    const event: Record<string, unknown> = { keyCode: 65, sk_keyName: "a" };
    kp.eventListeners["keydown"]?.(event);

    const inputKey = document.getElementById("inputKey") as HTMLElement;
    // htmlEncode("a") = "a", setSanitizedContent puts it in innerHTML.
    expect(inputKey.innerHTML).toBe("a");
    expect(event["sk_stopPropagation"]).toBe(true);
  });
});

// Render the basic-mapping kbd for `origin` through the real options flow, so its onclick is wired
// to KeyPicker.enter exactly as production does. Driving enter by clicking the returned element
// exercises the controller's public surface without reaching into module internals.
function renderBasicMappingKbd(origin: string, userSettings: Record<string, unknown> = {}) {
  const RUNTIME = makeRUNTIME();
  const { ModeClass, instances } = makeTrackingMode();

  optionsMain(
    RUNTIME as any,
    makeKeyboardUtils(),
    ModeClass as any,
    makeCreateElementWithContent(),
    () => "Chrome",
    (s: string) => s,
    (cb: (locale: (s: string) => string) => void) => cb((s) => s),
    (_title: string, _desc: string) => {},
    (elm: Element, str: string) => {
      elm.innerHTML = str;
    },
    (_msg: string, _timeout?: number) => {},
  );

  document.dispatchEvent(
    new CustomEvent("surfingkeys:defaultSettingsLoaded", {
      detail: {
        normal: {
          mappings: { find: (k: string) => (k === origin ? { meta: { annotation: "" } } : null) },
        },
      },
    }),
  );
  fireUserSettingsLoaded(userSettings);

  const basicMappingsDiv = document.getElementById("basicMappings") as HTMLElement;
  const kbd = basicMappingsDiv.querySelector(`kbd[data-origin="${origin}"]`) as HTMLElement;
  return { RUNTIME, instances, kbd };
}

describe("KeyPicker enter: show keyPicker and populate from kbd element", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the keyPicker div and sets the displayed key from the clicked kbd", () => {
    const { kbd } = renderBasicMappingKbd("j");
    const keyPickerDiv = document.getElementById("keyPicker") as HTMLElement;
    keyPickerDiv.style.display = "none";
    // The rendered kbd shows its key; jsdom needs innerText set for enter()'s getter to read it.
    kbd.innerText = "j";

    kbd.click();

    expect(keyPickerDiv.style.display).toBe("");
    const inputKey = document.getElementById("inputKey") as HTMLElement;
    // "j" is the key text taken from the clicked kbd.
    expect(inputKey.innerHTML).toBe("j");
  });

  it("clears the key when the kbd innerText is the disabled-placeholder '🚫'", () => {
    const { kbd } = renderBasicMappingKbd("j", { basicMappings: { j: "" } });
    kbd.innerText = "🚫";

    kbd.click();

    // After clearing, showKey() with empty _key sets innerHTML to "&nbsp;"
    const inputKey = document.getElementById("inputKey") as HTMLElement;
    expect(inputKey.innerHTML).toBe("&nbsp;");
  });
});

describe("KeyPicker keydown: Enter saves the mapping", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("calls RUNTIME updateSettings with basicMappings when Enter is pressed after picking a key", () => {
    const { RUNTIME, instances, kbd } = renderBasicMappingKbd("j");
    kbd.innerText = "j";

    kbd.click();

    const kp = instances.get("KeyPicker");
    // Press 'k' to change the binding away from its origin, then Enter to persist it.
    kp.eventListeners["keydown"]?.({ keyCode: 65, sk_keyName: "k" });
    kp.eventListeners["keydown"]?.({ keyCode: 13, sk_keyName: "<Enter>" });

    // RUNTIME should have been called with updateSettings containing basicMappings.
    expect(RUNTIME).toHaveBeenCalledWith(
      "updateSettings",
      expect.objectContaining({
        settings: expect.objectContaining({ basicMappings: expect.any(Object) }),
      }),
    );
  });
});

describe("KeyPicker keydown: Backspace removes last character", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("removes the last character of the accumulated key on Backspace", () => {
    const { ModeClass, instances } = makeTrackingMode();

    optionsMain(
      makeRUNTIME() as any,
      makeKeyboardUtils(),
      ModeClass as any,
      makeCreateElementWithContent(),
      () => "Chrome",
      (s: string) => s,
      (cb: (locale: (s: string) => string) => void) => cb((s) => s),
      (_title: string, _desc: string) => {},
      (elm: Element, str: string) => {
        elm.innerHTML = str;
      },
      (_msg: string, _timeout?: number) => {},
    );

    const kp = instances.get("KeyPicker");

    // Type two characters: 'a' then 'b'.
    kp.eventListeners["keydown"]?.({ keyCode: 65, sk_keyName: "a" });
    kp.eventListeners["keydown"]?.({ keyCode: 66, sk_keyName: "b" });

    let inputKey = document.getElementById("inputKey") as HTMLElement;
    expect(inputKey.innerHTML).toBe("ab");

    // Backspace should remove the last character.
    kp.eventListeners["keydown"]?.({ keyCode: 8, sk_keyName: "<BS>" });

    inputKey = document.getElementById("inputKey") as HTMLElement;
    expect(inputKey.innerHTML).toBe("a");
  });
});

describe("renderSettings with snippets", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("populates the mappings textarea with snippets from settings", () => {
    initOptions();
    fireUserSettingsLoaded({ snippets: "// my custom settings" });

    const textarea = document.getElementById("mappings") as HTMLTextAreaElement;
    expect(textarea.value).toBe("// my custom settings");
  });

  it("falls back to the sample snippet when settings.snippets is empty", () => {
    initOptions();
    fireUserSettingsLoaded({ snippets: "" });

    const textarea = document.getElementById("mappings") as HTMLTextAreaElement;
    // The sample element contains "sample snippet".
    expect(textarea.value).toBe("sample snippet");
  });
});

describe("renderSearchAlias: aliases with object prompt", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses alias.prompt.html when prompt is an object with an html property", async () => {
    initOptions();

    // Fire settings loaded with a frontCommand that returns an alias with an object prompt.
    fireUserSettingsLoadedWith({}, (_req: unknown, cb: (r: any) => void) => {
      cb({
        aliases: {
          g: { prompt: { html: "<img src='google.png'/>" } },
        },
      });
    });

    // renderSearchAlias resolves a promise asynchronously.
    await new Promise((r) => setTimeout(r, 0));

    // jsdom normalizes the HTML (single → double quotes, no self-closing slash);
    // assert via the parsed DOM instead.
    const searchAliases = document.getElementById("searchAliases") as HTMLElement;
    const img = searchAliases.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("google.png");
  });

  it("uses alias.prompt string directly when prompt is a plain string", async () => {
    initOptions();

    fireUserSettingsLoadedWith({}, (_req: unknown, cb: (r: any) => void) => {
      cb({
        aliases: {
          b: { prompt: "Bing" },
        },
      });
    });

    await new Promise((r) => setTimeout(r, 0));

    const searchAliases = document.getElementById("searchAliases") as HTMLElement;
    expect(searchAliases.innerHTML).toContain("Bing");
  });

  it("toggling a search alias checkbox calls RUNTIME to update disabledSearchAliases", async () => {
    // Directly invoke renderSearchAlias by capturing the frontCommand from the
    // userSettingsLoaded event, bypassing the cross-test listener accumulation issue.
    //
    // We wire a RUNTIME spy and a frontCommand that delivers one alias, then
    // trigger the module by calling optionsMain + fireUserSettingsLoadedWith.
    // Because multiple optionsMain listeners may exist from prior tests, the
    // searchAliases container is cleared first so only this test's appended
    // checkboxes are present.
    const RUNTIME = makeRUNTIME();

    optionsMain(
      RUNTIME as any,
      makeKeyboardUtils(),
      makeMode() as any,
      makeCreateElementWithContent(),
      () => "Chrome",
      (s: string) => s,
      (cb: (locale: (s: string) => string) => void) => cb((s) => s),
      (_title: string, _desc: string) => {},
      (elm: Element, str: string) => {
        elm.innerHTML = str;
      },
      (_msg: string, _timeout?: number) => {},
    );

    // Clear the container so only aliases from this optionsMain instance appear.
    document.getElementById("searchAliases")!.innerHTML = "";

    // Deliver one alias via the event; the module appends it after the promise resolves.
    fireUserSettingsLoadedWith({}, (_req: unknown, cb: (r: any) => void) => {
      cb({
        aliases: {
          g: { prompt: "Google" },
        },
      });
    });

    await new Promise((r) => setTimeout(r, 0));

    // Pick the last checkbox added (from our optionsMain, which appended after the clear).
    const checkboxes = Array.from(
      document.querySelectorAll("#searchAliases input"),
    ) as HTMLInputElement[];
    expect(checkboxes.length).toBeGreaterThan(0);
    // Trigger the last one — that's the one registered by our RUNTIME-spy optionsMain.
    const lastCheckbox = checkboxes.at(-1)!;
    lastCheckbox.onchange!(new Event("change") as unknown as Event);

    expect(RUNTIME).toHaveBeenCalledWith(
      "updateSettings",
      expect.objectContaining({
        settings: expect.objectContaining({ disabledSearchAliases: expect.any(Object) }),
      }),
    );
  });
});

describe("saveSettings: loadSettingsFromUrl callback updates snippets", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("updates the textarea with snippets returned from loadSettingsFromUrl", () => {
    const RUNTIME = vi.fn((action: string, _args: any, cb?: (r: any) => void) => {
      if (action === "loadSettingsFromUrl") {
        cb?.({ status: "200 OK", snippets: "// remote settings", renderKeyMappings: () => {} });
      }
      return Result.succeed(undefined);
    });

    optionsMain(
      RUNTIME as any,
      makeKeyboardUtils(),
      makeMode() as any,
      makeCreateElementWithContent(),
      () => "Chrome",
      (s: string) => s,
      (cb: (locale: (s: string) => string) => void) => cb((s) => s),
      (_title: string, _desc: string) => {},
      (elm: Element, str: string) => {
        elm.innerHTML = str;
      },
      (_msg: string, _timeout?: number) => {},
    );

    fireUserSettingsLoaded({});

    const localPathInput = document.getElementById("localPath") as HTMLInputElement;
    localPathInput.value = "https://example.com/remote-settings.js";

    const saveBtn = document.getElementById("save_button") as HTMLInputElement;
    saveBtn.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    const textarea = document.getElementById("mappings") as HTMLTextAreaElement;
    expect(textarea.value).toBe("// remote settings");
  });

  it("falls back to the sample snippet when the remote response has no snippets and the editor is empty", () => {
    const RUNTIME = vi.fn((action: string, _args: any, cb?: (r: any) => void) => {
      if (action === "loadSettingsFromUrl") {
        // No snippets in the response, and the editor was left empty → the
        // `else if (settingsCode === "")` arm restores the sample snippet.
        cb?.({ status: "200 OK", renderKeyMappings: () => {} });
      }
      return Result.succeed(undefined);
    });

    optionsMain(
      RUNTIME as any,
      makeKeyboardUtils(),
      makeMode() as any,
      makeCreateElementWithContent(),
      () => "Chrome",
      (s: string) => s,
      (cb: (locale: (s: string) => string) => void) => cb((s) => s),
      (_title: string, _desc: string) => {},
      (elm: Element, str: string) => {
        elm.innerHTML = str;
      },
      (_msg: string, _timeout?: number) => {},
    );

    fireUserSettingsLoaded({});
    const textarea = document.getElementById("mappings") as HTMLTextAreaElement;
    textarea.value = ""; // empty editor

    const localPathInput = document.getElementById("localPath") as HTMLInputElement;
    localPathInput.value = "https://example.com/empty-settings.js";

    const saveBtn = document.getElementById("save_button") as HTMLInputElement;
    saveBtn.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    // The sample snippet (from #sample in buildDOM) is restored.
    expect(textarea.value).toBe("sample snippet");
  });
});

describe("advancedToggler onclick — success arm shows/hides the advanced panels", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reveals the advanced panel and marks the toggler checked when the update succeeds", () => {
    const RUNTIME = vi.fn((_action: string, _args: any, cb?: (r: any) => void) => {
      // No error in the response → the success arm calls showAdvanced(newFlag).
      cb?.({});
      return Result.succeed(undefined);
    });
    initOptions(RUNTIME);

    const toggler = document.getElementById("advancedToggler") as HTMLInputElement;
    toggler.checked = true;
    toggler.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    const advancedDiv = document.getElementById("advancedSetting") as HTMLElement;
    const basicDiv = document.getElementById("basicSettings") as HTMLElement;
    expect(advancedDiv.style.display).toBe("");
    expect(basicDiv.style.display).toBe("none");
    expect(toggler.getAttribute("checked")).toBe("checked");
  });
});

describe("infoPointer onclick — missing target is a no-op", () => {
  beforeEach(() => {
    buildDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does nothing when the 'for' target element does not exist", () => {
    initOptions();
    const pointer = document.querySelector(".infoPointer") as HTMLElement;
    // Point at a non-existent id → getElementById returns null → early return,
    // no toggling and no exception.
    pointer.setAttribute("for", "does-not-exist");

    pointer.onclick!(new MouseEvent("click") as unknown as PointerEvent);

    // The real infoTarget is untouched (still hidden as built).
    const target = document.getElementById("infoTarget") as HTMLElement;
    expect(target.style.display).toBe("none");
  });
});
