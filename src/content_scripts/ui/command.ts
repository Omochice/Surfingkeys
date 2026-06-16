import { createElementWithContent } from "@sk/core/utils";

import { RUNTIME } from "../common/runtime";

type NormalLike = { feedkeys(keys: string): void };
type CommandFn = (
  name: string,
  annotation: string,
  handler: (args: string[]) => void | boolean,
) => void;
type OmnibarLike = {
  // The renderer's return is passed through to the omnibar's result store. The real omnibar
  // expects its OmnibarResult rows there, while the session/queue commands below still hand it
  // raw <li> elements (a leftover from the pre-Solid list), so the slot is typed pass-through.
  listResults(items: unknown[], renderer: (s: unknown) => unknown): void;
  listWords(words: string[]): void;
};

const createCommands = (normal: NormalLike, command: CommandFn, omnibar: OmnibarLike): void => {
  command("feedkeys", "feed mapkeys", (args) => {
    normal.feedkeys(args[0] ?? "");
  });
  command("quit", "#5quit chrome", () => {
    RUNTIME("quit");
  });
  command("clearHistory", "clearHistory <find|cmd|...>", (args) => {
    const key = args[0];
    if (key == null) {
      return;
    }
    const update: Record<string, unknown[]> = { [key]: [] };
    RUNTIME("updateInputHistory", update);
  });
  command("listSession", "list session", () => {
    RUNTIME(
      "getSettings",
      {
        key: "sessions",
      },
      (response: { settings: { sessions: Record<string, unknown> } }) => {
        omnibar.listResults(Object.keys(response.settings.sessions), (s) => {
          return createElementWithContent("li", String(s));
        });
      },
    );
  });
  command("createSession", "createSession [name]", (args) => {
    RUNTIME("createSession", {
      name: args[0],
    });
  });
  command("deleteSession", "deleteSession [name]", (args) => {
    RUNTIME("deleteSession", {
      name: args[0],
    });
    return true; // to close omnibar after the command executed.
  });
  command("openSession", "openSession [name]", (args) => {
    RUNTIME("openSession", {
      name: args[0],
    });
  });
  command("listQueueURLs", "list URLs in queue waiting for open", () => {
    RUNTIME("getQueueURLs", null, (response: { queueURLs: string[] }) => {
      omnibar.listResults(response.queueURLs, (s) => {
        return createElementWithContent("li", String(s));
      });
    });
  });
  command("clearQueueURLs", "clear URLs in queue waiting for open", () => {
    RUNTIME("clearQueueURLs");
  });
  command("timeStamp", "print time stamp in human readable format", (args) => {
    const dt = new Date(Number.parseInt(args[0] ?? ""));
    omnibar.listWords([dt.toString()]);
  });
};

export default createCommands;
