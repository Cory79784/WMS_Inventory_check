# P0 服务端账号初始化（尚未执行生产配置）

三个用户名及显示姓名固定为 `Cory`、`sheng`、`account`，业务权限完全相同。初始密码由仓库所有者提供；本文、源码、测试和前端构建均不保存这些密码。测试使用每次运行随机生成的独立密码。

## 验收后由维护者执行

本次 PR 不部署、不修改生产 Secret、不操作远程 D1。以下命令属于后续经授权的配置操作。

在可信的 Linux/macOS/WSL 终端、正确的 Cloudflare 账号和项目目录中：

```sh
node scripts/init-auth.mjs | npx wrangler secret put AUTH_CREDENTIALS
```

脚本通过 `/dev/tty` 依次隐藏输入三个账号的密码。请分别输入用户已提供的对应密码；不要将密码放入命令行、环境变量、GitHub、wrangler.jsonc 或前端配置。脚本生成独立随机盐和 PBKDF2-SHA256 哈希，直接通过管道交给 Workers Secret。不要单独运行脚本将哈希输出到可记录的终端，不要开启 shell tracing。

`AUTH_CREDENTIALS` 是后端 JSON：用户名映射到 `{salt, iterations, hash}`。当前迭代次数 100000，与 Workers PBKDF2 实现限制兼容。用户名不区分角色，也没有客户端身份覆盖接口。修改密码可重新运行初始化并在需要时清除 `auth_sessions` 使已有会话失效。

增量迁移为 `migrations/0004_sessions.sql`；现有启动初始化也会以 `CREATE TABLE IF NOT EXISTS` 创建同样的两个表。无历史表删除或改写。未配置 Secret 时登录返回 503，业务接口仍拒绝未登录请求。

## 会话与边界

- 256 位随机 Token；D1 只保存 Token 的 SHA-256，不保存原始 Token。
- Cookie：`__Host-wms-session`，`Path=/; HttpOnly; Secure; SameSite=Strict`，7 天固定有效期。
- 服务端检查有效期；退出删除当前会话；重新登录轮换当前浏览器会话。
- 登录按账号（10 次/15 分钟）和来源 IP（60 次/15 分钟）在 D1 中原子计数，成功尝试也计入预算。
- 登录、退出及业务写请求检查精确同源 Origin，拒绝 cross-site；生产须使用 HTTPS 同源页面和 API。
- 所有 `/api/` 业务接口统一要求会话，含诊断、数据库初始化、照片和导出。旧 Access/测试身份头不再授予身份或权限。
- 照片读取为 `private, no-store`，避免退出后通过浏览器缓存继续读取；原图字节不变。
- 前端在 401、重新聚焦和每分钟检查时更新登录状态；会话过期隐藏业务页面，同时保留内存草稿以供重新登录后继续保存。主动退出在未保存/忙碌时提示先保存，成功退出后刷新清空页面状态。
- 每次核查使用会话姓名写入现有 `operator_id`，并向 `audit_events` 追加姓名、状态、库位及服务端时间。旧审计记录不变。

## 本地验证

自动化测试自动注入随机测试凭据，不需要生产密码或 Cloudflare 凭据。`vite.config.ts` 保留原始 Host，确保同源校验可通过本地代理。直接用 curl 写 API 时也必须提供正确的 Origin 和有效 Cookie。

生产真实密码登录、HTTPS Cookie、PDA 重开浏览器及七天到期行为需在用户批准后的验收环境检查。本 PR 未将上述三个正式账号初始化到线上。
