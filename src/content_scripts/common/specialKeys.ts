import KeyboardUtils from "./keyboardUtils";

/**
 * Special keystrokes (e.g. "<Esc>", "<Alt-s>") mapped to the keystroke aliases that trigger them.
 * Intentionally a mutable singleton: api.ts map/unmap and the front's addMapkey action add and
 * remove aliases at runtime.
 */
const specialKeys: Record<string, string[]> = {
  "<Alt-s>": ["<Alt-s>"], // hotkey to toggleBlocklist
  "<Esc>": ["<Esc>"],
};

/** Whether `keyToCheck` (an encoded keystroke) is one of the aliases registered for `specialKey`. */
function isSpecialKeyOf(specialKey: string, keyToCheck: string): boolean {
  const keys = specialKeys[specialKey];
  return keys != null && keys.includes(KeyboardUtils.decodeKeystroke(keyToCheck));
}

export { isSpecialKeyOf, specialKeys };
