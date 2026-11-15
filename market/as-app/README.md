# 材质提取 · 企业内部中枢应用包（AS App）

本目录是上架到企业内部中枢客户端（`client-app`）的 **应用包**源码，打包后由中枢
「应用市场」上传、审核，再由 应用宿主运行时在本机托管运行。

## 包结构

```
app.json          应用清单：id / name / version / runtime / entry / health / capabilities / permissions
server.mjs        应用入口：应用宿主运行时会以 `node server.mjs` 启动，监听 AS_HOST:AS_PORT
assets/           资源目录（图标等），不计入代码体积
dist/             打包产物（在 market/dist/ 下）
```

## 它做什么

这个包不是把工作台界面搬进中枢，而是一个 **本机薄壳入口**：

| 能力 | 类型 | 路径 | 作用 |
| --- | --- | --- | --- |
| `material_studio_launch` | tool（POST，有副作用） | `/api/launch` | 启动本机材质工作台；已在运行则直接复用，返回访问地址 |
| `material_studio_status` | resource（GET） | `/api/status` | 返回工作台是否在运行、地址、以及模型来源（中枢托管 / 本机配置） |
| `GET /health` | 健康检查 | `/health` | 应用宿主运行时启动后用它判定应用就绪 |

工作台本身仍是 `material-studio` 那套完整应用（Next 工作台 + 业务 API + Python 服务），
识别与区域发现的模型来自中枢托管（`MATERIAL_STUDIO_HUB_MODELS`），纹理重绘用本机配置。

## 运行参数

| 变量 | 来源 | 说明 |
| --- | --- | --- |
| `AS_HOST` / `AS_PORT` | 应用宿主运行时注入 | 应用必须监听的地址与端口 |
| `MATERIAL_STUDIO_HOME` | `app.json` 的 `env` | 工作台根目录，默认 `D:\projects\material-studio`；换机器时改这里重新打包 |
| `MATERIAL_STUDIO_API` | 可选 | 业务 API 地址，默认 `http://127.0.0.1:4191` |
| `MATERIAL_STUDIO_WEB` | 可选 | 工作台页面地址，默认 `http://127.0.0.1:4173` |

## 打包

```powershell
cd D:\projects\material-studio\market
Compress-Archive -Path 'as-app\*' -DestinationPath 'dist\jg-material-studio-0.1.0.zip' -Force
```

打开新版前先删掉旧 zip，避免 `Compress-Archive` 把旧内容混进去。

## 上架前自检

用客户端自带的检测器预检，四个必须项应为「通过」：

```powershell
cd D:\projects\material-studio
node .local\scan-app-package.mjs
```

预期结果：`kind: app`、`capabilities: tools 1 / resources 1`、清单/入口/能力/包体/权限五项通过；
「静态安全扫描」会标 **待复核**，原因是入口里有 `child_process`（启动工作台）和对回环地址的
http 调用，这两点在审核说明里写清楚即可。

## 已知边界

- 应用只服务 `/health`、`/api/status`、`/api/launch` 三个路由，不做图片上传与批量识别编排；
  提取流程仍在工作台界面里完成。
- 模型密钥不落应用包：识别/发现由中枢侧托管，重绘密钥保存在工作台本机 `local-data/model-secret.key`。
- 一台机器上同一 appId 只有一个进程，按账号隔离数据目录（应用宿主运行时规则）。
