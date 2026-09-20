import type { UserScriptApi, UserScriptSettings } from "./api";

declare global {
  /** The Surfingkeys api available to a settings snippet. */
  const api: UserScriptApi;
  /** The settings a snippet overrides by assignment. */
  const settings: UserScriptSettings;
}
