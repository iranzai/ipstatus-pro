const ALLOWED_PAGE_ORIGINS = new Set([
  'http://127.0.0.1:8081',
  'http://localhost:8081',
  'https://ipstatus.net',
  'https://www.ipstatus.net',
]);

const REQUEST_TIMEOUT = 15000;
const MAX_REQUEST_BODY = 32 * 1024;
const MAX_RESPONSE_BODY = 384 * 1024;
const SAFE_HEADERS = new Set(['accept', 'accept-language', 'content-type']);

function isAllowedSender(sender) {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  if (sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return true;
  try {
    const url = new URL(sender.url);
    return ALLOWED_PAGE_ORIGINS.has(url.origin)
      && (url.pathname.endsWith('/streaming.html') || url.pathname.startsWith('/streaming'));
  } catch {
    return false;
  }
}

function isPublicHTTPS(rawURL) {
  try {
    const url = new URL(rawURL);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase();
    if (!hostname.includes('.') || hostname === 'localhost' || hostname.endsWith('.local')) return false;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) return false;
    return true;
  } catch {
    return false;
  }
}

async function readTextLimited(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    return { text: text.slice(0, MAX_RESPONSE_BODY), truncated: text.length > MAX_RESPONSE_BODY };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = MAX_RESPONSE_BODY - bytes;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel();
      break;
    }
    const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
    bytes += chunk.byteLength;
    text += decoder.decode(chunk, { stream: true });
    if (value.byteLength > remaining) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  text += decoder.decode();
  return { text, truncated };
}

async function proxyFetch(input) {
  if (!input || !isPublicHTTPS(input.url)) throw new Error('仅允许访问公开 HTTPS 域名');
  const method = String(input.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'HEAD'].includes(method)) throw new Error('不支持的请求方法');
  const body = method === 'POST' ? String(input.body || '') : undefined;
  if (body && new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY) throw new Error('请求体超过限制');

  const headers = {};
  for (const [name, value] of Object.entries(input.headers || {})) {
    if (SAFE_HEADERS.has(name.toLowerCase())) headers[name] = String(value).slice(0, 512);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const started = performance.now();
  try {
    const response = await fetch(input.url, {
      method,
      headers,
      body,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    const content = method === 'HEAD' ? { text: '', truncated: false } : await readTextLimited(response);
    return {
      ok: true,
      response: {
        ok: response.ok,
        status: response.status,
        url: response.url,
        contentType: response.headers.get('content-type') || '',
        body: content.text,
        truncated: content.truncated,
        latencyMs: Math.round(performance.now() - started),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'AbortError' ? '请求超时' : error?.message || '网络请求失败',
      latencyMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getProxyState() {
  try {
    const details = await chrome.proxy.settings.get({ incognito: false });
    const value = details?.value || {};
    const mode = value.mode || 'unknown';
    let detail = mode;
    if (mode === 'fixed_servers') {
      const proxy = value.rules?.singleProxy || value.rules?.fallbackProxy;
      detail = proxy ? `${proxy.scheme || 'http'}://${proxy.host}:${proxy.port}` : '固定代理配置';
    } else if (mode === 'pac_script') {
      detail = value.pacScript?.url ? 'PAC URL' : 'PAC script';
    } else if (mode === 'system') {
      detail = '跟随系统网络设置';
    } else if (mode === 'direct') {
      detail = '不使用代理';
    }
    return { mode, detail, levelOfControl: details?.levelOfControl || 'unknown' };
  } catch (error) {
    return { mode: 'unknown', detail: error?.message || '无法读取代理设置', levelOfControl: 'unknown' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isAllowedSender(sender)) {
    sendResponse({ ok: false, error: '来源页面不受信任' });
    return false;
  }
  if (message?.type === 'PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (message?.type === 'GET_PROXY_STATE') {
    getProxyState().then((proxy) => sendResponse({ ok: true, proxy }));
    return true;
  }
  if (message?.type === 'PROXY_FETCH') {
    proxyFetch(message.request).then(sendResponse);
    return true;
  }
  sendResponse({ ok: false, error: '不支持的命令' });
  return false;
});
