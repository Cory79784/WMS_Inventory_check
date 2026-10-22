# SKU counting tasks / SKU 盘点任务

## Workflow / 使用

1. Open **SKU盘点** in the top navigation. PC managers authorize this feature using the existing `CHANGE_AUDIT_MANAGEMENT_KEY` secret. The signed management cookie has a separate SKU API path, so an already authorized inventory-change PC may need to enter the same key once in this page. No new secret or user-role system is required.
2. PC selects an `.xlsx` file. Parsing and preview stay in the browser; no WMS upload/publication API is called. Required columns: SKU编码 / SKU, 库区 / 库厅 / Hall, 库位 / 库位编码 / Location, 库位库存 / 库存数量 / System quantity. Barcode, eBarcode, 客户编码, 中文名称/英文名称, 可用库存, 已分配待出库存, 冻结库存 are retained where provided. Identifiers use formatted cell text (preserving stored leading zeroes); numeric quantity cells use underlying numbers, not thousands-separated display text. Quantities must be nonnegative safe integers; malformed rows are rejected rather than silently dropped.
3. Choose H1/H2/H3 in the existing global selector, choose one or multiple SKUs available in that hall, and name/create a draft. The same file may create, for example, one task per SKU or one task per hall. Creating two tasks is explicit, never an automatic split. The preview shows hall row counts and selected SKU/location totals. The original file binary is not sent to D1/R2.
4. Publish the draft. Phone/PDA shows only published tasks; spreadsheet import and task-management controls remain PC-only. Each task can be claimed by one device at a time after entering an operator name. The operator name is attribution, **not authenticated personal identity**; the public site remains without full-site login.
5. A claim uses an unguessable HttpOnly/Secure/SameSite device cookie and a hash stored in D1. Concurrent claim attempts are atomic. A second device can read the task but cannot save counts or upload photos. A claimant or manager may release a claim; a manager can hand work to another person/device without clearing saved progress. Clearing browser cookies loses the device capability and requires manager release/reclaim.
6. A task visits each imported target location once, showing all selected SKU lines at that location. Duplicate rows are summed by hall + location + SKU; conflicting customers for the same grouped SKU are rejected. Locations sort numerically (rack/bay/level where encoded); all supplied levels and special codes are retained. There is no snapshot comparison, risk engine, first-floor exclusion, or dynamic route recalculation.
7. Use the original location UI: normal, shortage buttons/dialog, surplus/extra goods, notes and optional photographs. Quantity differences for the expected SKU do **not** require photos. Recording a different SKU, an unrecognized barcode, or unknown goods requires a photograph associated with that exact extra line before a completed result can be saved. A known barcode/eBarcode may identify the expected SKU. Stock outside selected SKUs is not automatically wrong; only explicitly recorded extras enter the task result.
8. Task book quantities are clearly labeled as **任务账面数量** from the frozen imported file, not live/current WMS stock. A later WMS publication does not change this task's reference. Source file name, full task ID, SKU/location scope and claimant remain visible below the PDA operation area. A zero quantity confirmation applies only to selected SKUs, never declares the whole physical location empty.

中文流程：PC 授权 → 选表预览 → 选厅/选 SKU/命名 → 建草稿 → 发布 → PDA 填姓名认领 → 按库位盘点。可按 SKU 或库厅创建多个任务；一任务一设备认领。任务转交保留服务器进度，旧设备的未同步内容不会自动写入新认领版本。上传样表只用于格式理解和本地解析验证，未导入生产数据库，也未提交仓库。

## Isolation / 数据隔离

- Dedicated API prefix `/api/inventory/sku-count/`; dedicated `sku_count_tasks`, `sku_count_results`, `sku_count_photos`; R2 prefix `sku-count/{hall}/{task}/{photo}`.
- `0009_sku_count_tasks.sql` is additive and included in existing idempotent initialization. Existing WMS snapshots, location-inspection and inventory-change results/photos are never updated. This feature does not query/copy original inspections into its counts.
- Each task freezes a plan, file SHA-256 (provenance, not an authenticity signature), source name and selected scope. Unique task IDs distinguish even same-name, same-file tasks. The Excel binary is not retained; preserve it separately when required.
- Draft/published/withdrawn/deleted lifecycle; deletion is soft. PC may include deleted tasks for read-only history. No new task export is added in this iteration, and existing export menus remain scoped to their original records.
- Publication/claim revisions change on claim, release, publication, withdrawal and deletion. Every save/photo insert checks hall, task, publication revision and claim hash in its final SQL statement. Location results separately use optimistic revisions and exact-payload retry acknowledgements. Claim takeover cannot reuse an old device's pending writes. Save validation checks all baseline lines, identities, photo ownership/association and completion, not merely frontend flags.

## Reuse and recovery / 复用与恢复

