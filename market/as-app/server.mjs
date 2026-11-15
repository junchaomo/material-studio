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
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

const host = process.env.AS_HOST || process.env.HOST || '127.0.0.1';
const port = Number(process.env.AS_PORT || process.env.PORT || 0);
const home = process.env.MATERIAL_STUDIO_HOME || 'D:\\projects\\material-studio';
const apiBase = process.env.MATERIAL_STUDIO_API || 'http://127.0.0.1:4191';
const webBase = process.env.MATERIAL_STUDIO_WEB || 'http://127.0.0.1:4173';
const launcher = join(home, 'scripts', 'launch-local.mjs');

let launching = false;
let lastLaunchAt = 0;

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
    return response.status >= 200 && response.status < 400;
  }catch{
    return false;
  }
}

async function hubManaged(){
  // 工作台的本地管理接口需要网关令牌：令牌由工作台自己下发，这里即取即用，不落盘、不外发。
  try{
    const config = await fetch(apiBase + '/api/config', {signal: AbortSignal.timeout(3000), redirect: 'error'}).then((r) => r.json());
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
function ensureWorkbench(){
  if (launching) return;
  if (Date.now() - lastLaunchAt < 60_000) return;
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
      env: {...process.env, MATERIAL_STUDIO_HOME: home, JG_SUPPRESS_OPEN: '1'},
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
function proxy(req, res, url){
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

  if (url.pathname === '/health') return json(res, 200, {ok: true, app: 'jg-material-studio', workbench: webBase});

  if (url.pathname === '/api/ready' && req.method === 'GET'){
    const ready = await webReady();
    if (!ready) ensureWorkbench();
    return json(res, 200, {ready, detail: ready ? '工作台已就绪，正在进入…' : '等待本机工作台开始监听…'});
  }

  if (url.pathname === '/api/status' && req.method === 'GET'){
    const health = await workbenchHealth();
    const hub = await hubManaged();
    return json(res, 200, {
      running: !!health,
      workbenchUrl: webBase + '/',
      apiBase,
      home,
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
    if (await webReady()) return json(res, 200, {ok: true, alreadyRunning: true, workbenchUrl: webBase + '/'});
    ensureWorkbench();
    const started = Date.now();
    while (Date.now() - started < 120_000){
      if (await webReady()) return json(res, 200, {ok: true, alreadyRunning: false, workbenchUrl: webBase + '/'});
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
