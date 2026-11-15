# AI材质提取 · 本地版

本项目仅保留本机运行的材质提取应用。前端 React / Next.js，后端 Node.js，图像处理 Python。无需登录，不连接云数据库，不需要 GitHub、Vercel 或 Supabase。

## 启动

安装 Node.js 24 和 Python，执行 `npm install`。Python 依赖在 `backend/requirements.txt`，默认使用 `backend/.venv`。

双击“启动前后端.cmd”或执行 `npm run dev`，同时启动：

- 首页与工作台：http://127.0.0.1:4173
- 本地 API：127.0.0.1:4191
- 图像处理：127.0.0.1:4192
- 管理中心：http://127.0.0.1:4193（仅本机访问）

## 文件结构

- `frontend/`：首页、项目与文件夹、材质画布、精修及用户设置。
- `backend/local/`：SQLite、文件存储、任务、模型配置和管理中心。
- `backend/server/`：图像处理与模型适配。
- `backend/image_service/`：颜色和纹理识别、透视矫正与图像合成。
- `shared/`：类型、确认状态与统一删除和重试流程。
- `tests/`：本地功能及图像处理回归测试。
- `local-data/`：真实项目、图片、数据库与加密模型配置。

## 模型与数据

在本机管理中心保存模型密钥，在模型配置页选择每项功能使用的服务。只有用户主动操作才调用外部模型。

上传与本地提取不设固定图片大小上限。外部模型的传输规格仍适用：发送给百炼的超大图片生成独立识别副本，保留原始文件和本地提取样本。

备份时请完整复制 `local-data/`，不要分离数据库、图片、回执与模型加密密钥。不要将此目录或真实环境配置发送到公开仓库。

### 作为企业内部中枢插件运行

插件包在 `plugin/`（插件 Bundle：`package.json` + `index.js` + `cordis.patch.yml` + `model-proxy.mjs`，见 `plugin/README.md`）。安装后模型由中枢统一提供：

1. 插件启动本机回环 OpenAI 兼容代理（`127.0.0.1:4198`），中枢密钥只留在代理进程里；
2. 代理写出 `local-data/plugin/hub-models.json`，本应用通过 `MATERIAL_STUDIO_HUB_MODELS` 读取；
3. 材质识别与区域发现固定使用中枢模型（模型配置页显示「中枢托管」且不可在本机改选），纹理重绘仍用本机配置；
4. 描述文件缺失或不合规时自动回落单机模式，并按单机清单清理上一次残留的中枢模型行。

人工验证中枢模式（把描述文件指向任意本机代理即可）：设置 `MATERIAL_STUDIO_HUB_MODELS` 后重启后端，`GET /api/local/preferences` 会返回 `hub.managed=true`。

## 检查

`npm run typecheck`、`npm test`、`npm run build`。
Python：设置 `LOCAL_STORAGE_MODE=true`、`PYTHONPATH=backend` 后，使用虚拟环境运行 `python -m unittest discover -s tests -p 'test_*.py'`。

旧 Web 登录、会员支付、社区、线上部署和云端任务代码已移除。清理前源码另有本机压缩备份，不包含真实环境配置和用户数据。

## 关于源码中的内部标识

`jg-hub`（描述文件 `source`、插件来源字段）等字符串是与中枢侧约定的握手标识，改动会导致中枢侧拒绝接管模型，因此公开版本保留原值；它们只是协议常量，不代表产品名称。组织名、人员名、本机绝对路径与客户端实例端口已在公开版本中脱敏。
