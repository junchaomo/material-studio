# 上架材料 · 材质提取（企业内部中枢 应用市场）

这是「材质提取」按**应用**形态上架企业内部中枢应用市场所需的登记材料。与插件形态的区别：应用是接入登记（地址 + 健康检查 + 权限声明），插件是可安装的插件 Bundle 包（见 `../plugin/`）。两者共用同一份代码，应用形态更适合按组织授权使用的内部工具。

## 目录

```
market/
├── app-manifest.json           # 应用登记清单（中枢 register 接口 + 正式市场字段）
├── icon.svg / icon-512.png     # 应用图标（与工作台左上角标识同源：Layers3 图层字形 + 品牌蓝底）
├── screenshots/
│   ├── home.png                # 项目概览
│   └── settings.png            # 模型配置（中枢托管前的本机形态）
├── app-market.txt              # 市场卡片文案（名称/一句话/简介）
└── README.md                   # 本文：接入方式、审核清单、上架步骤
```

## 接入方式

| 项 | 值 |
| --- | --- |
| 应用地址 | `http://127.0.0.1:4173/app` |
| 业务 API | `http://127.0.0.1:4191`（界面经 `/api/*` 重写） |
| 健康检查 | `GET http://127.0.0.1:4191/api/health` → `{"ok":true,"mode":"local","database":"sqlite"}` |
| 启动方式 | `node scripts/launch-local.mjs`（构建后端 + 起服务 + 打开浏览器）；中枢插件环境由 `plugin/index.js` 拉起 |
| 运行依赖 | Node 22、Python 3（本机图像服务 4192）、无需外网数据库 |
| 端口 | 4173 界面 / 4191 业务 API / 4193 本机管理中心 / 4192 图像服务 / 4198 中枢模型代理（仅插件模式） |

应用是**本机运行**的形态：中枢只做目录登记与授权，员工在自己机器上启动后访问 `127.0.0.1`。因此市场卡片里不写公网域名，健康检查由本机侧自检；如果后续要改成集中部署，把 `appUrl`/`apiBase` 换成服务器地址即可，应用本身不需要改造。

## 模型来源（与插件形态一致）

- 中枢分配模型时，插件写 `local-data/plugin/hub-models.json`，应用经 `MATERIAL_STUDIO_HUB_MODELS` 读取，识别与区域发现锁定中枢模型，模型配置页显示「中枢托管」；
- 中枢未分配模型时自动回落本机管理中心配置，界面明确提示，不会静默失败；
- 纹理重绘暂无中枢生图通道，保留本机配置（这一条必须在市场详情里如实标注）。

## 权限与数据边界

申请权限（与 `app-manifest.json` 一致）：

1. 监听本机回环端口 4173 / 4191 / 4193 / 4192（插件模式另加 4198）；
2. 读写本机 `local-data/`（项目、原图、材质成果、加密后的模型密钥）；
3. 调用中枢已授权的模型（材质识别、区域发现）；
4. 调用本机管理中心维护模型密钥与接口地址。

数据边界：原图与 Mask 只在本机处理与保存；仅把识别所需的裁剪图/正视样本发送给所选模型服务；中枢密钥不写入应用数据库，只在插件代理进程内存中。

## 审核清单（提交前自检）

- [x] 健康检查端点可用：`GET /api/health` 返回 `ok:true`
- [x] 权限声明与实际行为一致（回环监听、本机目录、中枢模型）
- [x] 无国外模型依赖：protocol 白名单仅 `dashscope` / `openai`（中枢兼容接口）/ `volcengine`
- [x] 无硬编码密钥：密钥存本机加密库，中枢密钥在插件代理内
- [x] 版本记录已登记（`app-manifest.json.history`）
- [x] 图标与截图齐备（`icon-512.png`、`screenshots/`）
- [ ] 身份回调（SSO）：当前为单机工具，未接企业 SSO；如市场强制要求，需新增 `POST /api/identity/callback`（待排期，本次不伪造）
- [ ] 集中部署形态（可选）：`appUrl` 指向服务器时需补反向代理与鉴权

