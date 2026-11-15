/**
 * jg-material-studio：企业内部中枢插件（薄壳形态）
 *
 * 职责边界：
 * 1. 材质工作台仍是完整的本机应用（Next 前端 + 本机业务 API + Python 图像服务），
 *    由本插件负责拉起与收尾，不把它的界面搬进中枢；
 * 2. 模型一律由中枢提供：插件把中枢已配置的模型用本机回环代理暴露成 OpenAI 兼容端点，
 *    材质应用只拿到「127.0.0.1 + 一次性令牌」，中枢密钥不落材质应用的数据库；
 * 3. 中枢模型不可用（未配置密钥/代理未起）时，材质应用按单机模式启动，模型配置回落到本机设置，
 *    不静默失败、不编造模型。
 *
 * 装配：把本包放入 harness 工作区 packages/*，或作为 ZIP 上传插件市场；
 * 由中枢的插件管理器加载，配置项见 Config。
 */
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

export const name = 'jg-material-studio';

/** 只依赖中枢的调度生命周期，不注入 llm：本阶段模型转发走插件自带的本机代理。 */
export const inject = [];

export const Config = {
  appRoot: {type: 'string', description: '材质应用根目录（含 scripts/launch-local.mjs）'},
  launcher: {type: 'string', default: 'scripts/launch-local.mjs', description: '材质应用启动脚本，相对 appRoot'},
  proxyScript: {type: 'string', default: 'plugin/model-proxy.mjs', description: '模型代理脚本，相对 appRoot'},
  proxyPort: {type: 'number', default: 4198, description: '本机模型代理端口，只监听 127.0.0.1'},
  upstreamBaseURL: {type: 'string', description: '中枢模型上游的 OpenAI 兼容地址，例如百炼 compatible-mode 或 jg-model-gateway'},
  upstreamKeyEnv: {type: 'string', default: 'JG_MODEL_API_KEY', description: '上游密钥所在的环境变量名，密钥不上传、不写入插件包'},
  models: {
    type: 'array',
    default: [],
    description: '中枢分配给本插件的模型，元素形如 {id, kind, display}，kind 取 recognition / discovery',
  },
};

function resolveModels(config){
  const list = Array.isArray(config.models) ? config.models : [];
  return list
    .filter((m) => m && typeof m.id === 'string' && m.id.trim())
    .map((m) => ({id: m.id.trim(), kind: String(m.kind || 'recognition'), display: String(m.display || m.id)}))
    .filter((m) => ['recognition', 'discovery'].includes(m.kind));
}

function waitForFile(file, timeoutMs){
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (existsSync(file)) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(tick, 120);
    };
    tick();
  });
}

export function apply(ctx, config){
  const appRoot = path.resolve(String(config.appRoot || process.cwd()));
  const launcher = path.join(appRoot, String(config.launcher || 'scripts/launch-local.mjs'));
  if (!existsSync(launcher)) throw new Error('材质应用启动脚本不存在：' + launcher);

  const workDir = path.join(appRoot, 'local-data', 'plugin');
  mkdirSync(workDir, {recursive: true});
  const proxyConfigPath = path.join(workDir, 'model-proxy.json');
  const descriptorPath = path.join(workDir, 'hub-models.json');
  if (existsSync(descriptorPath)) rmSync(descriptorPath);

  const models = resolveModels(config);
  const upstreamKey = config.upstreamKeyEnv ? process.env[String(config.upstreamKeyEnv)] : '';
  const children = [];
  let appStarted = false;

  const startApp = (env) => {
    if (appStarted) return;
    appStarted = true;
    const child = spawn(process.execPath, [launcher], {
      cwd: appRoot,
      env: {...process.env, ...env},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', (code) => ctx.logger?.info?.(`材质工作台已退出（${code}）。`));
    children.push(child);
  };

  const dispose = () => {
    for (const child of children.splice(0)) {
      try { child.kill(); } catch {}
    }
  };
  ctx.on?.('dispose', dispose);

  if (!models.length || !config.upstreamBaseURL || !upstreamKey) {
    // 中枢尚未分配模型：按单机模式启动，界面里会提示“模型由本机配置提供”。
    ctx.logger?.warn?.('中枢未分配模型或未提供密钥，材质工作台按单机模式启动。');
    startApp({});
    return;
  }

  const token = randomBytes(24).toString('hex');
  writeFileSync(proxyConfigPath, JSON.stringify({
    listen: {host: '127.0.0.1', port: Number(config.proxyPort || 4198)},
    token,
    upstream: {baseURL: String(config.upstreamBaseURL), apiKey: String(upstreamKey)},
    models,
  }, null, 2) + '\n', 'utf8');

  const proxy = spawn(process.execPath, [
    path.join(appRoot, String(config.proxyScript || 'plugin/model-proxy.mjs')),
    '--config', proxyConfigPath,
    '--descriptor', descriptorPath,
  ], {cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe'], env: process.env});
  proxy.stdout?.on('data', (chunk) => ctx.logger?.info?.(String(chunk).trim()));
  proxy.stderr?.on('data', (chunk) => ctx.logger?.warn?.(String(chunk).trim()));
  children.push(proxy);

  waitForFile(descriptorPath, 10000).then((ready) => {
    if (!ready) {
      ctx.logger?.warn?.('模型代理未就绪，材质工作台按单机模式启动。');
      startApp({});
      return;
    }
    startApp({MATERIAL_STUDIO_HUB_MODELS: descriptorPath, MATERIAL_STUDIO_PLUGIN: 'jg-hub'});
  });
}
