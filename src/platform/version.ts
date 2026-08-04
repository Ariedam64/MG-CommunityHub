// src/platform/version.ts
// Reads the userscript metadata block of the published build so the mod can
// tell whether a newer version is available.
//
// The published dist file is the source of truth, not meta.userscript.js:
// bumping the meta without rebuilding would advertise a version nobody can
// actually install.
//
// The dist file is ~500 KB and we only need the header, so the request asks
// for the first couple of kilobytes with a Range header. GitHub's raw CDN
// honours it; if anything in the chain ignores it we simply get the whole
// file back, which still parses fine.

import { isDiscordSurface } from "./api";

const REPO_OWNER = "Ariedam64";
const REPO_NAME = "MG-CommunityHub";
const REPO_BRANCH = "main";
const SCRIPT_FILE_PATH = "dist/mg-community-hub.user.js";

const RAW_SCRIPT_URL =
  `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}` +
  `/refs/heads/${REPO_BRANCH}/${SCRIPT_FILE_PATH}`;

/** Enough for the metadata block with room to spare. */
const METADATA_BYTES = 4096;

const REQUEST_TIMEOUT_MS = 15_000;

export type RemoteVersionResponse = {
  version?: string;
  download?: string;
};

type FetchOptions = { headers?: Record<string, string> };

async function fetchTextWithFetch(url: string, options?: FetchOptions): Promise<string> {
  const response = await fetch(url, { cache: "no-store", headers: options?.headers });

  if (!response.ok) {
    throw new Error(`Failed to load remote resource: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

function fetchTextWithGM(url: string, options?: FetchOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr =
      typeof GM_xmlhttpRequest === "function"
        ? GM_xmlhttpRequest
        : typeof GM !== "undefined" && typeof GM.xmlHttpRequest === "function"
          ? GM.xmlHttpRequest
          : null;

    if (!xhr) {
      reject(new Error("GM_xmlhttpRequest not available"));
      return;
    }

    xhr({
      method: "GET",
      url,
      headers: options?.headers,
      timeout: REQUEST_TIMEOUT_MS,
      onload: (res) => {
        // 206 Partial Content is the expected answer to a Range request.
        if (res.status >= 200 && res.status < 300) resolve(res.responseText);
        else reject(new Error(`GM_xmlhttpRequest failed: ${res.status}`));
      },
      onerror: () => reject(new Error("GM_xmlhttpRequest failed")),
      ontimeout: () => reject(new Error("GM_xmlhttpRequest timed out")),
    } as Tampermonkey.Request);
  });
}

async function fetchText(url: string, options?: FetchOptions): Promise<string> {
  const hasGM =
    typeof GM_xmlhttpRequest === "function" ||
    (typeof GM !== "undefined" && typeof GM.xmlHttpRequest === "function");

  // Inside the Discord activity the page CSP blocks cross-origin fetch, so GM
  // is the only transport that works there.
  if (isDiscordSurface() && hasGM) {
    return await fetchTextWithGM(url, options);
  }

  try {
    return await fetchTextWithFetch(url, options);
  } catch (error) {
    if (hasGM) return await fetchTextWithGM(url, options);
    throw error;
  }
}

/** Fetch just the head of the published userscript. */
async function fetchScriptHeader(): Promise<string> {
  // The query param defeats the browser's own HTTP cache (GM_xmlhttpRequest
  // has no no-store option, so it needs the help). It does NOT defeat
  // GitHub's CDN, which normalises the query string away and holds a
  // response for a few minutes — measured, not assumed. So a check run
  // immediately after a release can miss it by up to ~5 minutes. Harmless:
  // automatic checks are hours apart, and the next one picks it up.
  const url = `${RAW_SCRIPT_URL}?t=${Date.now()}`;
  return await fetchText(url, { headers: { Range: `bytes=0-${METADATA_BYTES - 1}` } });
}

export async function fetchRemoteVersion(): Promise<RemoteVersionResponse | null> {
  try {
    const header = await fetchScriptHeader();
    const meta = extractUserscriptMetadata(header);

    if (!meta) throw new Error("Metadata block not found in remote script");

    return {
      version: meta.get("version")?.[0],
      download: meta.get("downloadurl")?.[0] ?? meta.get("updateurl")?.[0],
    };
  } catch (error) {
    console.warn("[CommunityHub] Unable to retrieve the remote version:", error);
    return null;
  }
}

type UserscriptMetadata = Map<string, string[]>;

export function extractUserscriptMetadata(source: string): UserscriptMetadata | null {
  const headerMatch = source.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
  if (!headerMatch) return null;

  const entries = headerMatch[1].matchAll(/^\/\/\s*@([^\s]+)\s+(.+)$/gm);
  const meta: UserscriptMetadata = new Map();

  for (const [, rawKey, rawValue] of entries) {
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim();
    if (!key) continue;

    const current = meta.get(key);
    if (current) current.push(value);
    else meta.set(key, [value]);
  }

  return meta;
}

export function getLocalVersion(): string | undefined {
  if (typeof GM_info !== "undefined" && GM_info?.script?.version) {
    return GM_info.script.version;
  }

  return undefined;
}

/** Where to send the user so the script manager offers the update. */
export function getDownloadUrl(): string {
  return RAW_SCRIPT_URL;
}
