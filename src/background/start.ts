import { Result } from "@praha/byethrow";
import * as v from "valibot";

import { domApiError } from "../common/result";
import { createBookmarkHandlers } from "./bookmarks";
import { createHistoryHandlers } from "./history";
import { request } from "./request";
import { createSettings } from "./settings";
import { createTabs } from "./tabs";

/**
 * A background message handler, dispatched by `message.action`. It resolves to the response
 * payload: a returned value is sent as the synchronous response, while a returned promise is
 * awaited and its resolved value sent asynchronously (the dispatcher settles even on rejection).
 * Extracted background units export a `Record<string, MessageHandler>` map that the composition
 * root registers into the dispatch registry.
 */
export type MessageHandler = (
  message: any,
  sender?: any,
  sendResponse?: (result: any) => void,
) => any;

/**
 * The fixed-shape subset of settings the background keeps in memory. Settings only ever updates
 * keys already present here (the `updateSettings` loop guards with `Object.hasOwn(conf, k)`), so
 * the shape never grows beyond these five fields.
 */
export type BackgroundConf = {
  focusAfterClosed?: string;
  tabsMRUOrder?: boolean;
  newTabPosition?: string;
  showTabIndices?: boolean;
  interceptedErrors?: unknown[];
};

// GitHub gist API responses are external data; each parsed body is validated so
// the fields consumed below carry real types instead of any.
const gistListSchema = v.array(
  v.object({
    id: v.string(),
    description: v.nullable(v.string()),
    files: v.record(v.string(), v.unknown()),
  }),
);
const createdGistSchema = v.object({ id: v.string() });
const gistCommentSchema = v.object({ body: v.string() });
// GitHub returns gist comment ids as integers (unlike the gist id, which is a
// hex string), so accept both and normalize to string for use in request URLs.
const gistCommentListSchema = v.array(v.object({ id: v.union([v.string(), v.number()]) }));

// Request payloads for the standalone background handlers cross the
// chrome.runtime boundary, so each is validated before its fields are used.
const setIconSchema = v.object({ status: v.optional(v.string()) });
const requestSchema = v.object({
  url: v.string(),
  headers: v.optional(v.record(v.string(), v.string())),
  data: v.optional(v.string()),
});
const urlSchema = v.object({ url: v.string() });
const closeDownloadsShelfSchema = v.object({ clearHistory: v.optional(v.boolean()) });
const downloadSchema = v.object({
  url: v.string(),
  filename: v.optional(v.string()),
  saveAs: v.optional(v.boolean()),
});
const removeURLSchema = v.object({ uid: v.union([v.string(), v.array(v.string())]) });
const textSchema = v.object({ text: v.string() });
const tokenSchema = v.object({ token: v.string() });
const commentIndexSchema = v.object({ index: v.number() });
const editCommentSchema = v.object({ index: v.number(), content: v.string() });

