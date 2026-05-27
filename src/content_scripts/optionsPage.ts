import { RUNTIME } from "./common/runtime.js";
import KeyboardUtils from "./common/keyboardUtils";
import Mode from "./common/mode";
import {
    createElementWithContent,
    getBrowserName,
    htmlEncode,
    initL10n,
    reportIssue,
    setSanitizedContent,
    showBanner,
} from "./common/utils.js";
import optionsMain from "./options.js";
import { start } from "./content.js";

// Bootstrap for the options page. The old build loaded the content script onto
// pages/options.html and let it lazy-import the options module; under WXT the
// page owns its own entry, so it renders the settings editor and then runs the
// content-script mode system (so Surfingkeys keys work while configuring)
// directly — no content.js <script> include, no runtime import() indirection.
optionsMain(
    RUNTIME,
    KeyboardUtils,
    Mode,
    createElementWithContent,
    getBrowserName,
    htmlEncode,
    initL10n,
    reportIssue,
    setSanitizedContent,
    showBanner,
);
start({});