The existing task editor, SKU card, quantity buttons, modals and serialized autosave/session implementation are reused via an explicit injected transport. The original editor and API defaults retain their previous behavior. No shared component guesses a destination from the current tab.

SKU draft keys are `wms-sku-count-drafts:{taskId}` and pending photo blobs use a `sku-count:{taskId}` IndexedDB namespace; task/location preferences include hall and task ID. They cannot overwrite the inventory-change task's browser keys even when IDs coincide. Server progress is authoritative across devices; current position remains a device preference. Refresh or browser reopen restores hall, the SKU tab, selected task and current location after server validation.

Count edits persist locally and debounce to the independent API; navigation/visibility/pagehide attempt a flush. Failed saves remain drafts with retry; draft records from an old claim/publication revision are quarantined. The user can explicitly preserve an isolated local copy before opening a new valid revision. Pending photographs retain original bytes for retry. Browser shutdown cannot guarantee asynchronous requests or IndexedDB completion: normal autosave/local persistence does the work; storage failures and unsynchronized exits display warnings. Site-data clearing/private browsing/forced OS termination can still lose unsynced data.

The existing PDA scanner keyboard rules remain: `inputMode=none` by default, explicit manual toggle, blur/change inputMode/refocus on the click, no unsolicited keyboard on target switch or refresh. Spreadsheet transfer controls are hidden on handheld devices; image capture remains available. Backend authority is capability-based, never inferred from device UA or width.

## Limits, performance and verification / 限制、性能、验证

- One workbook data sheet; at most 10 MB file, 10,000 source rows, 1,000 selected SKUs and 1.8 MB frozen task plan. Large files or ambiguous headers/customers are rejected. Physical count/result payloads are bounded. Source selection and task creation stay explicit; no background source upload.
- Foreground list/status checks run at most every 30 seconds, also on window focus. Status queries use metadata and result/photo counters, not full stock or route computation; changed counters fetch only that task's results/photos. Route jumps make no inventory query. No polling while hidden.
- Same-SKU shortage/surplus no-photo tests, different/unknown SKU evidence tests, two-device claim race, unauthorized/cross-hall writes, release/transfer, stale revisions, exact retry, R2 bytes/ownership, separate tasks and untouched original tables use local Miniflare D1/R2.
- React tests cover preview-before-create, hall filtering, original controls, PDA layout and keyboard, no-photo same-SKU additions, mandatory-photo different SKU, claim gating, persisted task/location, and top-nav/hall restoration. Session tests cover independent namespaces and interrupted/old-claim draft protection. The supplied sample was parsed locally through the actual importer; no real SKU/customer values are hardcoded in tests or source.
- No production migration, merge or deployment performed. Real PDA image capture/keyboard/browser termination, Cloudflare secrets and multi-device network behavior require acceptance testing.

Validation record: 30 test files / 228 tests passed, plus successful Vite production build, Worker TypeScript and whitespace checks. Actual sample importer check: 87 rows, two SKUs, H1/H2/H3, SHA-256 retained; local read-only validation only.

## Inventory area groups / 库区分组

- SKU counting has its own area selector: H1, H2, H3, Small goods (second floor), then other imported areas. Selecting H1/H2/H3 also selects the corresponding application hall. Non-hall groups never change the original inspection or inventory-change scope.
- Only `Halle1/2F`, `Halle2/2F`, and `Halle3/2F` (case-insensitive) form `SMALL_GOODS`. Other areas use a distinct `AREA:<UPPERCASE_SOURCE_AREA>` task partition. No inference is made from location prefixes or similar-looking area names such as Halle1, H2office, or Halle2-Shelves.
- RT stock is accepted on import, explicitly listed as excluded, and never becomes a task target or contributes to completion. The task freezes RT rows for its selected SKUs as reference-only metadata, so they remain visible after reload. This is source stock, not an outstanding counting result.
- Small-goods and other-area location keys include the original area. Identical physical location codes in different areas stay separate. Scanning a bare code jumps only when unique; otherwise select its full entry from the route.
- Scope, selected task, location, and drafts retain independent storage keys. PDA discovers published area groups from the server; draft-only groups are visible only to managers. File import stays PC-only.
- Existing H1/H2/H3 task keys and routes are unchanged. No schema migration is required: SKU task `hall_id` is already TEXT without a hall-only constraint, and optional plan metadata is additive. Original inspection, snapshots and inventory-change tables are untouched.

SKU 盘点库区排序为 H1/H2/H3 → 二楼小货区 → 其他原始库区。二楼三个库区统一分组、原库区仍保留；RT 接受导入并明确列为未纳入盘点，选中 SKU 的 RT 来源记录随任务留档。相同库位码按库区隔离，不串数量和进度。手机/PDA 可选择已发布库区任务，不显示文件导入入口。无需数据库迁移。
