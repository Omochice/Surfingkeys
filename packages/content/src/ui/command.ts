import type { FeatureGroup } from "@sk/core/featureGroup";
import { reportError } from "@sk/core/report";
import { createElementWithContent } from "@sk/core/utils";
import { request, RUNTIME } from "@sk/messaging/runtime";

import { buildOmnibarResult } from "./omnibarResult";
import type { OmnibarResult } from "./omnibarResult";

type NormalLike = { feedkeys(keys: string): void };
type CommandFn = (
  name: string,
  handler: (args: string[]) => void | boolean,
  options: { annotation: string; group?: FeatureGroup },
) => void;
type OmnibarLike = {
  listResults<T>(
    items: readonly T[] | null | undefined,
    renderItem: (item: T) => OmnibarResult | null | undefined,
  ): void;
  listWords(words: string[]): void;
};

const createCommands = (normal: NormalLike, command: CommandFn, omnibar: OmnibarLike): void => {
  command(
    "feedkeys",
    (args) => {
      normal.feedkeys(args[0] ?? "");
    },
    { annotation: "feed mapkeys" },
  );
  command(
    "quit",
    () => {
      RUNTIME("quit");
    },
    { annotation: "quit chrome", group: "sessions" },
  );
  command(
    "clearHistory",
    (args) => {
      const key = args[0];
      if (key == null) {
        return;
      }
      const update: Record<string, unknown[]> = { [key]: [] };
      RUNTIME("updateInputHistory", update);
    },
    { annotation: "clearHistory <find|cmd|...>" },
  );
  command(
    "listSession",
    () => {
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
    },
    { annotation: "list session" },
  );
  command(
    "createSession",
    (args) => {
      RUNTIME("createSession", {
        name: args[0],
      });
    },
    { annotation: "createSession [name]" },
  );
  command(
    "deleteSession",
    (args) => {
      RUNTIME("deleteSession", {
        name: args[0],
      });
      return true; // to close omnibar after the command executed.
    },
    { annotation: "deleteSession [name]" },
  );
  command(
    "openSession",
    (args) => {
      RUNTIME("openSession", {
        name: args[0],
      });
    },
    { annotation: "openSession [name]" },
  );
  command(
    "listQueueURLs",
    () => {
      request<{ queueURLs: string[] }>("getQueueURLs").then((response) => {
        omnibar.listResults(response.queueURLs, (url) => {
          return buildOmnibarResult(createElementWithContent("li", url), {});
        });
      }, reportError);
    },
    { annotation: "list URLs in queue waiting for open" },
  );
  command(
    "clearQueueURLs",
    () => {
      RUNTIME("clearQueueURLs");
    },
    { annotation: "clear URLs in queue waiting for open" },
  );
  command(
    "timeStamp",
    (args) => {
      const date = new Date(Number.parseInt(args[0] ?? ""));
      omnibar.listWords([date.toString()]);
    },
    { annotation: "print time stamp in human readable format" },
  );
};

export default createCommands;
