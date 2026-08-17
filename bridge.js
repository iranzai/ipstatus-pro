const PAGE_SOURCE = 'ipstatus-streaming-page';
const EXTENSION_SOURCE = 'ipstatus-streaming-extension';

function sendToPage(type, requestId, payload) {
  window.postMessage({ source: EXTENSION_SOURCE, type, requestId, payload }, window.location.origin);
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.source !== PAGE_SOURCE || typeof message.requestId !== 'string') return;
  if (!['PING', 'GET_PROXY_STATE', 'PROXY_FETCH'].includes(message.type)) return;
  try {
    chrome.runtime.sendMessage({ type: message.type, request: message.request }).then(
      (response) => sendToPage('RESPONSE', message.requestId, response || { ok: false, error: '扩展后台未响应' }),
      (error) => sendToPage('RESPONSE', message.requestId, { ok: false, error: error?.message || '扩展通信失败' }),
    );
  } catch (error) {
    sendToPage('RESPONSE', message.requestId, { ok: false, error: error?.message || '扩展上下文已失效，请重新加载扩展' });
  }
});

sendToPage('READY', 'startup', { version: chrome.runtime.getManifest().version });
