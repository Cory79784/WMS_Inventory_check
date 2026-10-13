# P0 Minimal Changes 验收报告

基线：最新 `main` 在读取时为 `b72cfb3a48e12f9abc508c670e3797313596bce1`。
分支：`codex/p0-minimal-20261013`。没有修改 `main`、`CORY` 或 `i18n`；没有合并或 Cloudflare 部署。

## 保存语义核查

原始代码已有 800 ms 防抖自动保存：正常确认、少货、多货、库位备注、已上传照片关联和退货元数据变更均进入 `handleSaveInspection`，调用 `POST /api/inventory/inspection/save`。Worker 构造核查、SKU、照片关联和审计语句，以 `await env.DB.batch(stmts)` 成功后返回 `success/inspectionId/savedAt`。未完成时为 `IN_PROGRESS` 且 `completed_at=NULL`。

浏览器 `locationDrafts` 是页面会话内 Map，不是 D1，也不是 localStorage/IndexedDB 持久化。R2 上传成功只代表原图存在，必须随后保存关联。切换库位前已有保存屏障，失败时停留原库位。本次保留该行为和防抖。

修复点：HTTP 200 但缺少明确保存确认也视为失败；同步 ref 防止同一页面重复发起并行保存；较旧响应不得显示较新草稿已保存或覆盖它；保存后仍有新改动时不切换库位。界面区分正在保存、未保存修改、失败，以及成功后的已暂存/已保存。

D1 证据来自真正的 Miniflare/workerd 本地 D1 绑定，不是 Mock：

- `tests/authIntegration.test.ts`：少货 10→8、多货 0→3 均实际 SQL 读回；状态 `IN_PROGRESS`、`completed_at=NULL`；重新查询读回两条 SKU。
- 三账号按顺序保存同一库位，`operator_id` 为当前会话姓名；`audit_events` 保留三人的独立事件，时间等于 Worker `savedAt`，客户端伪造姓名/时间被忽略。
- `tests/inspectionApi.test.ts`：触发器故意令 SKU 写入失败，HTTP 500、`success=false`，数据库中无该次核查，证明批处理回滚；原有重复保存、旧 WMS 版本拒绝、照片原始字节、退货保存/回读测试保留。
- `tests/inspectionPage.test.tsx`：延迟第一次响应并产生第二次修改，第一次未返回前只发出一次请求；旧响应返回后不显示新草稿已保存，第二次保存包含新备注。另测网络失败、切换库位和正常/少货/多货自动保存。
- `tests/saveAcknowledgement.test.ts`：拒绝 HTTP 200 的不明确响应，仅接受完整确认。

边界：这是本地真实 D1，不是生产 D1。单页面写入串行化不代表跨多台 PDA 的冲突合并；多个账号的已完成保存采用现有覆盖当前核查、追加审计的方式。

## 导出与界面

仅差异筛选新增库位备注、解码后的 SKU 备注、退货元数据、有效非空已保存照片关联和 `PENDING_REVIEW` 状态。库位级证据保留相关正常行。仍仅导出已有规则认可的已完成记录；不把未完成草稿加入 Excel。

`inspectionApi.test.ts` 在真实 D1 中验证正常无证据排除、正常库位备注、正常照片、SKU备注、退货状态保留，四个语言请求结果一致。`inspectionExport.test.ts` 保留单 Sheet、原列顺序、横向图片、原图字节和 WMS 绑定验证。没有修改 Excel 构建代码。

可用库存为蓝色加粗 14px；Barcode 从 10px 增为 14px，SKU 仍为 16px。Barcode 为 LTR、可换行，库存字段顺序与数值不变。阿拉伯语 DOM 测试验证原始长条码、LTR、字号类、字段顺序；不等同于真实浏览器像素排版检查。

## 单厅导入对比

保持每批 60 行，原分批写入、暂存校验与发布事务不变。只让发布成功响应顺带返回版本列表，正常路径省掉随后一次刷新请求。读取列表失败不会把已提交的发布报告为失败，前端回退原查询。

测试以 XLSX 生成/读取真实 18 列、单 Sheet、H1 的 **2,524 行合成文件**；不是用户业务原文件。在相同的认证实现下比较旧的独立刷新流程与新的合并刷新流程，隔离此优化本身的影响。含初始版本查询，排除共同的登录请求。

| 指标 | 旧刷新流程 | 合并刷新流程 |
|---|---:|---:|
| API 请求 | 48 | 47 |
| 分批上传请求 | 43 | 43 |
| 行数 | 2524 | 2524 |
| 不同 SKU | 700 | 700 |
| 库位数 | 631 | 631 |
| 库存汇总 | 40373 | 40373 |
| 首轮本地耗时 | 936 ms | 905 ms |
| 最终完整测试轮本地耗时 | 1171 ms | 970 ms |