## 上架步骤

1. 在企业内部中枢 → 应用 → 「提交应用」，填 `app-manifest.json` 的 `name` / `desc` / `dept` / `version` / `usage`；
2. 平台返回接入检测项：URL 可达性、身份回调、权限声明、健康检查；
3. 管理员「审核通过」→ 状态变为 `published`，员工在应用列表可见并可「启动应用」；
4. 更新版本走 `POST /api/apps/version`（版本号 + 变更说明），不要重复提交新应用条目。

> 说明：本机演示环境（`D:\projects\hub-prototype`）的 apps 数据是**内存态**，服务重启后登记会清空；正式环境由中枢的管理中心持久化。若在演示环境登记，仅用于走通流程与截图取证。

## 已完成的登记（演示环境）

| 项 | 值 |
| --- | --- |
| 中枢地址 | `http://127.0.0.1:<hub-port>`（`PORT=<hub-port>` 启动 `hub-prototype/server.mjs`，避免与材质工作台的 4173 冲突） |
| 应用编号 | `<登记号>` |
| 状态 | `published`（已登记 → 管理员审核通过） |
| 可见性 | 以「普通员工 · 互联网」视角查询 `GET /api/apps` 可见，可「启动应用」 |
| 维护人 | 平台管理员——演示环境用运维管理员账号提交，正式环境应改用本人账号，维护人字段才会落到本人 |
| 检测项 | 平台返回：URL 可达性 / 身份回调 / 权限声明 / 健康检查（演示环境只做枚举，不实际探测） |

验证命令：

```powershell
Invoke-RestMethod 'http://127.0.0.1:<hub-port>/api/apps' -Headers @{Cookie='<session-cookie>'} | ConvertTo-Json -Depth 4
Invoke-RestMethod 'http://127.0.0.1:4191/api/health' | ConvertTo-Json
```

**中枢演示版的已知缺口**：`public/app.js` 里有 `renderApps`（应用列表）与「启动应用」交互，但左侧导轨与「更多」菜单都没有指向 `apps` 视图的入口，所以应用列表在界面上点不到，只能通过 `/api/apps` 或全局搜索的应用分组看到。正式版需要在中枢侧补一个「应用」导航项；这是中枢的缺口，不是本应用的问题，本应用侧不需要改动。

---

## 目标环境：企业内部中枢客户端 1.0（应用包）

正式上架目标是 `D:\projects\client-app`（Electron 客户端 + `server.mjs`），它用的是 **应用包**通道，跟上面原型 hub 的「地址登记」不是一回事：客户端要求一个能自己跑起来的 ZIP 包，包内根目录有 `app.json`，审核通过后由 应用宿主运行时在本机 spawn 入口进程托管。

### 包与代码

| 项 | 值 |
| --- | --- |
| 源文件 | `market/as-app/`（`app.json`、`server.mjs`、`assets/icon-512.png`、`README.md`） |
| 打包产物 | `market/dist/jg-material-studio-0.1.0.zip`（约 25 KB） |
| appId | `jg-material-studio` |
| runtime / entry | `node` / `server.mjs` |
| 健康检查 | `GET /health` → `{"ok":true,"app":"jg-material-studio"}` |
| 能力 | tool `material_studio_launch`（POST `/api/launch`）、resource `material_studio_status`（GET `/api/status`） |
| 托管方式 | 应用宿主运行时注入 `AS_HOST/AS_PORT/AS_DATA_DIR`，`cwd` 为应用版本目录；应用自己起 HTTP 供中枢调用 |

### 包契约要点（照客户端仓库的应用包规范与宿主运行时模块落地）

- `app.json` 必填：`id`、`name`、`version`、`runtime`（只支持 `node` / `python`）、`entry`；
- `capabilities.tools/resources` 每项：`name`（`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`）、`method`（仅 GET/POST）、`path`（包内绝对路径，禁 `..`/`?`/`#`）、`timeoutMs` 1–60 秒、`sideEffect`；
- 包体策略：代码单文件 8 MB / 代码总 64 MB / 资源单文件 64 MB / 总量 256 MB / 4000 条目，资源放 `assets/`；
- 启动探测：入口必须在 `AS_HOST:AS_PORT` 起 HTTP 并在 30 秒内通过 `health.path`。

