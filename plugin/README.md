# jg-material-studio · 企业内部中枢插件

建筑材质识别与纹理重绘工作台的中枢插件。安装后，工作台**直接使用中枢已配置的 AI 模型**，用户不需要再填接口地址和 Key。

## 这个插件做了什么

| 能力 | 说明 |
| --- | --- |
| 拉起工作台 | 以薄壳方式启动本机材质应用（Next 前端 + 本机业务 API + Python 图像服务），不把界面搬进中枢 |
| 提供模型 | 读取中枢分配的模型，起一个**只监听 127.0.0.1** 的 OpenAI 兼容代理，工作台只拿到回环地址与一次性令牌 |
| 密钥隔离 | 中枢真实密钥只存在于插件代理进程内，不写进材质应用数据库、不出现在它的界面上 |
| 自动回落 | 中枢未分配模型或代理未就绪时，工作台按单机模式启动，模型配置回落到本机管理中心，不静默失败 |

本阶段由中枢接管 **材质信息识别** 与 **一键识别的区域发现**（都是视觉 chat 能力）。**纹理重绘**暂无中枢生图通道，仍使用本机管理中心里配置的模型，界面会明确标注。

## 目录结构

```
package.json           # 插件 Bundle 声明：dsh.bundle.patch -> cordis.patch.yml
index.js               # Cordis 插件：读配置 -> 起代理 -> 等描述文件 -> 起工作台 -> 退出时收尾
model-proxy.mjs        # 本机回环 OpenAI 兼容代理（GET /v1/models、POST /v1/chat/completions）
cordis.patch.yml       # 装配层：插入一条 material-studio 插件配置
README.md              # 本文
```

## 装配与配置

```yaml
- id: material-studio
  name: '@jg/jg-material-studio'
  config:
    appRoot: D:\projects\material-studio          # 材质应用根目录
    launcher: scripts/launch-local.mjs                  # 启动脚本（相对 appRoot）
    proxyScript: plugin/model-proxy.mjs
    proxyPort: 4198                                     # 只监听 127.0.0.1
    upstreamBaseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
    upstreamKeyEnv: JG_MODEL_API_KEY                    # 密钥只从环境/中枢凭据读取
    models:
      - { id: qwen3.8-max, kind: recognition, display: 企业内部中枢 · 企业模型 }
      - { id: qwen3.8-max, kind: discovery,   display: 企业内部中枢 · 区域发现 }
```

`kind` 只接受两项：

- `recognition`（必需）：材质信息识别，工作台的「步骤 2」；
- `discovery`（可选）：一键识别的区域发现，工作台的「步骤 4」。

## 描述文件契约（插件 → 工作台）

代理启动后写出 `local-data/plugin/hub-models.json`，工作台通过环境变量 `MATERIAL_STUDIO_HUB_MODELS` 指到它：

```json
{
  "version": 1,
  "source": "hub-prototype",
  "proxy": { "baseURL": "http://127.0.0.1:4198/v1", "token": "<一次性令牌>" },
  "models": [
    { "kind": "recognition", "name": "企业内部中枢 · 企业模型", "model": "qwen3.8-max" }
  ]
]
```

工作台侧的校验（`backend/local/hub-models.mjs`）：

- `proxy.baseURL` 必须是本机回环地址，且不能带账号、查询串；
- `token` 必填、不含换行；
- 至少提供一个 `recognition` 模型；
- 解析失败一律返回 `null` → 回落单机模式，界面上模型不会「凭空消失」而是回到本机配置。

## 权限与安全

- 代理只监听回环，非回环来源一律 403；令牌用 `timingSafeEqual` 比较；请求体上限 32MB；只开放两条路径，其他 404。
- 只转发中枢分配清单内的模型，未登记模型 403，防止用量不可归集。
- 工作台侧 `hubFetcher` 只允许打向描述文件登记的 `baseURL` 前缀，越界直接报错。
- 插件不读取中枢的会话、凭据文件、聊天记录，只使用分配到的模型与地址。

## 上架流程（企业内部中枢插件市场）

1. 打包：把本目录打成 ZIP，**根目录**必须直接包含 `package.json`、`index.js`、`cordis.patch.yml`、`model-proxy.mjs`、`README.md`；
2. 中枢校验：安全解压 → 格式与依赖校验（`dsh.bundle.patch` 指向的 `cordis.patch.yml` 必须存在）→ 权限核对（本插件声明：本机回环监听、拉起本机进程）→ 沙箱隔离测试；
3. 管理员审核 → 上架 → 一键安装；
4. 安装后由中枢注入 `upstreamBaseURL` 与 `upstreamKeyEnv` 对应的凭据，用户侧不再需要填 Key。

## 已知边界

- 官方 Harness 里模型统一走 `ctx.llm`，其 `ImageBlock` 必须挂在宿主 attachment 服务上，不能内联 base64。要让插件完全原生地调用 `ctx.llm`，需要补 attachment 适配；本阶段用「回环兼容代理」绕开这一层，代价是多一个本机端口（4198）。
- 纹理重绘（qwen-image 一类生图）尚无可用的中枢通道，v1 明确保留本机配置兜底。中枢若提供生图网关，`upstream` 换成网关地址即可复用同一条代理链路。
