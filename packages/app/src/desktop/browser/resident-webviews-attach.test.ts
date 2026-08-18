// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type BrowserWebviewProfileHost,
  clearResidentBrowserWebviewsForTests,
  ensureResidentBrowserWebview,
} from "./resident-webviews";

const attachedBrowsers: Array<{
  browserId: string;
  workspaceId: string;
  webContentsId: number;
}> = [];
const profileHost: BrowserWebviewProfileHost = {
  profilePartition: "persist:paseo-browser",
  registerAttachedBrowser: async (input) => {
    attachedBrowsers.push(input);
  },
};

describe("resident webview attach registration", () => {
  beforeEach(() => {
    attachedBrowsers.length = 0;
  });

  afterEach(() => {
    clearResidentBrowserWebviewsForTests();
  });

  it("registers immediately when getWebContentsId is available on did-attach", () => {
    const webview = ensureResidentBrowserWebview({
      browserId: "browser-ready-guest",
      workspaceId: "workspace-ready-guest",
      url: "https://example.com/ready",
      profileHost,
    });
    if (!webview) {
      throw new Error("Expected resident webview");
    }
    Object.assign(webview, { getWebContentsId: () => 101 });

    webview.dispatchEvent(new Event("did-attach"));

    expect(attachedBrowsers).toEqual([
      {
        browserId: "browser-ready-guest",
        workspaceId: "workspace-ready-guest",
        webContentsId: 101,
      },
    ]);
  });

  it("waits for dom-ready when getWebContentsId throws on did-attach", () => {
    const webview = ensureResidentBrowserWebview({
      browserId: "browser-late-guest",
      workspaceId: "workspace-late-guest",
      url: "https://example.com/late",
      profileHost,
    });
    if (!webview) {
      throw new Error("Expected resident webview");
    }

    let guestReady = false;
    Object.assign(webview, {
      getWebContentsId: () => {
        if (!guestReady) {
          throw new Error(
            "The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.",
          );
        }
        return 303;
      },
    });

    expect(() => webview.dispatchEvent(new Event("did-attach"))).not.toThrow();
    expect(attachedBrowsers).toEqual([]);

    guestReady = true;
    webview.dispatchEvent(new Event("dom-ready"));

    expect(attachedBrowsers).toEqual([
      {
        browserId: "browser-late-guest",
        workspaceId: "workspace-late-guest",
        webContentsId: 303,
      },
    ]);
  });
});
