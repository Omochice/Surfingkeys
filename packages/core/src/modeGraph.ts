import createClipboard from "./clipboard";
import type { EngineEnv } from "./engineEnv";
import createHints from "./hints";
import createInsert from "./insert";
import createNormal from "./normal";
import createVisual from "./visual";

type SharedFront = {
  openOmnibar(args: unknown): void;
  chooseTab(): void;
  showUsage(): void;
  toggleStatus(visible: boolean): void;
};

/**
 * Front members operating on the hosting web page, which the iframe front — running inside the
 * extension's own UI page — has no access to, so it omits them.
 */
type ContentOnlyFront = {
  executeCommand(cmd: string): void;
  addSearchAlias?: (
    alias: string,
    prompt: string,
    search_url: string,
    suggestion_url?: string,
    callback?: (response: unknown, request: unknown) => unknown,
    options?: { skipMaps?: boolean; favicon_url?: string },
  ) => void;
  removeSearchAlias(alias: string): void;
  // Forwarded verbatim to a dynamic front method and an any-typed action registry; a narrower
  // parameter would break either the assignment from the real front or the forwarding target.
  // eslint-disable-next-line typescript/no-explicit-any
  registerInlineQuery: (...args: any[]) => void;
  setHintsCharacters?: (chars: string) => void;
  performInlineQuery(
    word: string,
    pos: { top: number; left: number; height: number; width: number },
    cb: (pos: unknown, queryResult: unknown) => void,
  ): void;
};

type FrontLike = SharedFront & Partial<ContentOnlyFront>;

/** The set of modes wired together for one content/frontend context. */
export type ModeContext = {
  clipboard: ReturnType<typeof createClipboard>;
  insert: ReturnType<typeof createInsert>;
  normal: ReturnType<typeof createNormal>;
  hints: ReturnType<typeof createHints>;
  visual: ReturnType<typeof createVisual>;
  front: FrontLike;
};

type BaseModes = Omit<ModeContext, "front">;

/**
 * Build every mode of a {@link ModeContext} except the site-specific front, with normal entered onto
 * the mode stack.
 */
function createModeGraph(env: EngineEnv): BaseModes {
  const clipboard = createClipboard(env);
  const insert = createInsert(env);
  const normal = createNormal(insert, env);
  normal.enter();
  const hints = createHints(insert, normal, clipboard);
  const visual = createVisual(clipboard, hints, env);
  return { clipboard, insert, normal, hints, visual };
}

export default createModeGraph;
