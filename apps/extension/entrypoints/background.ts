import { chromeSpecifics } from "@sk/background/chrome";
import { firefoxSpecifics } from "@sk/background/firefox";
import { start } from "@sk/background/start";
import { defineBackground } from "wxt/utils/define-background";

// Listeners must register synchronously on service-worker startup (MV3), so the
// browser specifics are static imports and start() runs in the entry body — no
// dynamic import.
export default defineBackground(() => {
  start(import.meta.env.FIREFOX ? firefoxSpecifics : chromeSpecifics);
});