两侧逐行比较库位、SKU、Barcode/eBarcode 和四类库存数量，完全一致；核对版本指针与历史版本列表。`importOptimization.test.ts` 注入真实 D1 批次失败：零部分写入、有效版本指针不变；移除故障后重试成功，已发布版本拒绝继续上传或重新发布。

耗时为本地墙钟时间，含合成 Excel 生成/读取，不代表生产网络延迟或 Workers CPU 配额。该优化没有增大事务或请求体。没有新增整个文件上传、队列或后台任务。原有流程没有自动续传协议，本次也未引入；响应丢失等不明确失败后的生产恢复仍须实机确认。

## 命令与测试

已运行 `npm ci`、`npm run lint`、`npx tsc -p tsconfig.worker.json --noEmit`、`npm run build`、`npm test`。

最终完整测试为 **16 个文件 / 120 项全部通过**（Vitest 2.1.9，总耗时 10.18 秒）。前端与 Worker TypeScript 均退出 0，生产构建成功；`npm ci` 成功。随后仅更新此报告。Vite 同源代理的真实 HTTP 登录和认证业务读取均返回 200。新增 CI 只运行这五条命令，不部署。构建保留原有大 bundle 警告；依赖安装有已有包的 deprecation 提示，没有为本任务升级依赖或重构分包。

## 修改文件与原因

| 文件 | 原因 |
|---|---|
| `worker/auth/access.ts` | 用服务端凭据、D1 会话、限流与同源验证替换默认放行和旧身份头 |
| `worker/index.ts` | 统一业务 API 认证，登录/退出路由，移除通配 CORS |
| `worker/types.ts` | 增加后端 Secret 类型 |
| `worker/db/init.ts`、`migrations/0004_sessions.sql` | 仅增加会话和限流表 |
| `worker/routes/inventory.ts` | 发布响应合并刷新、审计姓名、私有照片禁缓存 |
| `worker/routes/r2-test.ts` | 诊断照片同样禁缓存以配合退出失效 |
| `worker/routes/inspection-export.ts` | 仅差异模式纳入证据 |
| `src/components/SessionGate.tsx`、`src/main.tsx` | 登录页、姓名、退出、过期状态处理 |
| `src/services/api.ts` | 明确保存确认校验与照片上传 401 处理 |
| `src/pages/LocationInspectionPage.tsx` | 保存串行与新草稿保护、状态语义、两项 Tailwind 样式 |
| `src/pages/WMSImportPage.tsx` | 使用合并后的版本列表并保留回退，成功后清除文件哈希避免错误阻止退出 |
| `src/i18n/zh.ts`、`de.ts`、`vi.ts`、`ar.ts` | 增加保存中/未保存修改文案，语言选择机制不变 |
| `vite.config.ts` | 本地代理保留 Host，使精确 Origin 校验一致 |
| `scripts/init-auth.mjs` | 隐藏输入、加盐哈希并通过管道初始化 Secret |
| `tests/authIntegration.test.ts`、`tests/helpers/auth.ts` | 随机测试密码与真实 D1 会话/审计测试 |
| `tests/inspectionApi.test.ts` | 登录后运行原业务测试，追加证据导出和真实数据库失败测试 |
| `tests/inspectionPage.test.tsx`、`tests/saveAcknowledgement.test.ts` | 快速修改、保存确认和阿拉伯语 DOM 验证 |
| `tests/importOptimization.test.ts` | 合成 Excel、请求/耗时对比、逐行一致性及失败重试 |
| `tests/worker.test.ts` | 旧默认放行断言改为拒绝未认证/伪造身份 |
| `tests/localD1EndToEnd.test.ts`、`locationInspection.test.ts`、`wmsVersionManagement.test.ts` | 旧 Mock 业务测试显式使用测试认证 mock；生产代码无测试身份通道 |
| `.github/workflows/p0-validation.yml` | 独立分支及 PR 自动验证，无部署步骤 |
| `docs/P0_AUTH_SETUP.md`、`docs/P0_VALIDATION.md` | 安全初始化和验收证据 |

## 未完成的环境验收 / PDA 清单

- [ ] 用户批准后的环境初始化三账号 Secret，逐一用指定初始密码登录（本次没有生产凭据变更）。
- [ ] 真实 HTTPS 浏览器验证 Cookie、刷新/关闭重开、过期回登录与退出失效。
- [ ] PDA 实机四语言排版，尤其阿拉伯语长 Barcode 换行、按钮不遮挡、库存显示。
- [ ] PDA 扫码输入、左右/上下导航原行为；弱网保存、快速切换和重新登录继续草稿。
- [ ] 真实单厅 WMS 文件导入、断网恢复、版本绑定与数量核对；本次为同结构合成文件。
- [ ] 实际照片 Excel 导出打开验收，检查正常证据库位及照片质量。

尝试启动 Chromium 视觉测试，但环境没有浏览器二进制，下载安装返回损坏/空压缩包，无法完成浏览器截图和像素布局验证。不得把 DOM 测试当作 PDA 实机通过。上述项目未完成前保持 Draft，未经许可不合并、不部署。
