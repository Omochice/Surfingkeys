// `surfingkeys` is an optional companion native API injected onto the `chrome`
// global in environments that ship it. It is not part of the standard extension
// API typed by @types/chrome, so it is augmented onto that namespace here.
declare namespace chrome {
  const surfingkeys:
    | {
        translateCurrentPage(): void;
        sendMouseEvent(type: number, x: number, y: number, button: number): void;
      }
    | undefined;
}
