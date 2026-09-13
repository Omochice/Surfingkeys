/**
 * The pending repeat count shared across the engine. It lives here rather than on the RUNTIME
 * function so that the keymap stays free of the chrome messaging seam.
 */
const repeatCount = { value: 1 };

export { repeatCount };
