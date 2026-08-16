// ==UserScript==
// @name         ipstatuspro 流媒体检测桥
// @namespace    https://ipstatus.net/
// @version      0.1.0
// @description  为 ipstatus 流媒体检测页提供 Tampermonkey 网络请求桥
// @match        https://ipstatus.net/streaming*
// @match        https://www.ipstatus.net/streaming*
// @match        http://127.0.0.1:8081/streaming.html*
// @match        http://localhost:8081/streaming.html*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      netflix.com
// @connect      disneyplus.com
// @connect      max.com
// @connect      indazn.com
// @connect      hotstar.com
// @connect      youtube.com
// @connect      primevideo.com
// @connect      spotify.com
// @connect      bilibili.com
// @connect      viu.com
// @connect      tvbanywhere.com.sg
// @connect      myvideo.net.tw
// @connect      tiktok.com
// @connect      reddit.com
// @connect      openai.com
// @connect      claude.ai
// @connect      google.com
// @connect      cloudflare.com
// @license			MIT
// ==/UserScript==

(function () {
  'use strict';

  const PAGE_SOURCE = 'ipstatus-streaming-page';
  const BRIDGE_SOURCE = 'ipstatus-streaming-extension';
  const VERSION = 'tm-0.1.1';
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const MAX_BODY = 384 * 1024;
  const ALLOWED_ROOTS = [
    'netflix.com', 'disneyplus.com', 'max.com', 'indazn.com', 'hotstar.com',
    'youtube.com', 'primevideo.com', 'spotify.com', 'bilibili.com', 'viu.com',
    'tvbanywhere.com.sg', 'myvideo.net.tw', 'tiktok.com', 'reddit.com',
    'openai.com', 'claude.ai', 'google.com', 'cloudflare.com',
  ];

  function reply(requestId, payload) {
    pageWindow.postMessage({ source: BRIDGE_SOURCE, type: 'RESPONSE', requestId, payload }, pageWindow.location.origin);
  }

  function allowedURL(raw) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password) return false;
      const host = url.hostname.toLowerCase();
      return ALLOWED_ROOTS.some((root) => host === root || host.endsWith(`.${root}`));
    } catch {
      return false;
    }
  }

  function proxyFetch(requestId, request = {}) {
    if (typeof GM_xmlhttpRequest !== 'function') {
      reply(requestId, { ok: false, error: 'Tampermonkey 未提供网络请求权限' });
      return;
    }
    if (!allowedURL(request.url)) {
      reply(requestId, { ok: false, error: '该地址不在流媒体检测白名单内' });
      return;
    }
    const method = String(request.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'HEAD'].includes(method)) {
      reply(requestId, { ok: false, error: '不支持的请求方法' });
      return;
    }
    const headers = {};
    for (const [name, value] of Object.entries(request.headers || {})) {
      if (['accept', 'accept-language', 'content-type'].includes(name.toLowerCase())) headers[name] = String(value).slice(0, 512);
    }
    GM_xmlhttpRequest({
      method,
      url: request.url,
      headers,
      data: method === 'POST' ? String(request.body || '') : undefined,
      timeout: 20000,
      onload: (response) => reply(requestId, {
        ok: true,
        response: {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          url: response.finalUrl || request.url,
          contentType: response.responseHeaders?.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || '',
          body: String(response.responseText || '').slice(0, MAX_BODY),
          truncated: String(response.responseText || '').length > MAX_BODY,
          latencyMs: 0,
        },
      }),
      onerror: () => reply(requestId, { ok: false, error: 'Tampermonkey 网络请求失败' }),
      ontimeout: () => reply(requestId, { ok: false, error: 'Tampermonkey 请求超时' }),
    });
  }

  pageWindow.addEventListener('message', (event) => {
    if (event.source !== pageWindow || event.origin !== pageWindow.location.origin) return;
    const message = event.data;
    if (!message || message.source !== PAGE_SOURCE || typeof message.requestId !== 'string') return;
    if (message.type === 'PING') {
      reply(message.requestId, { ok: true, version: VERSION, bridge: 'Tampermonkey' });
    } else if (message.type === 'GET_PROXY_STATE') {
      reply(message.requestId, { ok: true, proxy: { mode: 'browser', detail: '跟随浏览器当前网络设置', levelOfControl: 'unknown' } });
    } else if (message.type === 'PROXY_FETCH') {
      proxyFetch(message.requestId, message.request);
    }
  });

  pageWindow.postMessage({ source: BRIDGE_SOURCE, type: 'READY', requestId: 'startup', payload: { version: VERSION } }, pageWindow.location.origin);
})();
