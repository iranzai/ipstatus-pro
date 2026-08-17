const fields = {
  ip: document.querySelector('#ip-address'), version: document.querySelector('#ip-version'),
  asn: document.querySelector('#asn'), company: document.querySelector('#company'),
  country: document.querySelector('#country'), city: document.querySelector('#city'),
  coordinates: document.querySelector('#coordinates'), timezone: document.querySelector('#timezone'),
  state: document.querySelector('.eyebrow'), stateLabel: document.querySelector('#state-label'),
  error: document.querySelector('#error'), refresh: document.querySelector('#refresh'),
};

function setText(element, value, fallback = '暂无数据') {
  element.textContent = value || fallback;
}

function parseTrace(body) {
  return Object.fromEntries(String(body || '').split('\n').map((line) => line.split('=')).filter((parts) => parts.length === 2));
}

async function pageOrigin() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url || '');
    if (['127.0.0.1', 'localhost', 'ipstatus.net', 'www.ipstatus.net'].includes(url.hostname)) return url.origin;
  } catch {}
  return 'https://ipstatus.net';
}

async function proxyFetch(url) {
  const response = await chrome.runtime.sendMessage({ type: 'PROXY_FETCH', request: { url, method: 'GET' } });
  if (!response?.ok) throw new Error(response?.error || '出口探测失败');
  return response.response;
}

async function fetchReportWithFallback(ip, origin) {
  const origins = [origin, 'http://127.0.0.1:8081', 'http://localhost:8081'].filter((value, index, list) => value && list.indexOf(value) === index);
  let lastError = null;
  for (const base of origins) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${base}/api/v1/ip?ip=${encodeURIComponent(ip)}`, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
      const report = await response.json().catch(() => ({}));
      if (response.ok) return report;
      lastError = new Error(report?.error || `IP 查询失败（HTTP ${response.status}）`);
      if (![502, 503, 504, 522, 524].includes(response.status)) throw lastError;
    } catch (error) {
      lastError = error?.name === 'AbortError' ? new Error('IP 查询超时，请稍后重试') : error;
    } finally { clearTimeout(timeout); }
  }
  throw lastError || new Error('IP 查询失败');
}

function renderReport(report, trace) {
  const network = report?.network || {};
  const location = report?.location || {};
  const country = [location.country_code || trace.loc, location.country].filter(Boolean).join(' · ');
  const coordinates = Number(location.latitude) !== 0 || Number(location.longitude) !== 0 ? `${location.latitude}, ${location.longitude}` : '';
  setText(fields.ip, report?.ip || trace.ip);
  setText(fields.version, String(report?.ip || trace.ip || '').includes(':') ? 'IPv6' : 'IPv4', '--');
  setText(fields.asn, network.asn);
  setText(fields.company, network.organization || network.isp);
  setText(fields.country, country);
  setText(fields.city, [location.city, location.region].filter(Boolean).join(' · '));
  setText(fields.coordinates, coordinates);
  setText(fields.timezone, location.timezone);
}

async function loadProfile() {
  fields.refresh.disabled = true;
  fields.state.className = 'eyebrow';
  fields.stateLabel.textContent = '正在检测';
  fields.error.hidden = true;
  try {
    const traceResponse = await proxyFetch('https://cloudflare.com/cdn-cgi/trace');
    const trace = parseTrace(traceResponse.body);
    if (!trace.ip) throw new Error('未能获取浏览器出口 IP');
    setText(fields.ip, trace.ip);
    setText(fields.version, trace.ip.includes(':') ? 'IPv6' : 'IPv4');
    setText(fields.country, trace.loc);
    const origin = await pageOrigin();
    const report = await fetchReportWithFallback(trace.ip, origin);
    renderReport(report, trace);
    fields.state.className = 'eyebrow is-ready';
    fields.stateLabel.textContent = '查询完成';
  } catch (error) {
    fields.state.className = 'eyebrow is-error';
    fields.stateLabel.textContent = '部分数据不可用';
    fields.error.textContent = error?.message || '查询失败';
    fields.error.hidden = false;
  } finally {
    fields.refresh.disabled = false;
  }
}

fields.refresh.addEventListener('click', loadProfile);
document.querySelector('#open-page').addEventListener('click', async () => {
  const origin = await pageOrigin();
  const target = `${origin}/streaming`;
  const tabs = await chrome.tabs.query({ url: [`${origin}/streaming*`, `${origin}/streaming*`] });
  if (tabs[0]?.id) return chrome.tabs.update(tabs[0].id, { active: true });
  return chrome.tabs.create({ url: target });
});

loadProfile();


