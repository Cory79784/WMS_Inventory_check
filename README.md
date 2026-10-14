# Warehouse PDA Inventory Audit Tool (海外仓 PDA 库存核查系统)

基于 React + TypeScript + Vite + Cloudflare Workers (D1, R2) 构建的海外仓现场 PDA 库存核查工具。

## 🌟 核心业务特性

1. **三厅数据隔离**：支持海外仓 3 个库厅（H1、H2、H3）独立核查与历史数据版本管理。
2. **WMS 稀疏库存适配**：仅包含有账面库存记录，系统支持直接核对确认“正常空库位”，不破坏物理盘点完整性。
3. **不可覆盖历史快照**：支持重复导入新版 WMS 账面 Excel，每次导入生成独立快照（V1、V2...），保留完整追溯历史。
4. **核查原子版本锁定**：未核查库位自动对齐最新 WMS 快照；一旦发生首次有效操作（确认SKU、录入实盘、标记异常、拍照），原子绑定版本基准，杜绝盘点中途被系统冲销差异。
5. **倒排条码索引检索**：支持复合多值 eBarcode 自动拆分索引，PDA 扫描任意子条码毫秒级准确定位；命中多 SKU 时半屏弹窗选择卡，杜绝静默误录。
6. **现场拍照与 R2 私有存储**：支持现场后置镜头拍照并安全上传至 Cloudflare R2 私有桶，与 D1 异常记录精准绑定。
7. **单 Sheet 横向多图 Excel 导出**：导出格式严格固定为单一工作表（`库存核查记录`），同一记录多张照片在同一行横向自适应排列，使用 ExcelJS 真正嵌入图片二进制，断网离线可见。

---

## 🛠️ 技术栈架构

- **前端**：React 18 + TypeScript + Vite + Tailwind CSS (针对安卓 PDA 屏幕与按键交互深度优化)
- **后端**：Cloudflare Workers (单 Worker 承载静态页面分发与 `/api/*` 接口)
- **数据库**：Cloudflare D1 (SQLite 关系型数据库)
- **对象存储**：Cloudflare R2 (私有现场照片存储)
- **访问方式**：公开访问，无登录；新增操作记录统一标为 `public`
- **测试框架**：Vitest (全套自动化单元与集成测试)

---

## 🚀 本地开发与测试

### 1. 安装依赖
```bash
npm install
```

### 2. 运行本地测试套件
```bash
npm test
```

### 3. 应用本地 D1 数据库迁移
```bash
npm run db:migrate:local
```

### 4. 启动本地开发服务
```bash
# 启动 Vite 前端 (支持同一局域网 PDA 访问)
npm run dev

# 启动 Wrangler 本地 Worker API (运行在 8787 端口)
npm run worker:dev
```

---

## 📦 云端部署

详细的 Cloudflare 免费额度说明与部署流程参见 [`docs/DEPLOYMENT_GUIDE.md`](./docs/DEPLOYMENT_GUIDE.md)。

一键构建并部署至 Cloudflare Workers：
```bash
npm run build
npm run worker:deploy
```

## 仅导出差异的定义

导出已完成核查的明细（含历史版本）：数量不符或异常 SKU，以及有人工备注、退货码或照片的明细。库位备注或库位照片适用于该库位所有明细。纯正常明细、历史自动生成的“盘点正常相符”提示、仅待复核状态或仅退货勾选不纳入。“全部导出”仍包含所有已完成明细。
