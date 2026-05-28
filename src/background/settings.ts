import { request } from "./request.js";
import type { MessageHandler } from "./start.js";

// Browser-extension global; background is an untyped chrome.* boundary (see start.ts).
declare const chrome: any;

/**
 * Sends a (possibly deferred) response for a handled message; injected from the composition root so
 * the unit shares the one pending-port bookkeeping.
 */
type Respond = (message: any, sendResponse: (result: any) => void, result: any) => void;

/** Builds a `{ key: value }` dictionary from an array of keys, all set to `val`. */
export function dictFromArray(arry: any[], val: any): Record<string, any> {
  const dict: Record<string, any> = {};
  arry.forEach((h) => {
    dict[h] = val;
  });
  return dict;
}

/** Shallow-merges every own enumerable property of `ss` onto `target` in place. */
export function extendObject(target: any, ss: any): void {
  for (const k in ss) {
    target[k] = ss[k];
  }
}

/**
 * Projects `set` to the requested `keys`. A null/undefined/"" key set returns the whole object; a
 * single key or an array of keys returns just that subset.
 */
export function getSubSettings(set: any, keys: any): any {
  let subset: any;
  if (!keys) {
    // if null/undefined/""
    subset = set;
  } else {
    if (!(keys instanceof Array)) {
      keys = [keys];
    }
    subset = {};
    keys.forEach((k: string) => {
      subset[k] = set[k];
    });
  }
  return subset;
}

/**
 * Persists settings into a `chrome.storage` area. Sync storage has a quota, so snippets loaded from
 * a `localPath` are never written there; local storage instead re-fetches and caches the snippets
 * from that path before saving.
 */
export function _save(storage: any, data: any, cb?: () => void): void {
  if (storage === chrome.storage.sync) {
    // don't store snippets from localPath into sync storage, since sync storage has its quota.
    if (data.localPath) {
      delete data.snippets;
      delete data.localPath;
    }
    if (Object.keys(data).length > 1) {
      storage.set(data, cb);
    }
  } else {
    if (data.localPath) {
      delete data.snippets;
      // try to fetch snippets from localPath and cache it in local storage.
      request(data.localPath, (resp) => {
        data.snippets = resp;
        storage.set(data, cb);
      });
    } else {
      storage.set(data, cb);
    }
  }
}

/**
 * Dependencies the settings subsystem cannot own: the deferred-responder and per-browser glue from
 * the composition root, the shared mutable `conf` (also read by the tab handlers), and the tab-core
 * primitives a few settings actions reach into — `sendTabMessage` to broadcast updates, plus
 * `tabMessages`, `setScrollPos`, the shared `handlers` registry, `newTabUrl` and `quit` for the
 * marks/session actions that drive tab navigation.
 */
export interface SettingsDeps {
  _response: Respond;
  conf: Record<string, any>;
  browser: any;
  sendTabMessage: (tabId: number, frameId: number, message: any) => void;
  tabMessages: Record<string, any>;
  setScrollPos: (tabId: number) => void;
  handlers: Record<string, MessageHandler>;
  newTabUrl: string;
  quit: () => void;
}

/**
 * What the composition root needs back from the settings subsystem: the handler map to register,
 * plus the three infra functions still called by misc handlers that stay in start.ts (`removeURL`'s
 * mark-deletion branch and `localData`).
 */
export interface SettingsUnit {
  handlers: Record<string, MessageHandler>;
  loadSettings: (keys: any, cb: (set: any) => void) => void;
  updateAndPostSettings: (diffSettings: any, afterSet?: () => void) => void;
  broadcastSettings: (data: any) => void;
}

/**
 * Settings subsystem: load/save/sync of settings, the blocklist/mouse-query state toggles, the
 * enable/disable state computation, VIM marks, and sessions. Owns the settings storage logic and
 * the user-script registration; takes its cross-concern dependencies by injection so it never
 * imports the tab core back.
 */
