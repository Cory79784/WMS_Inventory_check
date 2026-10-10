import React from 'react';
import {
  ShieldAlert,
  FileSpreadsheet,
  Layers,
  Camera,
  Server,
  Smartphone,
  CheckCircle,
  HelpCircle,
  Lock,
} from 'lucide-react';

export const ArchitecturePage: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-3 py-4 space-y-4">
      {/* Overview Card */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-2">
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <Server className="w-5 h-5 text-brand-600" />
          系统架构理解与核心设计 (Master Prompt V6)
        </h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          基于项目首次完整技术规范整理。遵循 <strong>Phase 0 验证优先、不盲目编写业务代码、业务规则坚决遵守</strong> 的原则。
        </p>
      </div>

      {/* Grid of Key Technical & Business Understandings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {/* 1 & 2: Frontend & Cloudflare Workers */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Smartphone className="w-4 h-4 text-brand-600" />
            <span>1 & 2. 前端与 Cloudflare Workers 部署</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            单 Cloudflare Worker 项目承载前端静态资源 (Static Assets) 与 <code>/api/*</code> 业务路由。避免跨域，无需个人电脑持续开机运行后端。前端 React+TS 专门针对 PDA 小屏高对比度与快速触控优化。
          </p>
        </div>

        {/* 3 & 4: D1 & R2 */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Camera className="w-4 h-4 text-brand-600" />
            <span>3 & 4. D1 数据库与 R2 私有照片</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            Cloudflare D1 存储用户、厅、物理库位、WMS 快照、核查明细与审计日志；照片二进制存入私有 R2 Bucket，D1 记录对应元数据。禁止将照片公网无鉴权暴露。
          </p>
        </div>

        {/* 5: Access Auth */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Lock className="w-4 h-4 text-emerald-600" />
            <span>5. Cloudflare Access 身份与工号绑定</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            服务端直接通过 Access JWT 鉴权，确定真实操作者身份；员工工号作为业务属性绑定在用户表，杜绝无鉴权冒充。区分 ADMIN、OPERATOR、REVIEWER 三种角色。
          </p>
        </div>

        {/* 6: Sparse Inventory */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Layers className="w-4 h-4 text-amber-600" />
            <span>6. WMS 稀疏库存 (Sparse Inventory)</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            <strong>核心业务事实：</strong>WMS 导出的 Excel 仅包含有库存条目。真实物理空库位在 Excel 中完全不存在（而不是数量=0）。现场扫到有效空库位必须允许标记“空库位已确认”。
          </p>
        </div>

        {/* 7 & 8: Version Management & Version Locking */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <CheckCircle className="w-4 h-4 text-blue-600" />
            <span>7 & 8. WMS 多版本与原子版本锁定</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            导入新 Excel 不覆盖旧版本。<strong>版本锁定规则：</strong>首次有效核查（确认SKU/改数/空库位）时原子绑定当前版本的 <code>reference_import_id</code>。后续发布新 WMS 不影响已在途和已完成的核查基准！
          </p>
        </div>

        {/* 9 & 10: Location Registry & Navigation */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Layers className="w-4 h-4 text-purple-600" />
            <span>9 & 10. 物理库位注册表与连续导航</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            独立于 WMS 的 Physical Location Registry。左右箭头 <code>← 上一库位 120-075-1 下一库位 →</code> 基于物理顺序跳转，绝不跳过账面无库存的真实空库位。
          </p>
        </div>

        {/* 11 & 12: PDA Workflow & Excel Export Plan B */}
        <div className="p-3.5 bg-white rounded-xl border border-slate-200 md:col-span-2 shadow-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            <span>11 & 12. PDA 核查闭环与单 Sheet 横向多照片 Excel 导出 (已确认方案 B)</span>
          </div>
          <p className="text-slate-600 leading-relaxed">
            <strong>导出规则最终固定为：</strong>单 XLSX 文件，仅 1 个 Worksheet（<code>库存核查记录</code>）。一个 SKU 占一行，同一记录的多张现场照片在同一行横向排列 (<code>现场照片1, 现场照片2...</code>)，使用 ExcelJS 直接嵌入真实图片二进制。离线打开也能查看图片。严禁擅自拆分为多 Sheet 或照片纵向增加行。
          </p>
        </div>

        {/* 13 & 14: Cloudflare Free Tier Risks & Unconfirmed Items */}
        <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 md:col-span-2 space-y-2">
          <div className="flex items-center gap-1.5 font-bold text-amber-900">
            <ShieldAlert className="w-4 h-4 text-amber-700" />
            <span>13 & 14. 免费额度保护与待现场确认的关键事项</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700 text-[11px]">
            <div>
              <span className="font-semibold text-amber-900 block">云端免费额度控制:</span>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Workers Free: 100,000 请求/天，10ms CPU</li>
                <li>D1 Free: 5GB 存储，每天 500 万读，10 万写</li>
                <li>R2: 10GB 免费存储。需容量监控，避免超额账单</li>
                <li>Access: 50 用户免费席位</li>
              </ul>
            </div>
            <div>
              <span className="font-semibold text-amber-900 block flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5" />
                保留待确认事项 (不主观臆造):
              </span>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>PDA 具体型号与 Keyboard Wedge 回车/Tab行为</li>
                <li>三个厅的完整物理库位编码规律与廊道范围</li>
                <li>真实 WMS Excel 样本文件读取与 18 列匹配</li>
                <li>廊道终点边界处理与历史复盘显示规则</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
