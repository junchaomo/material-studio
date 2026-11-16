/**
 * 材质提取 · 应用包入口
 *
 * 角色：企业内部中枢 应用宿主运行时 里的应用入口。
 * 1. 中枢的工作区只能导航到本进程的地址（127.0.0.1:AS_PORT），所以这里把根路径及所有页面请求
 *    反向代理到本机材质工作台（默认 127.0.0.1:4173）——点开应用看到的就是完整工作台界面；
 * 2. 工作台没起时自动拉起（本机 scripts/launch-local.mjs），等待期间返回可自刷新的等待页；
 * 3. /api/status 与 /api/launch 供中枢 AI 查询与调度。
 *
 * 环境变量（由 应用宿主运行时 注入）：AS_HOST / AS_PORT / AS_DATA_DIR / AS_APP_ID
 * 应用参数：MATERIAL_STUDIO_HOME（工作台根目录）
 *
 * 只监听运行时给定的地址，只代理与探测本机回环上的工作台，不做任何外发。
 */
import {createServer, request as httpRequest} from 'node:http';
import {existsSync, readFileSync} from 'node:fs';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';

const host = process.env.AS_HOST || process.env.HOST || '127.0.0.1';
const port = Number(process.env.AS_PORT || process.env.PORT || 0);
const home = process.env.MATERIAL_STUDIO_HOME || 'D:\\projects\\material-studio';
const apiBase = process.env.MATERIAL_STUDIO_API || 'http://127.0.0.1:4191';
const webBase = process.env.MATERIAL_STUDIO_WEB || 'http://127.0.0.1:4173';
const launcher = join(home, 'scripts', 'launch-local.mjs');
const localDataDir = process.env.AS_DATA_DIR ? join(process.env.AS_DATA_DIR, 'material') : join(home, 'local-data');
const gateRequired = Boolean(process.env.AS_APP_ID && process.env.AS_HUB_URL);
const gateSessions = new Map();
const GATE_TTL_MS = 8 * 3600 * 1000;
const GATE_COOKIE = 'jg_as_gate';
const gateFile = join(home, 'local-data', 'gate-internal');
function internalGate(){try{return existsSync(gateFile) ? readFileSync(gateFile, 'utf8').trim() : '';}catch{return '';}}
function signSession(token){return token + '.' + createHmac('sha256', internalGate()).update(token).digest('hex');}
function validSession(value){
  const text = String(value || ''), dot = text.lastIndexOf('.');
  if (dot <= 0) return false;
  const token = text.slice(0, dot), supplied = text.slice(dot + 1), expected = createHmac('sha256', internalGate()).update(token).digest('hex');
  return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

let launching = false;
let lastLaunchAt = 0;

function parseCookies(req){
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

async function verifyHubContext(userId, contextToken){
  try{
    const response = await fetch(String(process.env.AS_HUB_URL).replace(/\/+$/, '') + '/api/as/verify-context', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({appId: process.env.AS_APP_ID, contextToken}),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json();
    return Boolean(result?.ok && result.userId === userId);
  }catch{
    return false;
  }
}

function rejectGate(res, pathname){
  if (String(pathname).startsWith('/api/')) {
    json(res, 401, {success: false, error: '请从智能中枢的应用入口打开本应用；直接访问应用端口没有中枢账号上下文。', code: 'AS_ACCOUNT_GATE_REQUIRED'});
    return false;
  }
  res.writeHead(401, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
  res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>需要中枢账号</title><body style="font-family:system-ui,sans-serif;background:#f7f8fa;color:#1f2328;padding:48px"><h2>需要中枢账号</h2><p>请从智能中枢的应用入口打开本应用；直接访问应用端口没有中枢账号上下文。</p></body></html>');
  return false;
}

function gateSessionUser(req){
  const signed = parseCookies(req)[GATE_COOKIE] || '';
  const dot = signed.lastIndexOf('.');
  const token = dot > 0 ? signed.slice(0, dot) : '';
  const entry = token ? gateSessions.get(token) : null;
  if (entry && entry.exp > Date.now() && validSession(signed)) return entry.user;
  if (entry) gateSessions.delete(token);
  return '';
}

async function gate(req, res, url){
  if (!gateRequired || url.pathname === '/health' || req.method === 'OPTIONS') return true;
  if (gateSessionUser(req)) return true;
  const userId = String(url.searchParams.get('asUser') || '').trim();
  const contextToken = String(url.searchParams.get('asContext') || '').trim();
  if (!userId || !contextToken) return rejectGate(res, url.pathname);
  if (!await verifyHubContext(userId, contextToken)) return rejectGate(res, url.pathname);
  const newToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  gateSessions.set(newToken, {user: userId, exp: Date.now() + GATE_TTL_MS});
  const signed = signSession(newToken);
  // 首次请求既要把会话发给浏览器，也要让本次代理到 4173 的请求带上它，
  // 否则工作台中间件会把这次请求当成未登录并拒绝。
  const priorCookie = String(req.headers.cookie || '');
  req.headers.cookie = (priorCookie ? priorCookie + '; ' : '') + `${GATE_COOKIE}=${signed}`;
  res.setHeader('set-cookie', `${GATE_COOKIE}=${signed}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(GATE_TTL_MS / 1000)}`);
  return true;
}

async function workbenchConfig(){
  try{
    const secret = internalGate();
    return await fetch(apiBase + '/api/config', {headers: secret ? {'x-as-gate': secret} : {}, signal: AbortSignal.timeout(3000), redirect: 'error'}).then((r) => r.json());
  }catch{
    return null;
  }
}

async function workbenchDataDir(){
  const config = await workbenchConfig();
  return String(config?.dataDir || '');
}

function json(res, status, body){
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  res.end(JSON.stringify(body));
}

async function workbenchHealth(){
  try{
    const response = await fetch(apiBase + '/api/health', {signal: AbortSignal.timeout(3000), redirect: 'error'});
    if (!response.ok) return null;
    return await response.json();
  }catch{
    return null;
  }
}

async function webReady(){
  try{
    const response = await fetch(webBase + '/', {signal: AbortSignal.timeout(4000), redirect: 'manual'});
    return response.status >= 200 && response.status < 400 || response.status === 401;
  }catch{
    return false;
  }
}

async function hubManaged(){
  // 工作台的本地管理接口需要网关令牌：令牌由工作台自己下发，这里即取即用，不落盘、不外发。
  try{
    const secret = internalGate();
    const config = await fetch(apiBase + '/api/config', {headers: secret ? {'x-as-gate': secret} : {}, signal: AbortSignal.timeout(3000), redirect: 'error'}).then((r) => r.json());
    if (!config?.token) return null;
    const response = await fetch(apiBase + '/api/local/preferences', {
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
      headers: {authorization: 'Bearer ' + config.token},
    });
    if (!response.ok) return null;
    const data = await response.json();
    const models = (data?.models || []).map((item) => ({kind: item.kind, name: item.name, model: item.model, source: item.source || 'local'}));
    return {managed: !!data?.hub?.managed, models};
  }catch{
    return null;
  }
}

/** 拉起工作台；同一时间只允许一次，且 60 秒内不重复触发。 */
function ensureWorkbench(force = false){
  if (launching) return;
  if (!force && Date.now() - lastLaunchAt < 60_000) return;
  launching = true;
  lastLaunchAt = Date.now();
  if (!existsSync(launcher)){
    launching = false;
    console.error('[jg-material-studio] 启动脚本不存在：' + launcher);
    return;
  }
  try{
    const child = spawn(process.execPath, [launcher], {
      cwd: home,
      env: {...process.env, MATERIAL_STUDIO_HOME: home, LOCAL_DATA_DIR: localDataDir, JG_SUPPRESS_OPEN: '1'},
      stdio: 'ignore',
      detached: false,
      windowsHide: true,
    });
    child.on('exit', () => { launching = false; });
    child.on('error', () => { launching = false; });
  }catch(error){
    launching = false;
    console.error('[jg-material-studio] 拉起失败：' + (error?.message || error));
  }
}

/** 工作台必须使用当前中枢账号的数据目录；账号切换后旧进程会被 launcher 回收并按新目录重建。 */
async function ensureWorkbenchForAccount(){
  const health = await workbenchHealth();
  if (health) {
    const config = await workbenchConfig();
    const currentDir = String(config?.dataDir || '');
    if (!currentDir || resolve(currentDir) !== resolve(localDataDir) || (gateRequired && config?.gate !== true)) {
      ensureWorkbench(true);
      return false;
    }
    return true;
  }
  ensureWorkbench();
  return false;
}

const waitingPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>材质提取 · 正在启动</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light}
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
font-family:-apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;background:#f7f8fa;color:#1f2328}
.card{width:min(520px,88vw);padding:32px 34px;background:#fff;border:1px solid #e6e8eb;border-radius:14px;
box-shadow:0 1px 2px rgba(16,24,40,.04)}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#2f6fdf;margin-right:10px;
vertical-align:middle;animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.25}50%{opacity:1}}
h1{font-size:17px;margin:0 0 10px;font-weight:600}
p{font-size:13.5px;line-height:1.7;color:#57606a;margin:0 0 6px}
.hint{display:block;font-size:12.5px;color:#8b949e;margin-top:14px}
</style></head>
<body><div class="card">
<h1><span class="dot"></span>正在启动材质提取工作台</h1>
<p>首次启动需要编译前端与图像服务，通常 1~2 分钟；服务就绪后本页会自动进入工作台。</p>
<p id="detail">正在检查本机服务…</p>
<span class="hint">若长时间停在这里，请查看 <code>local-data/launcher-*.log</code>。</span>
</div>
<script>
async function tick(){
  try{
    const r = await fetch('/api/ready', {cache: 'no-store'});
    const b = await r.json();
    document.getElementById('detail').textContent = b.detail || '';
    if (b.ready){ location.replace('/'); return; }
  }catch(e){
    document.getElementById('detail').textContent = '本机服务暂未响应，继续等待…';
  }
  setTimeout(tick, 2000);
}
tick();
</script></body></html>`;

function sendWaiting(res){
  res.writeHead(503, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
  res.end(waitingPage);
}

/** 把请求原样转给工作台；目标不可达时返回等待页并触发自动拉起。 */
async function proxy(req, res, url){
  if (!await ensureWorkbenchForAccount()) return sendWaiting(res);
  let target;
  try{ target = new URL(webBase); }catch{ return sendWaiting(res); }
  const upstream = httpRequest({
    host: target.hostname,
    port: Number(target.port || 80),
    method: req.method,
    path: (url.pathname || '/') + (url.search || ''),
    headers: {...req.headers, host: target.host},
  }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', () => {
    ensureWorkbench();
    if (!res.headersSent) sendWaiting(res);
    else res.end();
  });
  upstream.setTimeout(30_000, () => { upstream.destroy(); });
  req.pipe(upstream);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + host + ':' + port);

  if (url.pathname === '/api/gate/check' && req.method === 'GET'){
    const user = gateSessionUser(req);
    return user ? json(res, 200, {ok: true, user}) : json(res, 401, {ok: false, code: 'AS_ACCOUNT_GATE_REQUIRED'});
  }

  if (!await gate(req, res, url)) return;

  if (url.pathname === '/health') return json(res, 200, {ok: true, app: 'jg-material-studio', workbench: webBase});

  if (url.pathname === '/api/ready' && req.method === 'GET'){
    const running = await webReady();
    const currentDir = running ? await workbenchDataDir() : '';
    const ready = Boolean(running && currentDir && resolve(currentDir) === resolve(localDataDir));
    if (!ready) await ensureWorkbenchForAccount();
    return json(res, 200, {ready, detail: ready ? '工作台已就绪，正在进入…' : '正在切换到当前中枢账号的数据目录…'});
  }

  if (url.pathname === '/api/status' && req.method === 'GET'){
    const health = await workbenchHealth();
    const hub = await hubManaged();
    return json(res, 200, {
      running: !!health,
      workbenchUrl: webBase + '/',
      apiBase,
      home,
      dataDir: localDataDir,
      gate: gateRequired ? 'central-account' : 'standalone',
      models: {
        source: hub?.managed ? 'hub' : 'local',
        managedByHub: hub?.managed || false,
        models: hub?.models || [],
        note: hub?.managed ? '识别与区域发现由中枢提供，纹理重绘使用本机配置' : '全部使用本机管理中心配置的模型',
      },
      checkedAt: new Date().toISOString(),
    });
  }

  if (url.pathname === '/api/launch' && req.method === 'POST'){
    if (await ensureWorkbenchForAccount()) return json(res, 200, {ok: true, alreadyRunning: true, workbenchUrl: webBase + '/'});
    const started = Date.now();
    while (Date.now() - started < 120_000){
      if (await ensureWorkbenchForAccount()) return json(res, 200, {ok: true, alreadyRunning: false, workbenchUrl: webBase + '/'});
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return json(res, 504, {ok: false, error: '工作台未在 120 秒内就绪，请查看 local-data/launcher-*.log'});
  }

  return proxy(req, res, url);
});

server.listen(port, host, () => {
  console.log(`[jg-material-studio] AS app on http://${host}:${port} · web=${webBase} · home=${home}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
