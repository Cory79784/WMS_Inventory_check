# 海外仓 PDA 库存核查系统 — Cloudflare 部署与配置指南

本指南详细记录如何配置 Cloudflare 资源，将系统安全部署到云端并在真实安卓 PDA 上访问。
遵循 **维持免费额度、不擅自产生费用、保证数据安全** 的核心原则。

---

## 1. 涉及的 Cloudflare 资源与免费额度对照

| 服务组件 | 作用 | Cloudflare 免费方案额度 (Free Tier) | 计费风险防范 |
|---|---|---|---|
| **Cloudflare Workers** | 运行全栈后端 API 与静态前端资源托管 | **100,000 请求 / 天**，单请求 CPU 时间 10ms | 请求量远超单仓单日盘点需求；超出后拒绝额外请求，不会静默扣费 |
| **Cloudflare D1** | 核心 SQLite 关系型数据库 | **5 GB 总容量**，每天 **500 万次读取**，**10 万次写入** | 免费额度足够容纳三个厅全量快照与核查记录 |
| **Cloudflare R2** | 现场照片与原始文件私有存储 | **10 GB 存储 / 月**，每月 **100 万次 Class A 写入**，**1,000 万次 Class B 读取** | ⚠️ **注意：** R2 若超过 10GB 会按 \$0.015/GB/月 产生少量费用。系统已内置压缩建议与存储监控，禁止未经审批超存 |

---

## 2. 准备步骤 (管理员操作)

### Step 1: 创建 GitHub 私有仓库 (GitHub Private Repository)
为防止库存数据与配置泄露，**必须创建 Private 仓库**：
```bash
git remote add origin https://github.com/<your-username>/warehouse-pda-audit.git
git branch -M main
git push -u origin main
```
> 项目根目录已配置严格的 `.gitignore`，已自动排除 `*.xlsx`、`*.jpg`、`dist/`、密钥与本地 SQLite 文件。

### Step 2: 登录 Cloudflare 控制台
1. 注册或登录 [dash.cloudflare.com](https://dash.cloudflare.com)。
2. 本地安装并授权 Wrangler：
   ```bash
   npx wrangler login
   ```
   浏览器将弹出授权确认窗口，允许 Wrangler 访问你的 Cloudflare 账户。

### Step 3: 创建云端 D1 数据库
在项目根目录终端执行：
```bash
npx wrangler d1 create warehouse-audit-db
```
执行后终端会输出类似以下信息：
```text
[[d1_databases]]
binding = "DB"
database_name = "warehouse-audit-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```
将输出的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id` 中。

应用数据库表结构到云端：
```bash
npm run db:migrate:remote
```

### Step 4: 创建云端 R2 照片存储桶 (Photo Bucket)
在终端执行：
```bash
npx wrangler r2 bucket create warehouse-audit-photos
```
确认存储桶名称为 `warehouse-audit-photos`，与 `wrangler.jsonc` 对应。

### Step 5: 公开访问（无需登录配置）
系统已取消登录，无需配置 Cloudflare Access 或 AUTH_CREDENTIALS。任何拿到网址的人均可查看和修改数据。新增操作记录标为 `public`，历史记录保留。

### Step 6: 部署上线
一键构建前端并发布 Worker：
```bash
npm run build
npm run worker:deploy
```
终端将输出公网 HTTPS 访问网址，例如：
`https://warehouse-pda-audit.<your-subdomain>.workers.dev`

---

## 3. 安卓 PDA 现场测试步骤

1. 在安卓 PDA 上打开 Chrome 或内置浏览器。
2. 访问部署好的 HTTPS 网址（或局域网开发 IP `http://<电脑IP>:5173`）。
3. 直接进入操作页面，无需登录。
4. 进入系统首页，默认显示 **Phase 0: PDA 设备与技术可行性验证**：
   - **Tab 1: PDA 扫码测试**：按下 PDA 实体侧键扫描货架库位条码。检查是否捕获条码、平均击键间隔是否小于 35ms、是否自动带回车或 Tab。
   - **Tab 2: PDA 相机测试**：点击拍照按钮，检查是否直接唤起后置摄像头；拍摄后检查图片预览与尺寸，点击“测试上传至 Cloudflare R2”，确认云端成功返回 Key。
   - **Tab 3: D1 读写与多机测试**：在 PDA 上写入一条带有库位信息的测试记录，在电脑端同时打开并刷新，验证多机数据实时同步一致性。
   - **Tab 4: 离线与安全**：切断 PDA Wi-Fi，输入测试数据，确认数据安全保存在待同步队列中，重连网络后点击同步，确保零丢失。