### 上架步骤（客户端）

1. 上传 ZIP：插件与技能 → 应用 → 右上「添加」→ 选择 `market/dist/jg-material-studio-0.1.0.zip`；
2. 提交记录走 `POST /api/应用提交接口`（body `{name, version, fileId, desc}`），自动检测结果决定 `pending` 还是 `rejected`；
3. 管理员 `POST /api/应用提交接口/review` `{action:'approve'}` → 包解压到 `data/apps/jg-material-studio/versions/0.1.0`，写入 `current.json`，应用市场出现 `kind:'app'` 条目（未安装态）；
4. 员工侧安装后 应用宿主运行时启动入口进程，中枢 AI 即可调用 `material_studio_launch` / `material_studio_status`。

### 提交前自检结果（用客户端自带检测器）

```powershell
cd D:\projects\material-studio
node .local\scan-app-package.mjs
```

| 检测项 | 结论 |
| --- | --- |
| AS App 清单 | 通过（必填字段完整，node） |
| 应用入口 | 通过（`server.mjs` 存在） |
| 应用能力 | 通过（1 工具 / 1 资源） |
| 包体策略 | 通过（代码 2 个 / 资源 1 个，资源 SHA-256 1/1） |
| 权限声明 | 通过 |
| 静态安全扫描 | **待复核**：`server.mjs` 含 `child_process`（启动工作台）与回环 http 调用 |
| 隔离测试 | 未执行（该版本只做静态检查） |

「待复核」两项在审核说明里如实解释即可：子进程只执行本机 `scripts/launch-local.mjs`，网络目标只有 `127.0.0.1:4191` 与 `127.0.0.1:4173`。

### 提交状态（已提交并上架，2026-11-15）

| 项 | 值 |
| --- | --- |
| 市场条目 | `<条目ID>`（kind=app，v0.1.1，可用） |
| 提交记录 | `<提交记录ID>`（pending → approved，自动检测 0 项不通过） |
| 上传包 | `<包ID>` · `jg-material-studio-0.1.1.zip`（28,352 字节） |
| 落盘位置 | `data/apps/jg-material-studio/versions/0.1.1` |

**入口形态已从「薄壳 JSON」改为「反代工作台」**：中枢的工作区只能导航到 `127.0.0.1:AS_PORT`，所以 0.1.0 那版打开只有一行 JSON 404。0.1.1 的 `server.mjs` 把 `/` 及所有页面请求反向代理到本机工作台 `127.0.0.1:4173`，工作台没起时自动拉起并返回可自刷新的启动页（`/api/ready` 轮询 2 秒），就绪后自动进入完整界面。

实测（走 应用宿主运行时真实链路）：

```
POST /api/as/start      => 200 port=55240 pid=84668 用时 517ms（工作台已在跑，属热启动）
GET  http://127.0.0.1:55240/  => 200 len=26326，含 _next/static 脚本（即工作台页面）
GET  /api/as/status     => running=true leaseCount=1
POST /api/as/stop       => stopped=true
runtime.json            => startTimeoutMs=30000（app.json 未申报，取默认值）
```

已知边界（如实登记，不影响上架）：

1. `app.json.env.MATERIAL_STUDIO_HOME` 指向本机源工程 `D:\projects\material-studio`——这是**本机薄壳**形态，包体不含工作台代码；换机器部署必须同步改这个路径或改为中心化部署。
2. 冷启动（工作台未运行）需要先跑 `scripts/launch-local.mjs`，其中会 `next dev` 编译前端，首次约 1~2 分钟；这段时间工作区显示启动页而不是白屏。
3. 拉起脚本末尾会 `explorer.exe` 打开一次默认浏览器（应用侧既有行为，未改）；中枢里正常使用不会触发，因为工作台通常已在运行。
4. 纹理重绘仍走本机管理中心配置的模型，中枢暂未提供生图通道。