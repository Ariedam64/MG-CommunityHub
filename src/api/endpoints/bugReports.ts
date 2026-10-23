// src/api/endpoints/bugReports.ts
// The bug report routes (see src/bugReport/core/client.ts), through the same
// transports as the hub's client: GM_xmlhttpRequest inside the Discord
// activity, fetch elsewhere with GM as the fallback, the Discord long poll
// paused meanwhile.
//
// Not through httpPost: on the GM path it drops the body of any answer that
// is not a 2xx, and these routes explain a refusal in it (the reference of a
// duplicate, the field the server refused, when to try again). It has no
// timeout either, and a screenshot upload needs one.

import type { BugReportClient, BugReportHttpRequest, BugReportHttpResponse } from "@/bugReport/core/client";
import { isDiscordActivityContext } from "@/platform/discordCsp";
import { getApiKey } from "@/storage/storage";
import { withDiscordPollPause } from "../client/events";
import { API_ORIGIN } from "../config";

const hasGM = () => typeof GM_xmlhttpRequest === "function";

function sendWithGM(req: BugReportHttpRequest): Promise<BugReportHttpResponse> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: req.method,
      url: req.url,
      headers: req.headers,
      data: req.body,
      timeout: req.timeoutMs,
      onload: (res) => resolve({ status: res.status, body: res.responseText ?? "" }),
      onerror: () => reject(new Error("GM_xmlhttpRequest failed")),
      ontimeout: () => reject(new Error("GM_xmlhttpRequest timed out")),
    } as Tampermonkey.Request);
  });
}

async function sendWithFetch(req: BugReportHttpRequest): Promise<BugReportHttpResponse> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), req.timeoutMs) : null;
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      credentials: "omit",
      signal: controller?.signal,
    });
    return { status: res.status, body: await res.text() };
  } catch (error) {
    if (controller?.signal.aborted) throw new Error("fetch timed out");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function send(req: BugReportHttpRequest): Promise<BugReportHttpResponse> {
  return withDiscordPollPause(async () => {
    if (isDiscordActivityContext() && hasGM()) return await sendWithGM(req);
    try {
      return await sendWithFetch(req);
    } catch (error) {
      // GM stands in only when fetch cannot connect. A request that timed out
      // may still have reached the server: the report itself would come back
      // through its follow token, but a screenshot or a comment sent again
      // would be kept twice, and the player would wait twice as long.
      if (!hasGM() || /timed out/.test(String((error as Error)?.message))) throw error;
      return await sendWithGM(req);
    }
  });
}

export const bugReportClient: BugReportClient = {
  baseUrl: API_ORIGIN,
  request: send,
  getApiKey,
};
