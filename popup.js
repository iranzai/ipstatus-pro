const fields = {
  ip: document.querySelector('#ip-address'), version: document.querySelector('#ip-version'),
  asn: document.querySelector('#asn'), company: document.querySelector('#company'),
  country: document.querySelector('#country'), city: document.querySelector('#city'),
  coordinates: document.querySelector('#coordinates'), nature: document.querySelector('#ip-nature'),
  state: document.querySelector('.eyebrow'), stateLabel: document.querySelector('#state-label'),
  error: document.querySelector('#error'), refresh: document.querySelector('#refresh'), copy: document.querySelector('#copy-ip'),
};

let detectedExits = [];

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

async function fetchJSON(url) {
  const response = await proxyFetch(url);
  if (!response.ok) throw new Error(`RIPE 查询失败（HTTP ${response.status}）`);
  try { return JSON.parse(response.body); } catch { throw new Error('RIPE 返回了无法解析的数据'); }
}

function firstMaxMindLocation(payload) {
  const resources = payload?.data?.located_resources || [];
  return resources.flatMap((item) => item.locations || [])
    .sort((a, b) => Number(b.covered_percentage || 0) - Number(a.covered_percentage || 0))[0] || {};
}

async function fetchRipeReport(ip) {
  const resource = encodeURIComponent(ip);
  const networkInfo = await fetchJSON(`https://stat.ripe.net/data/network-info/data.json?resource=${resource}`);
  const asn = String(networkInfo?.data?.asns?.[0] || '');
  const prefix = String(networkInfo?.data?.prefix || ip);
  const [overviewResult, geoResult, rirResult] = await Promise.allSettled([
    asn ? fetchJSON(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${encodeURIComponent(asn)}`) : Promise.resolve(null),
    fetchJSON(`https://stat.ripe.net/data/maxmind-geo-lite/data.json?resource=${encodeURIComponent(prefix)}`),
    fetchJSON(`https://stat.ripe.net/data/rir-geo/data.json?resource=${resource}`),
  ]);
  const overview = overviewResult.status === 'fulfilled' ? overviewResult.value : null;
  const geo = geoResult.status === 'fulfilled' ? firstMaxMindLocation(geoResult.value) : {};
  const rir = rirResult.status === 'fulfilled' ? rirResult.value : null;
  const registeredCountry = String(rir?.data?.located_resources?.[0]?.location || '').toUpperCase();
  return {
    asn: asn ? `AS${asn}` : '',
    organization: String(overview?.data?.holder || ''),
    prefix,
    country: String(geo.country || '').toUpperCase(),
    city: String(geo.city || ''),
    latitude: geo.latitude,
    longitude: geo.longitude,
    registeredCountry,
    partial: overviewResult.status === 'rejected' || geoResult.status === 'rejected' || rirResult.status === 'rejected',
  };
}

function renderReport(report, trace) {
  const coordinates = Number.isFinite(Number(report.latitude)) && Number.isFinite(Number(report.longitude))
    ? `${report.latitude}, ${report.longitude}`
    : '';
  const locatedCountry = report.country || trace.loc || '';
  const country = [locatedCountry, report.registeredCountry ? `注册国 ${report.registeredCountry}` : ''].filter(Boolean).join(' - ');
  const nature = locatedCountry && report.registeredCountry
    ? (locatedCountry === report.registeredCountry ? '原生 IP' : '广播 IP')
    : '类型待确认';
  setText(fields.ip, trace.ip);
  setText(fields.asn, report.asn);
  setText(fields.company, report.organization);
  setText(fields.country, country);
  setText(fields.city, report.city);
  setText(fields.coordinates, coordinates);
  setText(fields.nature, nature);
}

function validIP(value, version) {
  const ip = String(value || '').trim();
  if (version === 6) return ip.includes(':') && /^[0-9a-f:]+$/i.test(ip);
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) && ip.split('.').every((part) => Number(part) <= 255);
}

async function detectProtocolIP(url, version) {
  const response = await proxyFetch(url);
  if (!response.ok) throw new Error(`IPv${version} 出口返回 HTTP ${response.status}`);
  let ip = '';
  try { ip = String(JSON.parse(response.body)?.ip || ''); } catch { ip = String(response.body || ''); }
  if (!validIP(ip, version)) throw new Error(`未发现 IPv${version} 出口`);
  return { ip: ip.trim(), version };
}

