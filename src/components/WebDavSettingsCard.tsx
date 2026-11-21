import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Download,
  Eye,
  EyeOff,
  Keyboard,
  Loader2,
  Mic,
  RefreshCw,
  Smartphone,
  Terminal,
  Wifi,
} from "lucide-react";
import { CopyButton } from "./CopyButton";
import { AndroidQrImport } from "./AndroidQrImport";
import { IosShortcutImport } from "./IosShortcutImport";
import type { AppSettings, MobileHelperInfo, WebDavSyncResult } from "../types";

const NUTSTORE_DEFAULT_URL = "https://dav.jianguoyun.com/dav/WeekLoom/inbox/";

const SYNC_INTERVAL_OPTIONS = [
  { value: 2, label: "每 2 分钟" },
  { value: 5, label: "每 5 分钟（推荐，防坚果云限流）" },
  { value: 15, label: "每 15 分钟" },
  { value: 30, label: "每 30 分钟" },
  { value: 60, label: "每 60 分钟" },
];

interface WebDavSettingsCardProps {
  form: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

export const WebDavSettingsCard: React.FC<WebDavSettingsCardProps> = ({ form, onChange }) => {
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [showHelper, setShowHelper] = useState(false);
  const [helperTab, setHelperTab] = useState<"ios" | "android">("ios");
  const [iosMode, setIosMode] = useState<"voice" | "text">("voice");
  const [showSecrets, setShowSecrets] = useState(false);
  const [showCurl, setShowCurl] = useState(false);
  const [exportingAndroid, setExportingAndroid] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ ok: boolean; message: string } | null>(
    null
  );
  const [helperInfo, setHelperInfo] = useState<MobileHelperInfo | null>(null);
  const [helperError, setHelperError] = useState<string | null>(null);

