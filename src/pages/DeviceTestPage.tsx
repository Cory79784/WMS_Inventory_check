import React, { useState, useEffect, useRef } from 'react';
import {
  fetchHealth,
  fetchD1Data,
  writeD1TestRecord,
  uploadR2TestFile,
  listR2TestFiles,
  fetchAuthMe,
} from '../services/api';
import { HealthResponse, DiagnosticRecord, ScanEvent } from '../types';
import {
  Barcode,
  Camera,
  Database,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  UploadCloud,
  Layers,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';

export const DeviceTestPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'scanner' | 'camera' | 'cloud' | 'network'>('scanner');

  // Scanner state
  const [scanInputValue, setScanInputValue] = useState('');
  const [scanEvents, setScanEvents] = useState<ScanEvent[]>([]);
  const [continuousScan, setContinuousScan] = useState(true);
  const [lastKeystrokeTime, setLastKeystrokeTime] = useState<number | null>(null);
  const [keystrokeIntervals, setKeystrokeIntervals] = useState<number[]>([]);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Camera & R2 state
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'IDLE' | 'UPLOADING' | 'SAVED' | 'ERROR'>('IDLE');
  const [uploadResultKey, setUploadResultKey] = useState<string | null>(null);
  const [r2FileList, setR2FileList] = useState<{ key: string; size: number; uploaded: string }[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Cloud Diagnostics state
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [diagnosticsList, setDiagnosticsList] = useState<DiagnosticRecord[]>([]);
  const [d1TestKey, setD1TestKey] = useState('pda-loc-check');
  const [d1TestVal, setD1TestVal] = useState('');
  const [d1Loading, setD1Loading] = useState(false);
  const [d1Message, setD1Message] = useState<string | null>(null);
  const [authData, setAuthData] = useState<{ authenticated: boolean; mode: string; user?: unknown; error?: string } | null>(null);

  // Network state
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pingLatency, setPingLatency] = useState<number | null>(null);
  const [offlinePendingQueue, setOfflinePendingQueue] = useState<{ key: string; value: string; time: string }[]>([]);

  // Device Info
  const userAgent = navigator.userAgent;
  const isAndroid = /Android/i.test(userAgent);

  // Autofocus scanner input
  useEffect(() => {
    if (activeTab === 'scanner' && scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, [activeTab]);

  // Network listeners
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Periodic health ping
  const runPing = async () => {
    const start = performance.now();
    try {
      const data = await fetchHealth();
      const end = performance.now();
      setPingLatency(Math.round(end - start));
      setHealthData(data);
    } catch {
      setPingLatency(null);
    }
  };

  useEffect(() => {
    runPing();
    loadDiagnostics();
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetchAuthMe();
      setAuthData(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthData({ authenticated: false, mode: 'error', error: msg });
    }
  };

  const loadDiagnostics = async () => {
    try {
      const res = await fetchD1Data();
      setDiagnosticsList(res.diagnostics);
    } catch (err: unknown) {
      console.error('Error fetching D1 data', err);
    }
  };

  const loadR2Objects = async () => {
    try {
      const list = await listR2TestFiles();
      setR2FileList(list);
    } catch (err: unknown) {
      console.error('Error listing R2 files', err);
    }
  };

  // Keyboard wedge keystroke detector
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = performance.now();
    if (lastKeystrokeTime !== null) {
      const interval = now - lastKeystrokeTime;
      setKeystrokeIntervals((prev) => [...prev.slice(-30), interval]);
    }
    setLastKeystrokeTime(now);

    const isEnter = e.key === 'Enter';
    const isTab = e.key === 'Tab';

    if (isEnter || isTab) {
      e.preventDefault();
      const scannedCode = scanInputValue.trim();
      if (!scannedCode) return;

      const avgInterval =
        keystrokeIntervals.length > 0
          ? Math.round(keystrokeIntervals.reduce((a, b) => a + b, 0) / keystrokeIntervals.length)
          : 0;

      // Scanners typically send chars with < 35ms interval
      const isWedge = avgInterval > 0 && avgInterval < 50;

      // Classify code format
      let likelyType: 'LOCATION' | 'SKU_OR_BARCODE' | 'UNKNOWN' = 'UNKNOWN';
      if (/^\d{3}-\d{3}-\d+$/.test(scannedCode) || /^[A-Za-z0-9]+-\d+$/.test(scannedCode)) {
        likelyType = 'LOCATION';
      } else if (scannedCode.length >= 4) {
        likelyType = 'SKU_OR_BARCODE';
      }

      const newEvent: ScanEvent = {
        id: `scan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        code: scannedCode,
        timestamp: new Date().toLocaleTimeString(),
        inputMethod: isWedge ? 'keyboard-wedge' : 'manual',
        detectedEnter: isEnter,
        detectedTab: isTab,
        charIntervalAvgMs: avgInterval,
        likelyType,
      };

      setScanEvents((prev) => [newEvent, ...prev.slice(0, 49)]);
      setScanInputValue('');
      setKeystrokeIntervals([]);
      setLastKeystrokeTime(null);

      if (continuousScan && scanInputRef.current) {
        scanInputRef.current.focus();
      }
    }
  };

  // Simulate hardware scan for PC testing
  const simulateScan = (code: string) => {
    let likelyType: 'LOCATION' | 'SKU_OR_BARCODE' | 'UNKNOWN' = 'UNKNOWN';
    if (/^\d{3}-\d{3}-\d+$/.test(code) || /^[A-Za-z0-9]+-\d+$/.test(code)) {
      likelyType = 'LOCATION';
    } else {
      likelyType = 'SKU_OR_BARCODE';
    }

    const event: ScanEvent = {
      id: `sim_${Date.now()}`,
      code,
      timestamp: new Date().toLocaleTimeString(),
      inputMethod: 'keyboard-wedge',
      detectedEnter: true,
      detectedTab: false,
      charIntervalAvgMs: 14, // typical hardware scanner speed
      likelyType,
    };
    setScanEvents((prev) => [event, ...prev.slice(0, 49)]);
  };

  // Handle Photo selection
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCameraError(null);
    setUploadStatus('IDLE');
    setUploadResultKey(null);

    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      setSelectedPhoto(file);
      const preview = URL.createObjectURL(file);
      setPhotoPreview(preview);
    }
  };

  // Upload photo to R2
  const handleUploadPhoto = async () => {
    if (!selectedPhoto) return;
    setUploadStatus('UPLOADING');
    setCameraError(null);

    try {
      const result = await uploadR2TestFile(selectedPhoto);
      setUploadStatus('SAVED');
      setUploadResultKey(result.key);
      loadR2Objects();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadStatus('ERROR');
      setCameraError(msg);
    }
  };

  // Handle D1 test write
  const handleD1Write = async () => {
    if (!d1TestKey || !d1TestVal) {
      setD1Message('请输入测试 Key 和 Value');
      return;
    }
    setD1Loading(true);
    setD1Message(null);

    try {
      const res = await writeD1TestRecord(
        d1TestKey,
        d1TestVal,
        `Device: ${isAndroid ? 'Android PDA' : 'Desktop Browser'} - UA: ${userAgent.substring(0, 40)}`
      );
      setD1Message(`✅ D1 写入成功: ID ${res.record.id}`);
      setD1TestVal('');
      loadDiagnostics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setD1Message(`❌ 写入失败: ${msg}`);
    } finally {
      setD1Loading(false);
    }
  };

  // Offline queue simulation
  const handleQueueOfflineItem = () => {
    if (!d1TestVal) return;
    const item = {
      key: d1TestKey,
      value: d1TestVal,
      time: new Date().toLocaleTimeString(),
    };
    setOfflinePendingQueue((prev) => [...prev, item]);
    setD1TestVal('');
  };

  const handleSyncOfflineQueue = async () => {
    if (offlinePendingQueue.length === 0) return;
    setD1Loading(true);
    try {
      for (const item of offlinePendingQueue) {
        await writeD1TestRecord(item.key, item.value, 'Synced from Offline Queue');
      }
      setOfflinePendingQueue([]);
      setD1Message('✅ 离线队列已全部同步至云端 D1');
      loadDiagnostics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setD1Message(`同步失败: ${msg}`);
    } finally {
      setD1Loading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-3 py-4 space-y-4">
      {/* Top Banner & Device Context */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-brand-600" />
            <div>
              <h1 className="text-base font-bold text-slate-800">
                Phase 0: PDA 设备与技术可行性验证
              </h1>
              <p className="text-xs text-slate-500">
                {isAndroid ? '检测到安卓移动设备 (Android PDA 环境)' : '桌面端开发测试环境'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOnline ? (
              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium border border-emerald-200">
                <Wifi className="w-3.5 h-3.5" />
                {pingLatency !== null ? `${pingLatency}ms` : '在线'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 font-medium border border-rose-200">
                <WifiOff className="w-3.5 h-3.5" />
                网络中断
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg bg-slate-200/80 p-1 text-xs font-medium">
        <button
          onClick={() => setActiveTab('scanner')}
          className={`flex-1 py-2 rounded-md transition flex items-center justify-center gap-1.5 tap-target ${
            activeTab === 'scanner'
              ? 'bg-white text-slate-900 shadow-sm font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Barcode className="w-4 h-4" />
          PDA 扫码测试
        </button>
        <button
          onClick={() => {
            setActiveTab('camera');
            loadR2Objects();
          }}
          className={`flex-1 py-2 rounded-md transition flex items-center justify-center gap-1.5 tap-target ${
            activeTab === 'camera'
              ? 'bg-white text-slate-900 shadow-sm font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Camera className="w-4 h-4" />
          PDA 相机与 R2
        </button>
        <button
          onClick={() => {
            setActiveTab('cloud');
            loadDiagnostics();
          }}
          className={`flex-1 py-2 rounded-md transition flex items-center justify-center gap-1.5 tap-target ${
            activeTab === 'cloud'
              ? 'bg-white text-slate-900 shadow-sm font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Database className="w-4 h-4" />
          D1 读写与多机
        </button>
        <button
          onClick={() => setActiveTab('network')}
          className={`flex-1 py-2 rounded-md transition flex items-center justify-center gap-1.5 tap-target ${
            activeTab === 'network'
              ? 'bg-white text-slate-900 shadow-sm font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="w-4 h-4" />
          离线与安全
        </button>
      </div>

      {/* Tab 1: Scanner Test */}
      {activeTab === 'scanner' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <Barcode className="w-4 h-4 text-brand-600" />
                Keyboard Wedge 扫码捕获
              </h2>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={continuousScan}
                  onChange={(e) => setContinuousScan(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                连续扫码保持焦点
              </label>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              请按下 PDA 侧面实体扫描键对准库位条码或 SKU 条码。如果设备工作在 Keyboard Wedge 模式，输入框将高速自动填入条码并附带回车或 Tab 键。
            </p>

            <div className="space-y-2">
              <input
                ref={scanInputRef}
                type="text"
                value={scanInputValue}
                onChange={(e) => setScanInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="点击此处或直接按 PDA 侧键扫码..."
                className="w-full px-3 py-2.5 bg-slate-50 border-2 border-brand-500 rounded-lg text-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />

              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-xs text-slate-400 self-center mr-1">电脑端模拟:</span>
                <button
                  type="button"
                  onClick={() => simulateScan('120-075-1')}
                  className="text-xs px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded border border-slate-300"
                >
                  库位: 120-075-1
                </button>
                <button
                  type="button"
                  onClick={() => simulateScan('SKU-99281')}
                  className="text-xs px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded border border-slate-300"
                >
                  SKU: SKU-99281
                </button>
                <button
                  type="button"
                  onClick={() => simulateScan('eBarcode-46')}
                  className="text-xs px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded border border-slate-300"
                >
                  多值条码: 46
                </button>
              </div>
            </div>
          </div>

          {/* Scan Events Log */}
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">
                扫码记录流 ({scanEvents.length})
              </span>
              {scanEvents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setScanEvents([])}
                  className="text-xs text-slate-400 hover:text-slate-600 underline"
                >
                  清空日志
                </button>
              )}
            </div>

            {scanEvents.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs">
                暂无扫码事件。请按扫描键或点击上方模拟条码。
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {scanEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex flex-col gap-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-900 text-sm">
                        {evt.code}
                      </span>
                      <span className="text-[10px] text-slate-400">{evt.timestamp}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                      <span
                        className={`px-1.5 py-0.5 rounded font-medium ${
                          evt.likelyType === 'LOCATION'
                            ? 'bg-blue-100 text-blue-800'
                            : evt.likelyType === 'SKU_OR_BARCODE'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {evt.likelyType === 'LOCATION'
                          ? '物理库位格式'
                          : evt.likelyType === 'SKU_OR_BARCODE'
                          ? '商品/条码格式'
                          : '通用格式'}
                      </span>

                      <span
                        className={`px-1.5 py-0.5 rounded ${
                          evt.inputMethod === 'keyboard-wedge'
                            ? 'bg-emerald-100 text-emerald-800 font-medium'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {evt.inputMethod === 'keyboard-wedge' ? '硬件扫描头 Wedge' : '人工慢速键盘'}
                      </span>

                      <span className="text-slate-500">
                        击键间隔: {evt.charIntervalAvgMs}ms
                      </span>

                      {evt.detectedEnter && (
                        <span className="bg-slate-200 text-slate-700 px-1 rounded">
                          Enter 结束符
                        </span>
                      )}
                      {evt.detectedTab && (
                        <span className="bg-slate-200 text-slate-700 px-1 rounded">
                          Tab 结束符
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Camera & R2 Photo Storage Test */}
      {activeTab === 'camera' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-brand-600" />
              PDA 原生相机与 R2 私有存储验证
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              测试浏览器唤起后置摄像头拍照能力，验证照片二进制数据能否直接上传至 Cloudflare R2 私有 Bucket。
            </p>

            <div className="space-y-3 pt-1">
              <label className="block">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoChange}
                  className="block w-full text-xs text-slate-500
                    file:mr-3 file:py-2.5 file:px-4
                    file:rounded-lg file:border-0
                    file:text-xs file:font-semibold
                    file:bg-brand-50 file:text-brand-700
                    hover:file:bg-brand-100 cursor-pointer"
                />
              </label>

              {photoPreview && (
                <div className="space-y-2">
                  <div className="border border-slate-200 rounded-lg overflow-hidden max-h-48 flex justify-center bg-black/5">
                    <img
                      src={photoPreview}
                      alt="PDA Capture Preview"
                      className="object-contain max-h-48"
                    />
                  </div>

                  {selectedPhoto && (
                    <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 p-2 rounded">
                      <span>文件: {selectedPhoto.name}</span>
                      <span>大小: {Math.round(selectedPhoto.size / 1024)} KB</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleUploadPhoto}
                      disabled={uploadStatus === 'UPLOADING'}
                      className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <UploadCloud className="w-4 h-4" />
                      {uploadStatus === 'UPLOADING' ? '正在上传至 R2...' : '测试上传至 Cloudflare R2'}
                    </button>
                  </div>
                </div>
              )}

              {/* Upload Status Badge */}
              {uploadStatus === 'SAVED' && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    云端已成功保存 (Cloudflare R2)
                  </div>
                  <div className="font-mono text-[11px] break-all">
                    Key: {uploadResultKey}
                  </div>
                </div>
              )}

              {uploadStatus === 'ERROR' && cameraError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    R2 上传失败
                  </div>
                  <p>{cameraError}</p>
                </div>
              )}
            </div>
          </div>

          {/* R2 Objects List */}
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">
                R2 测试对象列表 ({r2FileList.length})
              </span>
              <button
                type="button"
                onClick={loadR2Objects}
                className="text-xs text-brand-600 hover:text-brand-800 flex items-center gap-1"
              >
                <RotateCw className="w-3 h-3" />
                刷新
              </button>
            </div>

            {r2FileList.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">暂无测试照片或 R2 未配置</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {r2FileList.map((f) => (
                  <div
                    key={f.key}
                    className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200 text-xs"
                  >
                    <span className="font-mono text-slate-800 truncate max-w-[200px]">
                      {f.key}
                    </span>
                    <span className="text-slate-500 font-mono text-[11px]">
                      {Math.round(f.size / 1024)} KB
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Cloud Diagnostics & D1 Multi-device Test */}
      {activeTab === 'cloud' && (
        <div className="space-y-4">
          {/* Health Overview */}
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-brand-600" />
              Cloudflare D1 数据库读写验证
            </h2>

            {healthData && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block text-[10px]">D1 状态</span>
                  <span className="font-semibold text-slate-800">
                    {healthData.bindings.d1.details}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block text-[10px]">R2 状态</span>
                  <span className="font-semibold text-slate-800">
                    {healthData.bindings.r2.details}
                  </span>
                </div>
              </div>
            )}

            {/* Manual Write Test Form */}
            <div className="space-y-2 pt-1 border-t border-slate-100">
              <span className="text-xs font-semibold text-slate-700 block">
                写入一条 D1 测试记录
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={d1TestKey}
                  onChange={(e) => setD1TestKey(e.target.value)}
                  placeholder="测试 Key"
                  className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded"
                />
                <input
                  type="text"
                  value={d1TestVal}
                  onChange={(e) => setD1TestVal(e.target.value)}
                  placeholder="测试 Value (如 库位 120-075-1)"
                  className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded"
                />
              </div>

              <button
                type="button"
                onClick={handleD1Write}
                disabled={d1Loading}
                className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-medium rounded-lg disabled:opacity-50"
              >
                {d1Loading ? '正在写入 D1...' : '写入并立即读回校验 (Read-After-Write)'}
              </button>

              {d1Message && (
                <div className="text-xs p-2 rounded bg-slate-100 text-slate-800 font-mono">
                  {d1Message}
                </div>
              )}
            </div>
          </div>

          {/* D1 History & Cross-Device List */}
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">
                云端 D1 最新诊断记录 (多机验证)
              </span>
              <button
                type="button"
                onClick={loadDiagnostics}
                className="text-xs text-brand-600 hover:text-brand-800 flex items-center gap-1"
              >
                <RotateCw className="w-3 h-3" />
                刷新
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              可以在手机/PDA与电脑上同时打开本页面，在一端写入，在另一端点击刷新，验证云端数据一致性。
            </p>

            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {diagnosticsList.length === 0 ? (
                <p className="text-xs text-slate-400 py-3 text-center">暂无诊断记录</p>
              ) : (
                diagnosticsList.map((d) => (
                  <div
                    key={d.id}
                    className="p-2 rounded bg-slate-50 border border-slate-200 text-xs flex flex-col gap-0.5"
                  >
                    <div className="flex justify-between font-mono">
                      <span className="font-bold text-slate-800">{d.test_key}: {d.test_value}</span>
                      <span className="text-[10px] text-slate-400">{d.server_timestamp}</span>
                    </div>
                    {d.notes && <p className="text-[10px] text-slate-500">{d.notes}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Network & Offline & Auth */}
      {activeTab === 'network' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Wifi className="w-4 h-4 text-brand-600" />
              网络中断保护与待同步队列 (IndexedDB 模式)
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              现场 Wi-Fi 偶发中断时，数据不会静默丢弃。输入暂存入本地待同步队列，网络恢复后安全提交。
            </p>

            <div className="space-y-2 pt-1">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={d1TestVal}
                  onChange={(e) => setD1TestVal(e.target.value)}
                  placeholder="输入拟核查数据 (模拟断网录入)"
                  className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded"
                />
                <button
                  type="button"
                  onClick={handleQueueOfflineItem}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-medium"
                >
                  暂存本地队列
                </button>
              </div>

              {offlinePendingQueue.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-xs text-amber-900 font-bold">
                    <span>本地待同步记录 ({offlinePendingQueue.length})</span>
                    <button
                      type="button"
                      onClick={handleSyncOfflineQueue}
                      disabled={d1Loading || !isOnline}
                      className="px-2.5 py-1 bg-amber-700 text-white rounded text-xs disabled:opacity-50"
                    >
                      立即同步到云端
                    </button>
                  </div>

                  <div className="space-y-1 text-xs">
                    {offlinePendingQueue.map((item, idx) => (
                      <div key={idx} className="flex justify-between bg-white/70 p-1.5 rounded">
                        <span>{item.key}: {item.value}</span>
                        <span className="text-[10px] text-slate-400">{item.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Cloudflare Access Authentication State */}
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-2">
            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-brand-600" />
              Cloudflare Access 身份鉴权验证
            </h2>
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">鉴权模式:</span>
                <span className="font-mono font-bold text-slate-800">{authData?.mode || '未知'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">认证通过状态:</span>
                <span className={`font-bold ${authData?.authenticated ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {authData?.authenticated ? '已通过认证' : '未授权 / 待接入 Access'}
                </span>
              </div>
              {authData?.user ? (
                <div className="pt-1 text-[11px] text-slate-600 border-t border-slate-200 mt-1">
                  用户: {JSON.stringify(authData.user)}
                </div>
              ) : null}
              {authData?.error && (
                <p className="text-[11px] text-amber-700 pt-1">
                  提示: {authData.error}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
