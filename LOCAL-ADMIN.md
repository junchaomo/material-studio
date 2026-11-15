# 筑材本地管理中心

双击本目录的「启动本地管理后台.cmd」，或运行 npm run admin，然后在这台电脑打开 http://127.0.0.1:4180/。双击「停止本地管理后台.cmd」停止通过启动器运行的后台。管理员为 milemo2023@gmail.com，使用网站现有密码。没有创建新密码，不要将密码发给他人。

管理功能：查看注册用户、邮箱验证状态、会员身份和月度用量；查看申请；开通/撤销会员、调整有效期与月度额度、审核申请；查看最近 100 条操作记录。修改必须填写说明。用量不会被修改会员的操作清零。只管理云端账号和权益，不能读取用户浏览器里的项目图片。

后台只监听 IPv4 回环地址 127.0.0.1:4180，Host、Origin、CSRF 和请求体均校验，不开放 CORS。与公网网站的登录会话独立，30 分钟无活动或 8 小时后过期。登录连续失败 5 次暂停 15 分钟；重启服务会清除管理会话。

管理员身份保存在 private.site_admins，普通用户不能写入。每次操作还需本机设备签名；设备凭据经 Windows DPAPI CurrentUser 加密，位于 .local/admin-device.json，并设置为当前 Windows 用户可访问。云端保存签名校验密钥于 private.admin_devices，禁止客户端读取。签名绑定操作内容、时间和一次性随机数，过期或重放会拒绝。只有邮箱已验证的指定管理员且本机签名有效时才允许调用。其他电脑即使知道账号密码也没有本机凭据。

管理页面/本机服务放在 local-admin/，未放入 public/ 或 api/，.vercelignore 排除本机目录。不要将 .local 上传到 GitHub、Vercel，或把后台监听地址改成 0.0.0.0。无需 service_role、数据库密码或额外付费套餐。

数据库依次执行 supabase/local-admin.sql、supabase/local-admin-hardening.sql；本机凭据只在首次安装生成并登记，源码不包含密钥。换电脑需重新授权新设备；丢失设备时由项目拥有者在 Supabase 禁用对应 private.admin_devices.enabled。停止后台可在任务管理器结束对应 node 进程（命令行为 local-admin/server.mjs）。

权限处理依据：[Supabase 函数安全](https://supabase.com/docs/guides/database/functions)、[API 安全](https://supabase.com/docs/guides/api/securing-your-api)。

启动器会读取 Windows 当前已启用的回环代理（127.0.0.1），仅为后台进程设置代理，并将 localhost 排除代理；不会修改系统设置。当前电脑使用 127.0.0.1:7890，需保持原代理程序运行。账号验证仍直接连接 Supabase，不经过公网网站的转接接口。Node 使用官方 --use-env-proxy 参数，需支持此参数的 Node 24 版本。
