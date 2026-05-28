import { defineBackground } from "wxt/utils/define-background";

import { chromeSpecifics } from "../src/background/chrome";
import { firefoxSpecifics } from "../src/background/firefox";
import { start } from "../src/background/start";

// Listeners must register synchronously on service-worker startup (MV3), so the
// browser specifics are static imports and start() runs in the entry body — no
// dynamic import.
export default defineBackground(() => {
  start(import.meta.env.FIREFOX ? firefoxSpecifics : chromeSpecifics);
});
