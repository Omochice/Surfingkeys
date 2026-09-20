import type { FeatureGroup } from "@sk/core/featureGroup";
import { createElementWithContent } from "@sk/core/utils";
import { RUNTIME } from "@sk/messaging/runtime";

import { buildOmnibarResult } from "./omnibarResult";
import type { OmnibarResult } from "./omnibarResult";

type NormalLike = { feedkeys(keys: string): void };
type CommandFn = (
  name: string,
  annotation: string,
  handler: (args: string[]) => void | boolean,
  group?: FeatureGroup,
) => void;
type OmnibarLike = {
  listResults<T>(
    items: readonly T[] | null | undefined,
    renderItem: (item: T) => OmnibarResult | null | undefined,
  ): void;
  listWords(words: string[]): void;
};

const createCommands = (normal: NormalLike, command: CommandFn, omnibar: OmnibarLike): void => {
  command("feedkeys", "feed mapkeys", (args) => {
    normal.feedkeys(args[0] ?? "");
  });
  command(
    "quit",
    "quit chrome",
    () => {
      RUNTIME("quit");
    },
    "sessions",
  );
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
        omnibar.listResults(Object.keys(response.settings.sessions), (name) => {
          return buildOmnibarResult(createElementWithContent("li", name), {});
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
      omnibar.listResults(response.queueURLs, (url) => {
        return buildOmnibarResult(createElementWithContent("li", url), {});
      });
    });
  });
  command("clearQueueURLs", "clear URLs in queue waiting for open", () => {
    RUNTIME("clearQueueURLs");
  });
  command("timeStamp", "print time stamp in human readable format", (args) => {
    const date = new Date(Number.parseInt(args[0] ?? ""));
    omnibar.listWords([date.toString()]);
  });
};

export default createCommands;
