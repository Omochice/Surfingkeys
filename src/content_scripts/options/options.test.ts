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
    #keydownHandler?: (...args: any[]) => void;

    constructor(name: string) {
      this.name = name;
    }

    addEventListener(evt: string, fn: (...args: any[]) => void) {
      this.eventListeners[evt] = fn;
      if (evt === "keydown") this.#keydownHandler = fn;
      return this;
    }

    enter(..._args: unknown[]) {}
    exit(..._args: unknown[]) {}

    // Allow tests to simulate a keydown on this mode instance.
    fireKeydown(event: Record<string, unknown>) {
      this.#keydownHandler?.(event);
    }
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
    localPathInput.value = "C:\\Users\\user\\settings.js";

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
