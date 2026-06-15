/**
 * The pending repeat count shared across the engine: keymap sets it from the typed digit prefix and
 * runs the action that many times, normal-mode scroll multiplies its delta by it, and the messaging
 * layer forwards it to the background for actions that can only repeat there. It is plain shared
 * state with no WebExtension dependency, kept here (rather than on the RUNTIME function) so the
 * keymap stays free of the chrome messaging seam.
 */
const repeatCount = { value: 1 };

export { repeatCount };
