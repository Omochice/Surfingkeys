type KeyEventLike = {
  keyCode: number;
  key?: string;
  code?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  /** Legacy, non-standard; only present on very old Chrome. */
  keyIdentifier?: string;
};

const specialKeys = [
  "Esc",
  "Space",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Backspace",
  "Enter",
  "Tab",
  "Delete",
  "End",
  "Home",
  "Insert",
  "NumLock",
  "PageDown",
  "PageUp",
  "Pause",
  "ScrollLock",
  "CapsLock",
  "PrintScreen",
  "Escape",
  "Hyper",
];

function detectPlatform(): string {
  if (typeof navigator !== "undefined") {
    if (navigator.platform.indexOf("Mac") !== -1) {
      return "Mac";
    }
    if (navigator.userAgent.indexOf("Linux") !== -1) {
      return "Linux";
    }
  }
  return "Windows";
}

// <flag: always 1><flag: 1 bit, 0 for visible keys, 1 for invisible keys><key: 8 bits><mod: 4 bits>
function encodeOne(s: string, k: string): string {
  let mod = 0;
  if (s.indexOf("Ctrl-") !== -1) mod |= 1;
  if (s.indexOf("Alt-") !== -1) mod |= 2;
  if (s.indexOf("Meta-") !== -1) mod |= 4;
  if (s.indexOf("Shift-") !== -1) mod |= 8;

  let code: number;
  if (k.length > 1) {
    code = 256 + specialKeys.indexOf(k);
  } else {
    code = k.charCodeAt(0);
  }
  code = 8192 + (code << 4) + mod;
  return String.fromCharCode(code);
}

export default class KeyboardUtils {
  static specialKeys = specialKeys;
  static platform = detectPlatform();

  static keyCodesMac: Record<string, [string, string]> = {
    Minus: ["-", "_"],
    Equal: ["=", "+"],
    BracketLeft: ["[", "{"],
    BracketRight: ["]", "}"],
    Backslash: ["\\", "|"],
    Semicolon: [";", ":"],
    Quote: ["'", '"'],
    Comma: [",", "<"],
    Period: [".", ">"],
    Slash: ["/", "?"],
  };

  static keyCodes: Record<string, number> = {
    ESC: 27,
    backspace: 8,
    deleteKey: 46,
    enter: 13,
    ctrlEnter: 10,
    space: 32,
    shiftKey: 16,
    ctrlKey: 17,
    f1: 112,
    f12: 123,
    comma: 188,
    tab: 9,
    downArrow: 40,
    upArrow: 38,
  };

  static modifierKeys: Record<number, string> = {
    16: "Shift",
    17: "Ctrl",
    18: "Alt",
    91: "Meta",
    92: "Meta",
    93: "ContextMenu",
    229: "Process",
  };

  static keyNames: Record<number, string> = {
    8: "Backspace",
    9: "Tab",
    12: "NumLock",
    27: "Esc",
    32: "Space",
    46: "Delete",
  };

  static keyIdentifierCorrectionMap: Record<string, [string, string]> = {
    "U+00C0": ["U+0060", "U+007E"],
    "U+0030": ["U+0030", "U+0029"],
    "U+0031": ["U+0031", "U+0021"],
    "U+0032": ["U+0032", "U+0040"],
    "U+0033": ["U+0033", "U+0023"],
    "U+0034": ["U+0034", "U+0024"],
    "U+0035": ["U+0035", "U+0025"],
    "U+0036": ["U+0036", "U+005E"],
    "U+0037": ["U+0037", "U+0026"],
    "U+0038": ["U+0038", "U+002A"],
    "U+0039": ["U+0039", "U+0028"],
    "U+00BD": ["U+002D", "U+005F"],
    "U+00BB": ["U+003D", "U+002B"],
    "U+00DB": ["U+005B", "U+007B"],
    "U+00DD": ["U+005D", "U+007D"],
    "U+00DC": ["U+005C", "U+007C"],
    "U+00BA": ["U+003B", "U+003A"],
    "U+00DE": ["U+0027", "U+0022"],
    "U+00BC": ["U+002C", "U+003C"],
    "U+00BE": ["U+002E", "U+003E"],
    "U+00BF": ["U+002F", "U+003F"],
  };

