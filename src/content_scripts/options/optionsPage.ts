import KeyboardUtils from "@sk/core/keyboardUtils";
import { ModeHandle } from "@sk/core/mode";
import {
  createElementWithContent,
  getBrowserName,
  htmlEncode,
  setSanitizedContent,
  showBanner,
} from "@sk/core/utils";

import { initL10n, reportIssue } from "../common/platform-utils";
import { RUNTIME } from "../common/runtime";
import { start } from "../content";
import optionsMain from "./options";

// Bootstrap for the options page. The old build loaded the content script onto
// pages/options.html and let it lazy-import the options module; under WXT the
// page owns its own entry, so it renders the settings editor and then runs the
// content-script mode system (so Surfingkeys keys work while configuring)
// directly — no content.js <script> include, no runtime import() indirection.
optionsMain(
  RUNTIME,
  KeyboardUtils,
  ModeHandle,
  createElementWithContent,
  getBrowserName,
  htmlEncode,
  initL10n,
  reportIssue,
  setSanitizedContent,
  showBanner,
);
start({});