async function detectExitIPs() {
  const [v4, v6, traceResult] = await Promise.allSettled([
    detectProtocolIP('https://api4.ipify.org?format=json', 4),
    detectProtocolIP('https://api6.ipify.org?format=json', 6),
    proxyFetch('https://cloudflare.com/cdn-cgi/trace'),
  ]);
  const exits = [];
  if (v4.status === 'fulfilled') exits.push(v4.value);
  if (v6.status === 'fulfilled') exits.push(v6.value);
  if (traceResult.status === 'fulfilled' && traceResult.value.ok) {
    const trace = parseTrace(traceResult.value.body);
    const version = String(trace.ip || '').includes(':') ? 6 : 4;
    if (validIP(trace.ip, version) && !exits.some((item) => item.ip === trace.ip)) exits.push({ ip: trace.ip, version });
  }
  return exits.sort((a, b) => a.version - b.version);
}

function renderExitSelector(exits, preferredIP = '') {
  fields.version.replaceChildren();
  for (const item of exits) {
    const option = document.createElement('option');
    option.value = item.ip;
    option.textContent = `IPv${item.version}`;
    fields.version.append(option);
  }
  fields.version.value = exits.some((item) => item.ip === preferredIP) ? preferredIP : exits[0]?.ip || '';
  fields.version.disabled = exits.length < 2;
}

async function loadSelectedProfile(ip) {
  const selected = detectedExits.find((item) => item.ip === ip);
  if (!selected) throw new Error('未找到可用出口 IP');
  fields.copy.disabled = true;
  setText(fields.ip, selected.ip);
  const report = await fetchRipeReport(selected.ip);
  renderReport(report, { ip: selected.ip, loc: '' });
  fields.state.className = report.partial ? 'eyebrow' : 'eyebrow is-ready';
  fields.stateLabel.textContent = report.partial ? '部分数据可用' : '查询完成';
  fields.copy.disabled = false;
}

async function loadProfile() {
  fields.refresh.disabled = true;
  fields.version.disabled = true;
  fields.copy.disabled = true;
  fields.state.className = 'eyebrow';
  fields.stateLabel.textContent = '正在检测';
  fields.error.hidden = true;
  try {
    const preferredIP = fields.version.value;
    detectedExits = await detectExitIPs();
    if (!detectedExits.length) throw new Error('未能获取 IPv4 或 IPv6 出口 IP');
    renderExitSelector(detectedExits, preferredIP);
    await loadSelectedProfile(fields.version.value);
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
fields.version.addEventListener('change', async () => {
  fields.error.hidden = true;
  fields.state.className = 'eyebrow';
  fields.stateLabel.textContent = '正在查询';
  try { await loadSelectedProfile(fields.version.value); } catch (error) {
    fields.state.className = 'eyebrow is-error';
    fields.stateLabel.textContent = '查询失败';
    fields.error.textContent = error?.message || 'RIPE 查询失败';
    fields.error.hidden = false;
  }
});
fields.copy.addEventListener('click', async () => {
  const ip = String(fields.ip.textContent || '').trim();
  if (!ip || ip === '正在读取…') return;
  try {
    await navigator.clipboard.writeText(ip);
    fields.copy.textContent = '✓';
    fields.copy.classList.add('is-copied');
    fields.copy.title = '已复制';
    setTimeout(() => {
      fields.copy.textContent = '⧉';
      fields.copy.classList.remove('is-copied');
      fields.copy.title = '复制 IP';
    }, 1200);
  } catch {
    fields.error.textContent = '复制失败，请手动选择 IP';
    fields.error.hidden = false;
  }
});
document.querySelector('#open-page').addEventListener('click', async () => {
  const origin = await pageOrigin();
  const target = `${origin}/streaming`;
  const tabs = await chrome.tabs.query({ url: `${origin}/streaming*` });
  if (tabs[0]?.id) return chrome.tabs.update(tabs[0].id, { active: true });
  return chrome.tabs.create({ url: target });
});

loadProfile();