export function createSettings(deps: SettingsDeps): SettingsUnit {
  const { _response, conf, browser, sendTabMessage, tabMessages, handlers, newTabUrl } = deps;
  const _setScrollPos_bg = deps.setScrollPos;
  const _quit = deps.quit;

  const isMV3 = chrome.runtime.getManifest().manifest_version === 3;

  function loadSettings(keys: any, cb: (set: any) => void) {
    const tmpSet = {
      blocklist: {},
      marks: {},
      findHistory: [],
      cmdHistory: [],
      sessions: {},
    };

    browser.loadRawSettings(
      keys,
      (set: any) => {
        if (set.localPath) {
          request(
            appendNonce(set.localPath),
            (resp) => {
              set.snippets = resp;
              cb(set);
            },
            undefined,
            undefined,
            () => {
              // failed to read snippets from localPath
              set.error = "Failed to read snippets from " + set.localPath;
              cb(set);
            },
          );
        } else {
          cb(set);
        }
      },
      tmpSet,
    );
  }

  function _updateSettings(diffSettings: any, afterSet?: () => void) {
    diffSettings.savedAt = new Date().getTime();
    _save(chrome.storage.local, diffSettings, () => {
      _save(chrome.storage.sync, diffSettings);
      if (afterSet) {
        afterSet();
      }
    });
  }

  function _broadcastSettings(data: any) {
    chrome.tabs.query({}, (tabs: any[]) => {
      tabs.forEach((tab) => {
        sendTabMessage(tab.id, -1, {
          subject: "settingsUpdated",
          settings: data,
        });
      });
    });
  }

  function _updateAndPostSettings(diffSettings: any, afterSet?: () => void) {
    _broadcastSettings(diffSettings);
    _updateSettings(diffSettings, afterSet);
  }

  function getSenderUrl(sender: any) {
    // use the tab's url if sender is a frame with blank url.
    return sender.frameId !== 0 && sender.url === "about:blank" ? sender.tab.url : sender.url;
  }
  function _getState(set: any, url: any, blocklistPattern: any, lurkingPattern: any) {
    if (set.blocklist[".*"]) {
      return "disabled";
    }
    if (url) {
      if (set.blocklist[url.origin]) {
        return "disabled";
      }
      if (blocklistPattern) {
        blocklistPattern = new RegExp(blocklistPattern.source, blocklistPattern.flags);
        if (blocklistPattern.test(url.href)) {
          return "disabled";
        }
      }
      if (lurkingPattern) {
        lurkingPattern = new RegExp(lurkingPattern.source, lurkingPattern.flags);
        if (lurkingPattern.test(url.href)) {
          return "lurking";
        }
      }
    }
    return "enabled";
  }

  function appendNonce(url: string) {
    if (/https?:\/\//.test(url)) {
      url = url.replace(/\?$/, "");
      const u = new URL(url);
      const con = u.search ? "&" : "?";
      url = `${url}${con}nonce=${new Date().getTime()}`;
    }
    return url;
  }

  function _loadSettingsFromUrl(url: string, cb: (status: any) => void) {
    request(
      appendNonce(url),
      (resp) => {
        _updateAndPostSettings({ localPath: url, snippets: resp });
        registerUserScript(resp, () => {
          cb({ status: "Succeeded", snippets: resp });
        });
      },
      undefined,
      undefined,
      () => {
        cb({ status: "Failed" });
      },
    );
  }

  function registerUserScript(snippets: any, callback?: () => void) {
    if (!isUserScriptsAvailable()) {
      callback && callback();
      return;
    }
    const userScriptId = "settingsSnippets";
    const invokeCallback = () => {
      if (chrome.runtime.lastError) {
        console.error("userScripts API error:", chrome.runtime.lastError);
      }
      callback && callback();
    };
    if (snippets) {
      chrome.userScripts.getScripts({ ids: [userScriptId] }, (r: any[]) => {
        if (chrome.runtime.lastError) {
          console.error("userScripts.getScripts error:", chrome.runtime.lastError);
          callback && callback();
          return;
        }
        const code = `import('./api.js').then((module) => {module.default("${chrome.runtime.getURL("/")}", (api, settings) => {${snippets}\n})});`;
        const registerSettingSnippets = () => {
          chrome.userScripts.register(
            [
              {
                allFrames: true,
                id: userScriptId,
                matches: ["*://*/*", "file:///*"],
                js: [{ code }],
              },
            ],
            invokeCallback,
          );
        };
        if (r.length > 0) {
          if (r[0].js[0].code !== code) {
            chrome.userScripts.unregister({ ids: [userScriptId] }, registerSettingSnippets);
          } else {
            callback && callback();
          }
        } else {
          registerSettingSnippets();
        }
      });
    } else {
      chrome.userScripts.getScripts({ ids: [userScriptId] }, (r: any[]) => {
        if (chrome.runtime.lastError) {
          console.error("userScripts.getScripts error:", chrome.runtime.lastError);
          callback && callback();
          return;
        }
        if (r.length > 0) {
          chrome.userScripts.unregister({ ids: [userScriptId] }, invokeCallback);
        } else {
          callback && callback();
        }
      });
    }
  }

  function onFullSettingsRequested(data: any, callback?: () => void) {
    data.isMV3 = isMV3;
    data.isUserScriptsAvailable = isUserScriptsAvailable();
    if (isMV3) {
      data.showAdvanced = data.isUserScriptsAvailable && data.showAdvanced;
    }

    if (data.isUserScriptsAvailable && data.showAdvanced) {
      registerUserScript(data.snippets, callback);
    } else if (data.isUserScriptsAvailable) {
      registerUserScript(null, callback);
    } else {
      callback && callback();
    }
  }

  function isUserScriptsAvailable() {
    try {
      if (chrome.userScripts) {
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  const handlersMap: Record<string, MessageHandler> = {
    toggleBlocklist: (message: any, sender: any, sendResponse: any) => {
      loadSettings("blocklist", (data: any) => {
        let origin = ".*";
        const senderOrigin = sender.origin || new URL(getSenderUrl(sender)).origin;
        if (
          chrome.runtime.getURL("/").toLowerCase().indexOf(senderOrigin.toLowerCase()) !== 0 &&
          senderOrigin !== "null"
        ) {
          origin = senderOrigin;
        }
        if (Object.prototype.hasOwnProperty.call(data.blocklist, origin)) {
          delete data.blocklist[origin];
        } else {
          data.blocklist[origin] = 1;
        }
        _updateAndPostSettings({ blocklist: data.blocklist }, () => {
          sendResponse({
            state: _getState(
              data,
              sender.tab ? new URL(getSenderUrl(sender)) : null,
              message.blocklistPattern,
              message.lurkingPattern,
            ),
            blocklist: data.blocklist,
            url: origin,
          });
        });
      });
    },
    toggleMouseQuery: (message: any, sender: any, _sendResponse: any) => {
      loadSettings("mouseSelectToQuery", (data: any) => {
        if (sender.tab && sender.tab.url.indexOf(chrome.runtime.getURL("/")) !== 0) {
          const mouseSelectToQuery = data.mouseSelectToQuery || [];
          const idx = mouseSelectToQuery.indexOf(message.origin);
          if (idx === -1) {
            mouseSelectToQuery.push(message.origin);
          } else {
            mouseSelectToQuery.splice(idx, 1);
          }
          _updateAndPostSettings({ mouseSelectToQuery: mouseSelectToQuery });
        }
      });
    },
    getState: (message: any, sender: any, sendResponse: any) => {
      loadSettings(["blocklist"], (data: any) => {
        if (sender.tab) {
          _response(message, sendResponse, {
            state: _getState(
              data,
              new URL(getSenderUrl(sender)),
              message.blocklistPattern,
              message.lurkingPattern,
            ),
          });
        }
      });
    },
    addVIMark: (message: any, _sender: any, _sendResponse: any) => {
      loadSettings("marks", (data: any) => {
        extendObject(data.marks, message.mark);
        _updateAndPostSettings({ marks: data.marks });
      });
    },
    jumpVIMark: (message: any, sender: any, sendResponse: any) => {
      loadSettings("marks", (data: any) => {
        const marks = data.marks;
        if (Object.prototype.hasOwnProperty.call(marks, message.mark)) {
          const markInfo = marks[message.mark];
          chrome.tabs.query({}, (tabs: any[]) => {
            tabs = tabs.filter((t) => {
              return t.url === markInfo.url;
            });

            if (tabs.length === 0) {
              markInfo.tab = {
                tabbed: true,
                active: true,
              };
              handlers.openLink(markInfo, sender, sendResponse);
            } else {
              if (markInfo.scrollLeft || markInfo.scrollTop) {
                tabMessages[tabs[0].id] = {
                  scrollLeft: markInfo.scrollLeft,
                  scrollTop: markInfo.scrollTop,
                };
              }
              if (tabs[0].id === sender.tab.id) {
                _setScrollPos_bg(tabs[0].id);
              } else {
                chrome.tabs.update(tabs[0].id, {
                  active: true,
                });
              }
            }
          });
        }
      });
    },
    resetSettings: (message: any, _sender: any, sendResponse: any) => {
      chrome.storage.local.clear();
      chrome.storage.sync.clear();
      loadSettings(null, (data: any) => {
        _response(message, sendResponse, {
          settings: data,
        });
        _broadcastSettings(data);
      });
    },
    loadSettingsFromUrl: (message: any, _sender: any, sendResponse: any) => {
      _loadSettingsFromUrl(message.url, (status: any) => {
        _response(message, sendResponse, status);
      });
    },
    getSettings: (message: any, _sender: any, sendResponse: any) => {
      let pf = loadSettings;
      if (message.key === "RAW") {
        pf = browser.loadRawSettings;
        message.key = "";
      }
      pf(message.key, (data: any) => {
        if (message.key === undefined) {
          onFullSettingsRequested(data);
        }

        _response(message, sendResponse, {
          settings: data,
        });
      });
    },
    updateSettings: (message: any, _sender: any, sendResponse: any) => {
      const error = "";
      if (message.scope === "snippets") {
        // For settings from snippets, don't broadcast the update
        // neither persist into storage
        for (const k in message.settings) {
          if (Object.prototype.hasOwnProperty.call(conf, k)) {
            conf[k] = message.settings[k];
          }
        }
        return { error };
      } else {
        if (message.settings.showAdvanced && isMV3) {
          if (isUserScriptsAvailable()) {
            chrome.userScripts.configureWorld({
              csp: "script-src 'self' 'unsafe-eval'",
              messaging: true,
            });
            _updateAndPostSettings(message.settings);
            registerUserScript(message.settings.snippets, () => {
              _response(message, sendResponse, { error });
            });
            return;
          } else {
            return {
              error:
                "Advanced mode is only available when Developer mode is turned on from chrome://extensions/.",
            };
          }
        } else {
          _updateAndPostSettings(message.settings);
        }
      }
      return { error };
    },
    updateInputHistory: (message: any, _sender: any, sendResponse: any) => {
      let key: string | undefined = undefined;
      let value: any;
      for (const k in message) {
        key = k + "History";
        value = message[k];
        break;
      }
      if (key) {
        loadSettings(key, (data: any) => {
          let curr = data[key!] || [];
          const toUpdate: Record<string, any> = {};
          if (value.constructor.name === "Array") {
            toUpdate[key!] = value;
            _updateAndPostSettings(toUpdate);
          } else if (value.trim().length && value !== ".") {
            curr = curr.filter((c: string) => {
              return c.trim().length && c !== value && c !== ".";
            });
            curr.unshift(value);
            if (curr.length > 50) {
              curr.pop();
            }
            toUpdate[key!] = curr;
            _updateAndPostSettings(toUpdate);
          }
          _response(message, sendResponse, {
            history: curr,
          });
        });
      }
    },
    createSession: (message: any, _sender: any, _sendResponse: any) => {
      loadSettings("sessions", (data: any) => {
        chrome.tabs.query({}, (tabs: any[]) => {
          const tabGroup: Record<string, any[]> = {};
          tabs.forEach((tab) => {
            if (tab && tab.index !== void 0) {
              if (!Object.prototype.hasOwnProperty.call(tabGroup, tab.windowId)) {
                tabGroup[tab.windowId] = [];
              }
              if (tab.url !== newTabUrl) {
                tabGroup[tab.windowId].push(tab.url);
              }
            }
          });
          const tabg = [];
          for (const k in tabGroup) {
            if (tabGroup[k].length) {
              tabg.push(tabGroup[k]);
            }
          }
          data.sessions[message.name] = {};
          data.sessions[message.name]["tabs"] = tabg;
          _updateAndPostSettings(
            {
              sessions: data.sessions,
            },
            message.quitAfterSaved ? _quit : undefined,
          );
        });
      });
    },
    openSession: (message: any, _sender: any, _sendResponse: any) => {
      loadSettings("sessions", (data: any) => {
        if (Object.prototype.hasOwnProperty.call(data.sessions, message.name)) {
          const urls = data.sessions[message.name]["tabs"];
          urls[0].forEach((url: string) => {
            chrome.tabs.create({
              url: url,
              active: false,
              pinned: false,
            });
          });
          for (let i = 1; i < urls.length; i++) {
            const a = urls[i];
            chrome.windows.create({}, (win: any) => {
              a.forEach((url: string) => {
                chrome.tabs.create({
                  windowId: win.id,
                  url: url,
                  active: false,
                  pinned: false,
                });
              });
            });
          }
          chrome.tabs.query(
            {
              url: newTabUrl,
            },
            (tabs: any[]) => {
              chrome.tabs.remove(
                tabs.map((t) => {
                  return t.id;
                }),
              );
            },
          );
        }
      });
    },
    deleteSession: (message: any, _sender: any, _sendResponse: any) => {
      loadSettings("sessions", (data: any) => {
        delete data.sessions[message.name];
        _updateAndPostSettings({
          sessions: data.sessions,
        });
      });
    },
  };

  return {
    handlers: handlersMap,
    loadSettings,
    updateAndPostSettings: _updateAndPostSettings,
    broadcastSettings: _broadcastSettings,
  };
}