const Gist = (() => {
  const self: any = {};

  // A 200 response with an empty or malformed body still throws in JSON.parse,
  // which would skip the settle that each helper relies on and re-hang the
  // runtime sender. Treat an unparseable body the same as a request failure.
  const parseGist = (text: string): any | undefined => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  async function _initGist(token: string, magic_word: string): Promise<string> {
    const auth = { Authorization: "token " + token };
    const r = await request("https://api.github.com/gists", auth);
    if (Result.isFailure(r)) {
      // Signal failure with an empty gist id so the awaiting handler still
      // settles instead of leaving the runtime sender hung forever.
      return "";
    }
    const gists = v.safeParse(gistListSchema, parseGist(r.value));
    if (!gists.success) {
      return "";
    }
    let gist = "";
    gists.output.forEach((g) => {
      if (g.description === magic_word && Object.hasOwn(g.files, magic_word)) {
        gist = g.id;
      }
    });
    if (gist !== "") {
      return gist;
    }
    const r2 = await request(
      "https://api.github.com/gists",
      auth,
      `{ "description": "${magic_word}", "public": false, "files": { "${magic_word}": { "content": "${magic_word}" } } }`,
    );
    // Same hang trap as above: resolve with an empty gist id on failure
    // (request error or unparseable body) so the sender never waits.
    const created = Result.isSuccess(r2)
      ? v.safeParse(createdGistSchema, parseGist(r2.value))
      : undefined;
    return created?.success ? created.output.id : "";
  }

  let _token: string;
  let _gist = "";
  let _comments: any[] = [];
  self.initGist = async (token: string): Promise<string> => {
    if (_token === token && _gist !== "") {
      return _gist;
    }
    _token = token;
    _gist = await _initGist(_token, "cloudboard");
    return _gist;
  };

  // The Gist comment helpers below always resolve, even on request failure:
  // their consumers (`self.readComment`/`self.editComment`) hand the result
  // straight to the dispatcher, so a rejected promise would hang the runtime
  // sender forever. Each helper forwards the failure through a payload shaped
  // like its success path so the sender still settles.
  async function _newComment(text: string): Promise<string> {
    const r = await request(
      `https://api.github.com/gists/${_gist}/comments`,
      { Authorization: "token " + _token },
      `{"body": "${encodeURIComponent(text)}"}`,
    );
    return Result.isSuccess(r) ? r.value : "";
  }
  async function _readComment(cid: string): Promise<any> {
    const r = await request(`https://api.github.com/gists/${_gist}/comments/${cid}`, {
      Authorization: "token " + _token,
    });
    if (Result.isFailure(r)) {
      return { status: 1, error: String(r.error.cause) };
    }
    const comment = v.safeParse(gistCommentSchema, parseGist(r.value));
    if (!comment.success) {
      return { status: 1, error: "malformed gist comment response" };
    }
    // The body is an external, user-editable gist comment, so a malformed
    // percent-encoding (e.g. a lone "%") makes decodeURIComponent throw. An
    // unhandled throw here would re-hang the runtime sender, so report it like
    // any other malformed response instead.
    let content: string;
    try {
      content = decodeURIComponent(comment.output.body);
    } catch {
      return { status: 1, error: "malformed gist comment response" };
    }
    return { status: 0, content };
  }
  async function _listComment(): Promise<
    { ok: true; comments: any[] } | { ok: false; error: string }
  > {
    const r = await request(`https://api.github.com/gists/${_gist}/comments`, {
      Authorization: "token " + _token,
    });
    if (Result.isFailure(r)) {
      return { ok: false, error: String(r.error.cause) };
    }
    const comments = v.safeParse(gistCommentListSchema, parseGist(r.value));
    if (!comments.success) {
      return { ok: false, error: "malformed gist comment list response" };
    }
    _comments = comments.output.map((c) => String(c.id));
    return { ok: true, comments: _comments };
  }
  async function _writeComment(cid: string, clip: string): Promise<string> {
    const r = await request(
      `https://api.github.com/gists/${_gist}/comments/${cid}`,
      { Authorization: "token " + _token },
      `{"body": "${encodeURIComponent(clip)}"}`,
    );
    return Result.isSuccess(r) ? r.value : "";
  }
  self.readComment = async (nr: number): Promise<any> => {
    if (_gist === "") {
      return { status: 1, content: "Please call initGist first!" };
    }
    if (nr < _comments.length) {
      return _readComment(_comments[nr]);
    }
    const listed = await _listComment();
    if (!listed.ok) {
      return { status: 1, error: listed.error };
    }
    if (nr < listed.comments.length) {
      return _readComment(listed.comments[nr]);
    }
    return { status: 1, content: "Register not exists!" };
  };
  self.editComment = async (nr: number, clip: string): Promise<any> => {
    if (_gist === "") {
      return { status: 1, content: "Please call initGist first!" };
    }
    if (nr < _comments.length) {
      return _writeComment(_comments[nr], clip);
    }
    const listed = await _listComment();
    if (!listed.ok) {
      return { status: 1, error: listed.error };
    }
    if (nr < listed.comments.length) {
      return _writeComment(listed.comments[nr], clip);
    }
    // Pad the comment list with placeholders up to the requested index, then
    // write the clip into the final new comment.
    let toCreate = nr - listed.comments.length + 1;
    while (toCreate > 1) {
      await _newComment(".");
      toCreate--;
    }
    return _newComment(clip);
  };

  return self;
})();

