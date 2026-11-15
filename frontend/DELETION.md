# 统一删除模块

所有用户主动发起的资源删除、移入回收站和移除记录，必须调用 `useDeletion()`；不要直接使用 `window.confirm()` 后发送删除请求。共享状态机位于 `shared/deletion-flow.mjs`，React 展示层位于 `components/deletion-center.tsx`。

调用时提供 `subject`（对象名称）、`description`（范围与恢复说明）、`mode`（recycle/remove/permanent）及 `onDelete`（确认后执行的异步业务函数）。`onDelete` 失败必须抛出错误，不要在内部吞掉失败，否则弹窗会误认为成功。禁止在打开弹窗之前删除数据。永久删除要求输入完整对象名称，不能以回收站文案包装不可恢复操作。

通用流程负责取消、确认、防重复提交、执行中锁定、失败留在弹窗重试及焦点恢复。业务服务仍需独立验证权限、版本与运行任务。

归档浏览器版也使用同一个状态机。`scripts/sync-browser-modules.mjs` 在开发启动和构建前自动同步公共浏览器文件，不要单独维护一套删除逻辑。

这次没有实际删除任何用户项目或材质，也未新增永久删除入口。