  static getKeyChar(event: KeyEventLike): string {
    let character: string;
    if (event.keyCode in KeyboardUtils.modifierKeys) {
      return "";
    }
    const namedKey = KeyboardUtils.keyNames[event.keyCode];
    if (namedKey != null) {
      character = namedKey;
    } else {
      character = event.key || "";
      if (["Shift", "Meta", "Alt", "Ctrl"].indexOf(character) !== -1) {
        character = "";
      }
      if (!character) {
        if (event.keyIdentifier) {
          // keep for chrome version below 52
          if (event.keyIdentifier.slice(0, 2) !== "U+") {
            character = event.keyIdentifier;
          } else {
            let keyIdentifier = event.keyIdentifier;
            const corrected = KeyboardUtils.keyIdentifierCorrectionMap[keyIdentifier];
            if (
              (KeyboardUtils.platform === "Windows" || KeyboardUtils.platform === "Linux") &&
              corrected
            ) {
              keyIdentifier = event.shiftKey ? corrected[1] : corrected[0];
            }
            const unicodeKeyInHex = "0x" + keyIdentifier.slice(2);
            character = String.fromCharCode(parseInt(unicodeKeyInHex));
            character = event.shiftKey ? character : character.toLowerCase();
          }
        }
      } else if (
        character.charCodeAt(0) > 127 || // Alt-s is ß under Mac
        character === "Dead" //            Alt-i is Dead under Mac
      ) {
        if (event.keyCode < 127) {
          character = String.fromCharCode(event.keyCode);
          character = event.shiftKey ? character : character.toLowerCase();
        } else if (event.code != null) {
          const macCodes = KeyboardUtils.keyCodesMac[event.code];
          if (macCodes) {
            // Alt-/ or Alt-?
            character = macCodes[event.shiftKey ? 1 : 0];
          }
        }
      } else if (character === "Unidentified") {
        // for IME on
        character = "";
      }
    }
    if (event.shiftKey && character.length > 1) {
      character = "Shift-" + character;
    }
    if (character.length > 0) {
      if (event.metaKey) character = "Meta-" + character;
      if (event.altKey) character = "Alt-" + character;
      if (event.ctrlKey) character = "Ctrl-" + character;
    }
    if (character.length > 1) {
      character = `<${character}>`;
    }
    if (KeyboardUtils.decodeKeystroke(KeyboardUtils.encodeKeystroke(character)) === character) {
      character = KeyboardUtils.encodeKeystroke(character);
    }
    return character;
  }

  static isWordChar(event: { keyCode: number }): boolean {
    return (
      (event.keyCode < 123 && event.keyCode >= 97) ||
      (event.keyCode < 91 && event.keyCode >= 65) ||
      (event.keyCode < 58 && event.keyCode >= 48)
    );
  }

  static encodeKeystroke(s: string): string {
    const ekp = /<(?:Ctrl-)?(?:Alt-)?(?:Meta-)?(?:Shift-)?([^>]+|.)>/g;
    let mtches: RegExpExecArray | null;
    let ret = "";
    let lastIndex = 0;
    while ((mtches = ekp.exec(s)) !== null) {
      const captured = mtches[1];
      if (captured == null) {
        continue;
      }
      ret += s.slice(lastIndex, mtches.index);
      ret += encodeOne(mtches[0], captured);
      lastIndex = ekp.lastIndex;
    }
    ret += s.slice(lastIndex);
    return ret;
  }

  static decodeKeystroke(s: string): string {
    let ret = "";
    for (const ch of s) {
      let r = ch.charCodeAt(0);
      if (r > 8192) {
        r = r - 8192;
        const flag = r >> 12;
        const key = (r % 4096) >> 4;
        const mod = r & 15;
        let decoded = flag ? specialKeys[key % 256] : String.fromCharCode(key);
        if (mod & 8) decoded = "Shift-" + decoded;
        if (mod & 4) decoded = "Meta-" + decoded;
        if (mod & 2) decoded = "Alt-" + decoded;
        if (mod & 1) decoded = "Ctrl-" + decoded;
        ret += "<" + decoded + ">";
      } else {
        ret += ch;
      }
    }
    return ret;
  }
}
