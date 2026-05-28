import createClipboard from "./clipboard";
import createHints from "./hints";
import createInsert from "./insert";
import createNormal from "./normal";
import createVisual from "./visual";

/**
 * The front surface consumed by {@link createAPI} and createDefaultMappings. The concrete front
 * differs per site — content.ts wires the messaging stub from createFront, the iframe wires its own
 * Front mode — and both are dynamic (`any`) objects, so it is described structurally here as the
 * union of the methods those two consumers actually call.
 */
export type FrontLike = {
  executeCommand(cmd: string): void;
  addSearchAlias?: (...args: any[]) => void;
  removeSearchAlias(alias: string): void;
  openOmnibar(args: unknown): void;
  openOmniquery(args: unknown): void;
  registerInlineQuery: (...args: any[]) => void;
  setHintsCharacters?: (chars: string) => void;
  chooseTab(): void;
  showUsage(): void;
  toggleStatus(visible: boolean): void;
  performInlineQuery(
    word: string,
    pos: { top: number; left: number; height: number; width: number },
    cb: (pos: unknown, queryResult: unknown) => void,
  ): void;
};

/**
 * The set of modes wired together for one content/frontend context. This is the single object
 * passed to {@link createAPI} and createDefaultMappings, replacing the positional god-function
 * argument lists. The mode members are the concrete factory return types; only `front` is
 * structural for the reason above.
 */
export type ModeContext = {
  clipboard: ReturnType<typeof createClipboard>;
  insert: ReturnType<typeof createInsert>;
  normal: ReturnType<typeof createNormal>;
  hints: ReturnType<typeof createHints>;
  visual: ReturnType<typeof createVisual>;
  front: FrontLike;
};

/** The modes shared by both sites, before the site-specific front is attached. */
export type BaseModes = Omit<ModeContext, "front">;

/**
 * Build the modes shared by content.ts and the iframe — clipboard, insert, normal (entered onto the
 * mode stack), hints, visual — in the one canonical order, replacing the wiring that was duplicated
 * across the two entry points. The caller supplies the site-specific front to complete a
 * {@link ModeContext}: content wires createFront, the iframe wires its own Front mode.
 */
function createModeGraph(): BaseModes {
  const clipboard = createClipboard();
  const insert = createInsert();
  const normal = createNormal(insert);
  normal.enter();
  const hints = createHints(insert, normal, clipboard);
  const visual = createVisual(clipboard, hints);
  return { clipboard, insert, normal, hints, visual };
}

export default createModeGraph;
