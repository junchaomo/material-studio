# 本地验证（2026-10-22）

- npm run typecheck：前、后台通过。
- npm run build：独立后台与 React 前端构建通过；前端路由不再包含业务 API。
- npm test：152 项通过，包含请求认证、CORS、回调原始字节、内部 CPU 代理、延迟任务隔离及服务依赖边界。
- Python 图像处理测试：12 项通过。
- API 4191 与前端 4173 的 /api/health 均返回 200、architecture=separated；/demo 返回 200；未登录 /api/platform 返回 401。
- 浏览器验证：示例图片加载、画布、Mask 编辑器可打开。
- 使用临时测试凭证启动隔离 Python 实例，由独立 Node API 请求真实 CPU probe，返回 200、opencv=true、pillow=true、inference=false。未执行收费模型调用。

限制：现有云端数据库此前超额，未宣称正式账号、数据库写入和实际 AI 生成已恢复；后台环境当前没有可用 CPU 工作凭证，正式任务需配置 QMX_CLOUD_WORKER_TOKEN。源码分离未发布至线上。

## Demo 对齐更新

Demo 改为复用正式 SelectedMaterialStudio，通过本地适配器管理项目、候选、任务、资源和版本。155 项自动测试通过。使用实际 HTTP / Python CPU 跑通 SLIC-Lab-LBP-Gabor → 候选采用 → 四角估计 → 矫正 → 人工信息确认 → 1024×1024 保真增强 → 人工审核入库 → ZIP 导出。真实生成贴图尺寸为 1024×1024，未调用 AI。

页面 /demo 返回 200，经前端转发的 /api/demo/process probe 返回 200。浏览器工具被 URL 访问策略拦截，本次未完成新版页面的可视交互验证，不使用旧截图作为新版证据。SAM / AI 识别 / AI 重绘未接通，不能宣称 AI 功能与账户版一致。

## Demo 取消

用户已取消 Demo。已移除 /demo 页面、首页与登录页入口、本地专用处理接口与适配器；正式工作台和前后端分离结构保留。上方 Demo 验证记录仅为历史结果。浏览器演示数据库未清理。

## 单机模式

APP_MODE=local 时，业务请求由 SQLite 与本机文件适配器处理，不通过 Supabase；正式材质组件复用，工作台入口免登录。新增测试覆盖 SQLite 重启持久化、真实文件和 ZIP、模型密钥加密、已缓存 AI 结果恢复不重复请求、跨项目与凭证检查。真实模型供应商调用未在开发验证中执行。

最终验证：154 项 Node 测试、12 项 Python 测试、前后端类型检查与构建通过。真实 HTTP + Python CPU + SQLite 链路得到 SLIC-Lab-LBP-Gabor 候选、frontal 正视图、1024×1024 输出及 51738 字节 ZIP，AI 调用为零。测试项目已移入本机可恢复回收站，文件仍保留。最终 /api/config 为 local 模式且不含云端 URL，/app/extract 返回 200。新版页面的浏览器可视交互未在本次验证中确认；此前浏览器工具访问受限。