  useEffect(() => {
    if (!showHelper) return;
    let cancelled = false;

    invoke<MobileHelperInfo>("build_webdav_mobile_helper", {
      url: form.webdav_url,
      username: form.webdav_username,
      password: form.webdav_password,
    })
      .then((info) => {
        if (!cancelled) {
          setHelperInfo(info);
          setHelperError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setHelperInfo(null);
          setHelperError(typeof err === "string" ? err : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showHelper, form.webdav_url, form.webdav_username, form.webdav_password]);

  const handleTestAndInit = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const msg = await invoke<string>("test_webdav_connection", {
        url: form.webdav_url,
        username: form.webdav_username,
        password: form.webdav_password,
      });
      setFeedback({ ok: true, message: msg });
    } catch (err) {
      setFeedback({
        ok: false,
        message: typeof err === "string" ? err : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await invoke<WebDavSyncResult>("sync_webdav_now", {
        url: form.webdav_url,
        username: form.webdav_username,
        password: form.webdav_password,
      });
      setFeedback({ ok: true, message: res.message });
    } catch (err) {
      setFeedback({
        ok: false,
        message: typeof err === "string" ? err : String(err),
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleExportAndroidConfig = async () => {
    setExportingAndroid(true);
    setExportFeedback(null);
    try {
      const savedPath = await invoke<string>("export_android_shortcuts_file", {
        url: form.webdav_url,
        username: form.webdav_username,
        password: form.webdav_password,
      });
      setExportFeedback({
        ok: true,
        message: `已导出至：${savedPath}（发送给手机后在 HTTP Shortcuts 导入即可）`,
      });
    } catch (err) {
      setExportFeedback({
        ok: false,
        message: typeof err === "string" ? err : String(err),
      });
    } finally {
      setExportingAndroid(false);
    }
  };

  const maskedAuthHeader = helperInfo
    ? `${helperInfo.auth_header.slice(0, 12)}••••••••••••••••••••`
    : "";

  const maskedCurlCommand = helperInfo
    ? helperInfo.curl_command.replace(
        /-u '.*?' -H/,
        `-u '${form.webdav_username.trim()}:••••••••' -H`
      )
    : "";

  return (
    <section className="rounded-2xl bg-surface-card border border-border-subtle shadow-soft p-5 space-y-4">
      {/* Header + Master Toggle */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-subtle text-brand flex items-center justify-center shrink-0 mt-0.5">
            <Cloud className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-ink-primary">
                手机远程记录（WebDAV 收件箱）
              </h2>
              <span className="px-1.5 py-0.5 rounded-md bg-brand-subtle text-brand text-[10px] font-medium">
                零自建后端
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              外出未开电脑时，通过手机向坚果云 / NAS / Nextcloud 收件箱投递记录；电脑开机后自动拉取入本地
              SQLite 并清理远端文件
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={form.webdav_enabled}
          onClick={() => onChange({ webdav_enabled: !form.webdav_enabled })}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors mt-1 ${
            form.webdav_enabled ? "bg-brand" : "bg-border-strong"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
              form.webdav_enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Form Fields */}
      <div className="space-y-3 pt-1">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-ink-secondary">
              WebDAV 收件箱目录地址
            </label>
            {form.webdav_url.trim() !== NUTSTORE_DEFAULT_URL && (
              <button
                type="button"
                onClick={() => onChange({ webdav_url: NUTSTORE_DEFAULT_URL })}
                className="text-[11px] text-brand hover:text-brand-hover font-medium transition-colors"
              >
                填入坚果云默认路径
              </button>
            )}
          </div>
          <input
            type="text"
            value={form.webdav_url}
            onChange={(e) => onChange({ webdav_url: e.target.value })}
            placeholder={NUTSTORE_DEFAULT_URL}
            className="w-full rounded-xl bg-surface-elevated border border-border-subtle px-3.5 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-brand transition-colors"
          />
          <p className="text-[11px] text-ink-muted mt-1">
            支持坚果云、Nextcloud、群晖 NAS、Alist 等标准 WebDAV；团队共用同一网盘时，每人可填写独立子目录（如{" "}
            <code className="px-1 py-0.5 rounded bg-surface-elevated text-[10px]">
              .../WeekLoom/alice/inbox/
            </code>
            ）
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              WebDAV 账号（邮箱 / 用户名）
            </label>
            <input
              type="text"
              value={form.webdav_username}
              onChange={(e) => onChange({ webdav_username: e.target.value })}
              placeholder="例如：name@example.com"
              className="w-full rounded-xl bg-surface-elevated border border-border-subtle px-3.5 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-brand transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              应用专用密码
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={form.webdav_password}
                onChange={(e) => onChange({ webdav_password: e.target.value })}
                placeholder="坚果云第三方应用密码"
                className="w-full rounded-xl bg-surface-elevated border border-border-subtle pl-3.5 pr-10 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-brand transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? "隐藏密码" : "显示密码"}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink-primary transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-ink-muted -mt-1">
          坚果云请登录网页版「账户信息 → 安全选项 → 第三方应用管理」新建专用应用密码，切勿直接填写登录密码
        </p>

        {/* Interval & Actions */}
        <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
          <div className="min-w-[220px]">
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              后台自动拉取间隔
            </label>
            <select
              value={form.webdav_sync_interval_mins}
              onChange={(e) =>
                onChange({ webdav_sync_interval_mins: Number(e.target.value) || 5 })
              }
              className="w-full rounded-xl bg-surface-elevated border border-border-subtle px-3 py-2 text-xs text-ink-primary focus:outline-none focus:border-brand transition-colors"
            >
              {SYNC_INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTestAndInit}
              disabled={testing || syncing}
              className="inline-flex items-center gap-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border-subtle px-3.5 py-2 text-xs font-medium text-ink-primary disabled:opacity-50 transition-colors"
            >
              {testing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
              ) : (
                <Wifi className="w-3.5 h-3.5 text-brand" />
              )}
              <span>{testing ? "检测中..." : "测试并初始化目录"}</span>
            </button>

            <button
              type="button"
              onClick={handleSyncNow}
              disabled={syncing || testing}
              className="inline-flex items-center gap-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border-subtle px-3.5 py-2 text-xs font-medium text-ink-primary disabled:opacity-50 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-brand ${syncing ? "animate-spin" : ""}`}
              />
              <span>{syncing ? "同步中..." : "立即同步"}</span>
            </button>
          </div>
        </div>

        {/* Feedback Banner */}
        {feedback && (
          <div
            className={`rounded-xl px-3.5 py-2.5 text-xs flex items-center gap-2 border ${
              feedback.ok
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
            }`}
          >
            {feedback.ok ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}
      </div>

      {/* Collapsible Mobile Setup Assistant */}
      <div className="pt-3 border-t border-border-subtle">
        <button
          type="button"
          onClick={() => setShowHelper((v) => !v)}
          className="w-full flex items-center justify-between rounded-xl bg-surface-elevated/70 hover:bg-surface-hover border border-border-subtle px-3.5 py-2.5 text-xs font-medium text-ink-primary transition-colors"
        >
          <span className="inline-flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-brand" />
            <span>手机端一键配置助手（iPhone 快捷指令 / Android HTTP Shortcuts）</span>
          </span>
          {showHelper ? (
            <ChevronUp className="w-4 h-4 text-ink-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-ink-muted" />
          )}
        </button>

        {showHelper && (
          <div className="mt-3 rounded-xl bg-surface-elevated/50 border border-border-subtle p-4 space-y-4">
            {/* Platform Switch */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-lg bg-surface-card p-1 border border-border-subtle">
                <button
                  type="button"
                  onClick={() => setHelperTab("ios")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    helperTab === "ios"
                      ? "bg-brand-subtle text-brand"
                      : "text-ink-secondary hover:text-ink-primary"
                  }`}
                >
                  iPhone 快捷指令
                </button>
                <button
                  type="button"
                  onClick={() => setHelperTab("android")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    helperTab === "android"
                      ? "bg-brand-subtle text-brand"
                      : "text-ink-secondary hover:text-ink-primary"
                  }`}
                >
                  Android (HTTP Shortcuts)
                </button>
              </div>

              {helperInfo && (
                <button
                  type="button"
                  onClick={() => setShowSecrets((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink-primary transition-colors"
                >
                  {showSecrets ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>隐藏凭证</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      <span>显示明文凭证</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {helperTab === "ios" && <IosShortcutImport />}
            {helperError ? (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{helperTab === "ios" && "手动配置所需参数 · "}{helperError}</span>
              </div>
            ) : (
              helperInfo &&
              (helperTab === "ios" ? (
                <div className="space-y-3">
                  {/* Copyable Fields for iOS */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-card border border-border-subtle px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[11px] text-ink-muted">收件箱 URL 前缀</p>
                        <p className="text-xs font-mono text-ink-primary truncate mt-0.5">
                          {helperInfo.inbox_url}
                        </p>
                      </div>
                      <CopyButton text={helperInfo.inbox_url} label="复制 URL" />
                    </div>

                    <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-card border border-border-subtle px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[11px] text-ink-muted">
                          HTTP 请求头 Authorization 值（已自动 Base64 编码）
                        </p>
                        <p className="text-xs font-mono text-ink-primary truncate mt-0.5">
                          {showSecrets ? helperInfo.auth_header : maskedAuthHeader}
                        </p>
                      </div>
                      <CopyButton text={helperInfo.auth_header} label="复制认证头" />
                    </div>
                  </div>

                  {/* Mode Toggle: Pure Voice vs Text+Keyboard Voice */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIosMode("voice")}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs border transition-all ${
                        iosMode === "voice"
                          ? "border-brand bg-brand-subtle text-brand font-medium"
                          : "border-border-subtle bg-surface-card text-ink-secondary hover:text-ink-primary"
                      }`}
                    >
                      <Mic className="w-3.5 h-3.5 shrink-0" />
                      <div>
                        <p>纯语音极速版（推荐）</p>
                        <p className="text-[10px] opacity-80 font-normal">说完自动发走，免按提交</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIosMode("text")}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs border transition-all ${
                        iosMode === "text"
                          ? "border-brand bg-brand-subtle text-brand font-medium"
                          : "border-border-subtle bg-surface-card text-ink-secondary hover:text-ink-primary"
                      }`}
                    >
                      <Keyboard className="w-3.5 h-3.5 shrink-0" />
                      <div>
                        <p>弹窗输入版</p>
                        <p className="text-[10px] opacity-80 font-normal">打字 / 键盘麦克风均可</p>
                      </div>
                    </button>
                  </div>

                  {/* Step-by-step iOS Guide */}
                  <div className="rounded-lg bg-surface-card/70 border border-border-subtle p-3 space-y-2 text-xs text-ink-secondary leading-relaxed">
                    <p className="font-semibold text-ink-primary">
                      {iosMode === "voice"
                        ? "iPhone 纯语音极速版（仅 3 个动作，配好后说话即记录）："
                        : "iPhone 弹窗输入版（打字与键盘语音输入均可）："}
                    </p>
                    <ol className="list-decimal pl-4 space-y-1.5">
                      {iosMode === "voice" ? (
                        <li>
                          打开 iPhone 自带「快捷指令」新建{" "}
                          <span className="font-medium text-ink-primary">记一笔</span>，添加动作{" "}
                          <span className="font-medium text-ink-primary">听写文本</span>
                          （停止聆听选「暂停时」，说完停顿 2 秒即自动进入下一步）。
                        </li>
                      ) : (
                        <li>
                          打开 iPhone 自带「快捷指令」新建{" "}
                          <span className="font-medium text-ink-primary">记一笔 WeekLoom</span>
                          ，添加动作{" "}
                          <span className="font-medium text-ink-primary">要求输入</span>
                          （类型选文本，提示填“今天干了啥？”，弹窗后可打字或按键盘右下角麦克风语音输入）。
                        </li>
                      )}
                      <li>
                        添加 <span className="font-medium text-ink-primary">格式化日期</span>
                        （当前日期 → 展开箭头 → 日期格式选「自定」→ 填入{" "}
                        <code className="px-1 py-0.5 rounded bg-surface-elevated text-[11px]">
                          yyyyMMdd-HHmmss
                        </code>
                        ）。
                      </li>
                      <li>
                        添加 <span className="font-medium text-ink-primary">获取 URL 内容</span>：
                        URL 填上方前缀 +{" "}
                        <code className="px-1 rounded bg-surface-elevated">格式化后的日期</code> +{" "}
                        <code className="px-1 rounded bg-surface-elevated">.json</code>；方法选{" "}
                        <code className="px-1 rounded bg-surface-elevated">PUT</code>；头部新增{" "}
                        <code className="px-1 rounded bg-surface-elevated">Authorization</code>{" "}
                        粘贴上方认证头；请求体选{" "}
                        <span className="font-medium text-ink-primary">JSON</span>，新增文本键{" "}
                        <code className="px-1 rounded bg-surface-elevated">content</code> ={" "}
                        <span className="font-medium text-ink-primary">
                          {iosMode === "voice" ? "「听写的文本」" : "「提供的输入」"}
                        </span>
                        。
                      </li>
                      <li>
                        （可选）添加{" "}
                        <span className="font-medium text-ink-primary">显示通知</span>
                        （“已发送到 WeekLoom”）。
                      </li>
                    </ol>
                    <p className="text-[11px] text-ink-muted pt-1 border-t border-border-subtle">
                      快捷入口建议：添加到主屏幕 / 锁屏小组件，或在「设置 → 辅助功能 → 触控 → 轻点背面」设为轻点两下触发
                      {iosMode === "voice" ? "，甚至直接喊「嘿 Siri，记一笔」全程免手动操作。" : "。"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg bg-surface-card border border-border-subtle p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-ink-primary">
                          将「记一笔 WeekLoom」导入手机
                        </p>
                        <p className="text-[11px] text-ink-muted mt-0.5">
                          先在安卓手机上安装 HTTP Shortcuts，并将手机和电脑连入同一局域网。
                        </p>
                      </div>
                      <AndroidQrImport url={form.webdav_url} username={form.webdav_username} password={form.webdav_password} />
                    </div>
                    <p className="text-xs leading-relaxed text-ink-secondary">
                      导入后，长按「记一笔 WeekLoom」可将它放到主屏幕。支持键盘语音输入、分享文字和断网补发。
                    </p>
                    <details className="border-t border-border-subtle pt-2">
                      <summary className="cursor-pointer text-xs font-medium text-ink-secondary">其他方式 · 文件导入</summary>
                      <p className="my-2 text-xs leading-relaxed text-ink-secondary">
                        将导出的 JSON 文件传到手机，在 HTTP Shortcuts 的「导入 / 导出 → 从文件导入」中选择它。
                        文件包含 WebDAV 凭证，请通过可信方式传输。
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleExportAndroidConfig}
                          disabled={exportingAndroid}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-brand disabled:opacity-50"
                        >
                          {exportingAndroid ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                          <span>导出 .json 文件</span>
                        </button>
                        <CopyButton text={helperInfo.android_shortcuts_json} label="复制 JSON" />
                      </div>
                      {exportFeedback && (
                        <p role="status" className={`mt-2 flex items-center gap-2 text-xs ${
                          exportFeedback.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"
                        }`}>
                          {exportFeedback.ok ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                          <span className="break-all">{exportFeedback.message}</span>
                        </p>
                      )}
                    </details>
                  </div>

                  {/* Secondary Collapsible cURL Test Command */}
                  <div className="rounded-lg bg-surface-card/70 border border-border-subtle px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setShowCurl((v) => !v)}
                      className="w-full flex items-center justify-between text-[11px] font-medium text-ink-muted hover:text-ink-primary transition-colors"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-brand" />
                        <span>进阶：终端测试用 cURL 命令</span>
                      </span>
                      {showCurl ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {showCurl && (
                      <div className="mt-2 pt-2 border-t border-border-subtle space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-ink-muted">
                            可在电脑终端运行发送一条测试记录，再点「立即同步」验证链路
                          </span>
                          <CopyButton text={helperInfo.curl_command} label="复制 cURL" />
                        </div>
                        <pre className="text-[11px] font-mono text-ink-secondary bg-surface-elevated rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-all select-all">
                          {showSecrets ? helperInfo.curl_command : maskedCurlCommand}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
};
