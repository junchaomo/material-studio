# API 边界

所有浏览器业务请求经前端 `/api` 转发到独立后台。账号会话和已授权的存储上传、实时通知仍使用原有 Supabase SDK；业务 RPC 已移至后台。

| 路径 | 职责 | 权限 |
| --- | --- | --- |
| GET /api/health | 服务健康状态 | 公开 |
| GET /api/config | 浏览器公开登录配置 | 公开，不返回模型密钥 |
| GET /api/community/featured | 已发布案例预览 | 公开 |
| POST /api/community | 社区、收藏与积分操作 | 登录，固定操作白名单 |
| GET /api/jobs/:id | 历史任务状态 | 登录，数据库归属校验 |
| /api/platform | 项目、素材、任务与版本 | 原有登录与额度校验 |
| /api/studio | 现有工作台业务 | 原有登录校验 |
| /api/materials/:action | 材质业务 | 原有登录校验 |
| /api/v1/* | 任务、资产、worker 等现有接口 | 各接口原有身份校验 |
| POST /api/material_processing | 内部图像计算代理 | 工作服务凭证 |
| POST /api/stripe-webhook | 保留支付回调兼容 | 原有签名校验 |

其他现有 `/api` 接口保留在 backend/routes 和 backend/api。API 默认请求体上限为 6.5 MB，跨域采用 FRONTEND_ORIGINS 白名单。API 不允许浏览器指定任意数据库 RPC 名称。任务后续处理通过请求作用域隔离，响应完成后执行。