function start(browser: any): void {
  const handlers: Record<string, MessageHandler> = {};

  const isMV3 = chrome.runtime.getManifest().manifest_version === 3;

  const conf: BackgroundConf = {
    focusAfterClosed: "right",
    tabsMRUOrder: true,
    newTabPosition: "default",
    showTabIndices: false,
    interceptedErrors: [],
  };

  function handleMessage(_message: any, _sender: any, _sendResponse: any) {
    const handler = Object.hasOwn(handlers, _message.action)
      ? handlers[_message.action]
      : undefined;
    if (!handler) {
      console.log("[unexpected runtime message] " + JSON.stringify(_message));
      return undefined;
    }
    const result = handler(_message, _sender, _sendResponse);
    // Asynchronous handlers resolve to the response value; bridge it to
    // sendResponse and keep the channel open, settling even on rejection so a
    // throwing handler never hangs the sender.
    if (result instanceof Promise) {
      if (!_message.needResponse) {
        void result.catch(() => {});
        return undefined;
      }
      void result.then(
        (value) => _sendResponse(value),
        (error) => _sendResponse({ error: String(error) }),
      );
      return true;
    }
    // Synchronous handlers return their payload directly.
    if (_message.needResponse && result) {
      _sendResponse(result);
    }
    return undefined;
  }
  chrome.runtime.onMessage.addListener(handleMessage);
  if (isMV3) {
    chrome.runtime.onUserScriptMessage.addListener((m: any, s: any, r: any) => {
      m.fromUserScript = true;
      handleMessage(m, s, r);
    });
    chrome.runtime.onInstalled.addListener(() => {
      if (chrome.userScripts?.configureWorld == null) {
        return;
      }
      chrome.userScripts.configureWorld({
        csp: "script-src 'self' 'unsafe-eval'",
        messaging: true,
      });
    });
  }

  const tabs = createTabs({ conf, browser, handlers });
  Object.assign(handlers, tabs.handlers);

  const settings = createSettings({
    conf,
    browser,
    sendTabMessage: tabs.sendTabMessage,
    tabMessages: tabs.tabMessages,
    setScrollPos: tabs.setScrollPos,
    handlers,
    newTabUrl: tabs.newTabUrl,
    quit: _quit,
  });
  Object.assign(handlers, settings.handlers);

  Object.assign(handlers, createBookmarkHandlers());
  Object.assign(handlers, createHistoryHandlers(browser, tabs.filterByTitleOrUrl));

  handlers["setSurfingkeysIcon"] = (message: unknown, sender?: chrome.runtime.MessageSender) => {
    const { status } = v.parse(setIconSchema, message);
    let icon = "icons/48.png";
    if (status === "disabled") {
      icon = "icons/48-x.png";
    } else if (status === "lurking") {
      icon = "icons/48-l.png";
    }
    const browserAction = isMV3 ? chrome.action : chrome.browserAction;
    browserAction.setIcon({
      path: icon,
      tabId: sender?.tab?.id,
    });
  };
  handlers["request"] = async (message: unknown) => {
    const { url, headers, data } = v.parse(requestSchema, message);
    const r = await request(url, headers, data);
    return Result.isSuccess(r) ? { text: r.value } : { error: String(r.error.cause) };
  };
  handlers["requestImage"] = async (message: unknown) => {
    const { url } = v.parse(urlSchema, message);
    const r = await Result.try({
      try: async () => {
        const res = await fetch(url, { method: "GET" });
        const img = await createImageBitmap(await res.blob());
        const canvas = new OffscreenCanvas(img.width, img.height);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const outBlob = await canvas.convertToBlob();
        return await new Promise<string | ArrayBuffer | null>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = (e) => resolve(e.target!.result);
          // `readAsDataURL` reports failures via `onerror`/`onabort`. Without
          // rejecting here the promise (and the awaiting `Result.try`) would
          // stay pending forever, hanging the background response and leaking.
          // `fr.error` is null on abort and may be null on error, so fall back
          // to an Error rather than rejecting with null.
          fr.onerror = () => reject(fr.error ?? new Error("FileReader failed to read blob"));
          fr.onabort = () => reject(fr.error ?? new Error("FileReader read aborted"));
          fr.readAsDataURL(outBlob);
        });
      },
      catch: (cause) => domApiError("requestImage", cause),
    });
    return { text: Result.isSuccess(r) ? r.value : "" };
  };
  async function _quit() {
    const windows = await chrome.windows.getAll({ populate: false });
    windows.forEach((w) => {
      chrome.windows.remove(w.id!);
    });
  }
  handlers["quit"] = () => {
    void _quit();
  };
  handlers["closeDownloadsShelf"] = (message: unknown) => {
    const { clearHistory } = v.parse(closeDownloadsShelfSchema, message);
    if (clearHistory) {
      chrome.downloads.erase({ urlRegex: ".*" });
    } else {
      chrome.downloads.setShelfEnabled(false);
      chrome.downloads.setShelfEnabled(true);
    }
  };
  handlers["getDownloads"] = async (message: any) => {
    const downloads = await chrome.downloads.search(message.query);
    return { downloads };
  };
  handlers["download"] = (message: unknown) => {
    const { url, filename, saveAs } = v.parse(downloadSchema, message);
    chrome.downloads.download({ url, filename, saveAs });
  };
  async function _removeURL(uid: string): Promise<void> {
    const type = uid[0];
    uid = uid.slice(1);
    if (type === "B") {
      await chrome.bookmarks.remove(uid);
    } else if (type === "H") {
      await chrome.history.deleteUrl({ url: uid });
    } else if (type === "T") {
      const parts = uid.split(":").map((u) => {
        return Number.parseInt(u);
      });
      await chrome.windows.update(parts[0]!, {
        focused: true,
      });
      await chrome.tabs.remove(parts[1]!);
    } else if (type === "M") {
      const data = await settings.loadSettings("marks");
      delete data.marks[uid];
      await settings.updateAndPostSettings({ marks: data.marks });
    }
  }
  handlers["removeURL"] = async (message: unknown) => {
    const { uid } = v.parse(removeURLSchema, message);
    const uids = typeof uid === "string" ? [uid] : uid;
    await Promise.all(uids.map((u) => _removeURL(u)));
    return { response: "Done" };
  };
  handlers["localData"] = async (message: any) => {
    if (message.data.constructor === Object) {
      void chrome.storage.local.set(message.data);
      // broadcast the change also, such as lastKeys
      // we would set lastKeys in sync to avoid breaching chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE
      void settings.broadcastSettings(message.data);
      return undefined;
    }
    // string or array of string keys
    const data = await chrome.storage.local.get(message.data);
    return { data };
  };
  handlers["captureVisibleTab"] = async () => {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    return { dataUrl };
  };
  handlers["getCaptureSize"] = async () => {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const img = await createImageBitmap(blob);
    const size = { width: img.width, height: img.height };
    img.close();
    return size;
  };
  handlers["initGist"] = async (message: unknown) => {
    const { token } = v.parse(tokenSchema, message);
    return { gist: await Gist.initGist(token) };
  };
  handlers["readComment"] = (message: unknown) => {
    const { index } = v.parse(commentIndexSchema, message);
    return Gist.readComment(index);
  };
  handlers["editComment"] = async (message: unknown) => {
    const { index, content } = v.parse(editCommentSchema, message);
    return { gistResp: await Gist.editComment(index, content) };
  };

  handlers["openIncognito"] = (message: unknown) => {
    const { url } = v.parse(urlSchema, message);
    chrome.windows.create({ url, incognito: true });
  };

  handlers["writeClipboard"] = (message: unknown) => {
    const { text } = v.parse(textSchema, message);
    navigator.clipboard.writeText(text);
  };
  handlers["getContainerName"] = browser._getContainerName(handlers);
  chrome.runtime.setUninstallURL(
    "http://brookhong.github.io/2018/01/30/why-did-you-uninstall-surfingkeys.html",
  );
}

export { start };
