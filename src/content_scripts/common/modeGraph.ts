import createClipboard from "./clipboard";
import createInsert from "./insert";
import createNormal from "./normal";
import createHints from "./hints";
import createVisual from "./visual";

/**
 * The front surface consumed by {@link createAPI} and createDefaultMappings.
 * The concrete front differs per site — content.ts wires the messaging stub
 * from createFront, the iframe wires its own Front mode — and both are dynamic
 * (`any`) objects, so it is described structurally here as the union of the
 * methods those two consumers actually call.
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
 * The set of modes wired together for one content/frontend context. This is the
 * single object passed to {@link createAPI} and createDefaultMappings, replacing
 * the positional god-function argument lists. The mode members are the concrete
 * factory return types; only `front` is structural for the reason above.
 */
export type ModeContext = {
    clipboard: ReturnType<typeof createClipboard>;
    insert: ReturnType<typeof createInsert>;
    normal: ReturnType<typeof createNormal>;
    hints: ReturnType<typeof createHints>;
    visual: ReturnType<typeof createVisual>;
    front: FrontLike;
};
