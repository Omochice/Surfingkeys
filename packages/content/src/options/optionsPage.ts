import { initL10n, reportIssue } from "@sk/adapter/platform-utils";
import KeyboardUtils from "@sk/core/keyboardUtils";
import { ModeHandle } from "@sk/core/mode";
import {
  createElementWithContent,
  getBrowserName,
  htmlEncode,
  setSanitizedContent,
  showBanner,
} from "@sk/core/utils";
import { notify, request } from "@sk/messaging/runtime";

import { start } from "../content";
import optionsMain from "./options";

optionsMain({
  notify,
  request,
  KeyboardUtils,
  ModeHandle,
  createElementWithContent,
  getBrowserName,
  htmlEncode,
  initL10n,
  reportIssue,
  setSanitizedContent,
  showBanner,
});
start({});
