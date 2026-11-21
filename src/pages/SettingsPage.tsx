import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  GitBranch,
  Keyboard,
  Loader2,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sun,
  Wifi,
} from "lucide-react";
import { WebDavSettingsCard } from "../components/WebDavSettingsCard";
import {
  CUSTOM_INSTRUCTION_PRESETS,
  MAX_CUSTOM_INSTRUCTIONS_CHARS,
  REPORT_FORMAT_OPTIONS,
  ROLE_OPTIONS,
  STYLE_OPTIONS,
  normalizeReportFormat,
  normalizeReportStyle,
  normalizeRolePreset,
  type AppSettings,
  type DeepSeekModelInfo,
  type Platform,
} from "../types";
import { formatShortcutForDisplay } from "../utils/date";

const CACHED_MODELS_KEY = "weekloom_deepseek_models";

const FALLBACK_MODELS: DeepSeekModelInfo[] = [
  { id: "deepseek-flash" },
  { id: "deepseek-v4-pro" },
];

function loadCachedModels(): DeepSeekModelInfo[] {
  try {
    const raw = window.localStorage.getItem(CACHED_MODELS_KEY);
    if (!raw) return FALLBACK_MODELS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // ignore invalid cache
  }
  return FALLBACK_MODELS;
}

function areSettingsEqual(a: AppSettings, b: AppSettings): boolean {
  // Theme and update preferences are saved immediately outside the editable form.
  return (
    a.api_key === b.api_key &&
    a.model.trim() === b.model.trim() &&
    normalizeRolePreset(a.default_role) === normalizeRolePreset(b.default_role) &&
    a.custom_role.trim() === b.custom_role.trim() &&
    normalizeReportStyle(a.default_style) === normalizeReportStyle(b.default_style) &&
    normalizeReportFormat(a.report_format) === normalizeReportFormat(b.report_format) &&
    a.report_custom_instructions.trim() === b.report_custom_instructions.trim() &&
    a.include_last_week_plan === b.include_last_week_plan &&
    a.reminder_enabled === b.reminder_enabled &&
    a.reminder_time === b.reminder_time &&
    a.shortcut === b.shortcut &&
    a.webdav_enabled === b.webdav_enabled &&
    a.webdav_url.trim() === b.webdav_url.trim() &&
    a.webdav_username.trim() === b.webdav_username.trim() &&
    a.webdav_password === b.webdav_password &&
    a.webdav_sync_interval_mins === b.webdav_sync_interval_mins
  );
}

interface SettingsPageProps {
  settings: AppSettings;
  platform: Platform;
  onSettingsSaved: (updated: AppSettings) => void;
  onDirtyChange?: (dirty: boolean) => void;
  saveHandlerRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

function keyEventToTauriShortcut(e: React.KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");

  // Ignore standalone modifier presses
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
    return null;
  }

  // Require at least one modifier for global shortcut safety
  if (mods.length === 0) {
    return null;
  }

  let keyPart = "";
  if (/^Key([A-Z])$/.test(e.code)) {
    keyPart = e.code.slice(3);
  } else if (/^Digit([0-9])$/.test(e.code)) {
    keyPart = e.code.slice(5);
  } else if (/^F([1-9]|1[0-2])$/.test(e.code)) {
    keyPart = e.code;
  } else if (e.code === "Space") {
    keyPart = "Space";
  } else if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
    keyPart = e.key.toUpperCase();
  } else {
    return null;
  }

  return [...mods, keyPart].join("+");
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  platform,
  onSettingsSaved,
  onDirtyChange,
  saveHandlerRef,
}) => {
  const [form, setForm] = useState<AppSettings>(settings);
  const [showKey, setShowKey] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [models, setModels] = useState<DeepSeekModelInfo[]>(() => loadCachedModels());
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsFeedback, setModelsFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customRoleError, setCustomRoleError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ type: "ok" | "warn" | "err"; text: string } | null>(null);
  const lastAutoSyncedKeyRef = useRef<string>("");
  const prevSettingsRef = useRef<AppSettings>(settings);
  const onSettingsSavedRef = useRef(onSettingsSaved);
  onSettingsSavedRef.current = onSettingsSaved;
  const customRoleInputRef = useRef<HTMLInputElement | null>(null);

  const isDirty = useMemo(() => !areSettingsEqual(form, settings), [form, settings]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  useEffect(() => {
    const prev = prevSettingsRef.current;
    if (prev === settings) return;

    const patch: Partial<AppSettings> = {};
    (Object.keys(settings) as Array<keyof AppSettings>).forEach((key) => {
      if (settings[key] !== prev[key]) {
        (patch as Record<string, AppSettings[keyof AppSettings]>)[key] = settings[key];
      }
    });
    prevSettingsRef.current = settings;

    if (Object.keys(patch).length > 0) {
      setForm((current) => ({ ...current, ...patch }));
    }
  }, [settings]);

  // Silently sync live official models when opening Settings with a saved API Key
  useEffect(() => {
    const savedKey = settings.api_key.trim();
    if (!savedKey || lastAutoSyncedKeyRef.current === savedKey) return;

    let cancelled = false;
    invoke<DeepSeekModelInfo[]>("fetch_deepseek_models", { apiKey: savedKey })
      .then(async (fetched) => {
        if (cancelled || fetched.length === 0) return;
        lastAutoSyncedKeyRef.current = savedKey;
        setModels(fetched);
        try {
          window.localStorage.setItem(CACHED_MODELS_KEY, JSON.stringify(fetched));
        } catch {
          // ignore storage quota errors
        }

        // Read latest authoritative settings from DB to avoid overwriting concurrent changes
        const latest = await invoke<AppSettings>("get_settings");
        if (cancelled || latest.api_key.trim() !== savedKey) return;

        // If previously saved model was retired by DeepSeek, auto-switch and persist
        if (!fetched.some((m) => m.id === latest.model)) {
          const fallbackModel =
            fetched.find((m) => m.id === "deepseek-flash")?.id ?? fetched[0].id;
          const updated: AppSettings = { ...latest, model: fallbackModel };
          try {
            await invoke("save_settings", { settings: updated });
            if (!cancelled) {
              setForm((prev) => ({ ...prev, model: fallbackModel }));
              onSettingsSavedRef.current(updated);
              setModelsFeedback({
                ok: true,
                message: `检测到原模型「${latest.model}」已下线，已自动切换为「${fallbackModel}」并保存`,
              });
            }
          } catch {
            // ignore silent save failure; user can still click save manually
          }
        }
      })
      .catch(() => {
        // Silent background sync: ignore offline / transient network errors
      });

    return () => {
      cancelled = true;
    };
  }, [settings.api_key]);

  const handleThemeSwitch = async (theme: "light" | "dark") => {
    const previousTheme = settings.theme;
    setForm((prev) => ({ ...prev, theme }));
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      const latest = await invoke<AppSettings>("get_settings");
      const next: AppSettings = { ...latest, theme };
      await invoke("save_settings", { settings: next });
      onSettingsSaved(next);
    } catch (err) {
      document.documentElement.classList.toggle("dark", previousTheme === "dark");
      setForm((prev) => ({ ...prev, theme: previousTheme }));
      console.error("Failed to persist theme:", err);
    }
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setModelsFeedback(null);
    try {
      const fetched = await invoke<DeepSeekModelInfo[]>("fetch_deepseek_models", {
        apiKey: form.api_key,
      });
      setModels(fetched);
      try {
        window.localStorage.setItem(CACHED_MODELS_KEY, JSON.stringify(fetched));
      } catch {
        // ignore storage quota errors
      }

      // If current model is no longer in the live list, auto-pick deepseek-flash or the first model
      if (!fetched.some((m) => m.id === form.model)) {
        const preferred =
          fetched.find((m) => m.id === "deepseek-flash")?.id ?? fetched[0]?.id ?? form.model;
        setForm((prev) => ({ ...prev, model: preferred }));
      }

      setModelsFeedback({
        ok: true,
        message: `已获取官网最新支持的 ${fetched.length} 个模型，可在下拉框中直接选择`,
      });
    } catch (err) {
      setModelsFeedback({
        ok: false,
        message: typeof err === "string" ? err : String(err),
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const msg = await invoke<string>("test_deepseek_connection", {
        apiKey: form.api_key,
        model: form.model || "deepseek-flash",
      });
      setTestResult({ ok: true, message: msg });
    } catch (err) {
      setTestResult({ ok: false, message: typeof err === "string" ? err : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleTestNotification = async () => {
    try {
      await invoke("send_test_notification");
    } catch (err) {
      setSaveMessage({
        type: "err",
        text: typeof err === "string" ? err : "发送测试通知失败，请检查系统通知权限",
      });
    }
  };

  const handleDiscardChanges = () => {
    setForm(settings);
    setCustomRoleError(null);
    setSaveMessage(null);
  };

  const handleAppendPresetInstruction = (preset: string) => {
    setForm((prev) => {
      const current = prev.report_custom_instructions.trim();
      if (current.includes(preset)) {
        return prev;
      }
      const next = current ? `${current}；${preset}` : preset;
      if (next.length > MAX_CUSTOM_INSTRUCTIONS_CHARS) {
        setSaveMessage({
          type: "err",
          text: `附加撰写规范不能超过 ${MAX_CUSTOM_INSTRUCTIONS_CHARS} 个字符`,
        });
        return prev;
      }
      return { ...prev, report_custom_instructions: next };
    });
  };

  const handleSave = useCallback(async (): Promise<boolean> => {
    const normalizedRole = normalizeRolePreset(form.default_role);
    const trimmedCustomRole = form.custom_role.trim();
    const trimmedInstructions = form.report_custom_instructions.trim();

    if (normalizedRole === "custom" && !trimmedCustomRole) {
      const msg = "已选择「自定义岗位」，请先填写自定义默认岗位名称";
      setCustomRoleError(msg);
      setSaveMessage({ type: "err", text: msg });
      customRoleInputRef.current?.focus();
      return false;
    }

    if (trimmedInstructions.length > MAX_CUSTOM_INSTRUCTIONS_CHARS) {
      setSaveMessage({
        type: "err",
        text: `附加撰写规范不能超过 ${MAX_CUSTOM_INSTRUCTIONS_CHARS} 个字符`,
      });
      return false;
    }

    const payload: AppSettings = {
      ...form,
      default_role: normalizedRole,
      custom_role: trimmedCustomRole,
      default_style: normalizeReportStyle(form.default_style),
      report_format: normalizeReportFormat(form.report_format),
      report_custom_instructions: trimmedInstructions,
    };

    setCustomRoleError(null);
    setSaving(true);
    setSaveMessage(null);
    try {
      const warning = await invoke<string | null>("save_settings", { settings: payload });
      const latest = await invoke<AppSettings>("get_settings");
      prevSettingsRef.current = latest;
      setForm(latest);
      onSettingsSavedRef.current(latest);

      if (warning) {
        setSaveMessage({ type: "warn", text: `其他设置已保存，但${warning}` });
      } else {
        setSaveMessage({ type: "ok", text: "设置已保存并立即生效" });
        window.setTimeout(() => setSaveMessage(null), 2500);
      }
      return true;
    } catch (err) {
      setSaveMessage({
        type: "err",
        text: typeof err === "string" ? err : "保存设置失败",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [form]);

  useEffect(() => {
    if (saveHandlerRef) {
      saveHandlerRef.current = handleSave;
    }
    return () => {
      if (saveHandlerRef) {
        saveHandlerRef.current = null;
      }
    };
  }, [handleSave, saveHandlerRef]);

  const normalizedRole = normalizeRolePreset(form.default_role);
  const normalizedStyle = normalizeReportStyle(form.default_style);
  const normalizedFormat = normalizeReportFormat(form.report_format);
  const selectedRoleOption = ROLE_OPTIONS.find((item) => item.value === normalizedRole);
  const selectedStyleOption = STYLE_OPTIONS.find((item) => item.value === normalizedStyle);
  const selectedFormatOption = REPORT_FORMAT_OPTIONS.find((item) => item.value === normalizedFormat);
  const instructionsLen = form.report_custom_instructions.trim().length;

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="max-w-3xl mx-auto space-y-5 pb-12">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary tracking-tight">设置</h1>
            <p className="text-xs text-ink-muted mt-1">
              配置外观主题、DeepSeek 模型接口、周报默认偏好、全局快捷键、定时提醒与手机端 WebDAV 远程同步（密钥均仅存于本地）
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="relative shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-xs font-medium px-4 py-2.5 shadow-sm transition-colors"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>保存设置</span>
            {isDirty && !saving && (
              <span
                title="有未保存更改"
                className="w-2 h-2 rounded-full bg-amber-300 ring-2 ring-brand ml-0.5"
              />
            )}
          </button>
        </div>

        {/* Save Feedback Banner */}
        {saveMessage && (
          <div
            className={`rounded-xl px-4 py-3 text-xs flex items-center gap-2 border ${
              saveMessage.type === "ok"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                : saveMessage.type === "warn"
                ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
                : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
            }`}
          >
            {saveMessage.type === "ok" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{saveMessage.text}</span>
          </div>
        )}

        {/* Section 1: Appearance Theme */}
        <section className="rounded-2xl bg-surface-card border border-border-subtle shadow-soft p-5 space-y-4">
          <h2 className="text-sm font-semibold text-ink-primary">外观主题</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleThemeSwitch("light")}
              className={`flex items-center gap-3 rounded-xl p-3.5 border text-left transition-all ${
                form.theme === "light"
                  ? "border-brand bg-brand-subtle"
                  : "border-border-subtle bg-surface-elevated hover:border-border-strong"
              }`}
            >
              <div className="w-9 h-9 rounded-lg bg-[#FAF9F6] border border-[#E8E4DC] flex items-center justify-center text-[#D97757] shrink-0">
                <Sun className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-ink-primary">暖白浅色</p>
                <p className="text-[11px] text-ink-muted">柔和纸感底色，清爽专注</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleThemeSwitch("dark")}
              className={`flex items-center gap-3 rounded-xl p-3.5 border text-left transition-all ${
                form.theme === "dark"
                  ? "border-brand bg-brand-subtle"
                  : "border-border-subtle bg-surface-elevated hover:border-border-strong"
              }`}
            >
              <div className="w-9 h-9 rounded-lg bg-[#262522] border border-[#3E3C37] flex items-center justify-center text-[#D97757] shrink-0">
                <Moon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-ink-primary">暖炭暗黑</p>
                <p className="text-[11px] text-ink-muted">低疲劳暖深灰，夜间护眼</p>
              </div>
            </button>
          </div>
        </section>

        {/* Section 2: DeepSeek API */}
        <section className="rounded-2xl bg-surface-card border border-border-subtle shadow-soft p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-primary">DeepSeek 接口配置</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              所有 AI 请求均由 Rust 后端直连{" "}
              <code className="px-1 py-0.5 rounded bg-surface-elevated text-[11px]">
                api.deepseek.com
              </code>
              ，密钥仅保存在本地数据库
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                DeepSeek API Key
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? "text" : "password"}
                    value={form.api_key}
                    onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                    placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full rounded-xl bg-surface-elevated border border-border-subtle pl-3.5 pr-10 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-brand transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    title={showKey ? "隐藏 API Key" : "显示明文"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink-primary transition-colors"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="shrink-0 min-w-[112px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border-subtle px-3.5 py-2 text-xs font-medium text-ink-primary disabled:opacity-50 transition-colors"
                >
                  {testing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
                  ) : (
                    <Wifi className="w-3.5 h-3.5 text-brand" />
                  )}
                  <span>测试连接</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                默认模型
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className="w-full max-w-xs rounded-xl bg-surface-elevated border border-border-subtle px-3.5 py-2 text-sm text-ink-primary focus:outline-none focus:border-brand transition-colors"
                >
                  {!models.some((m) => m.id === form.model) && form.model.trim() && (
                    <option value={form.model}>{form.model}</option>
                  )}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={fetchingModels}
                  className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border-subtle px-3.5 py-2 text-xs font-medium text-ink-primary disabled:opacity-50 transition-colors"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-brand ${fetchingModels ? "animate-spin" : ""}`}
                  />
                  <span>{fetchingModels ? "获取中..." : "获取模型"}</span>
                </button>
              </div>
              <p className="text-[11px] text-ink-muted mt-1.5">
                填写 API Key 后点击「获取模型」，即可实时拉取 DeepSeek 官网当前支持的全部模型列表
              </p>
            </div>

            {modelsFeedback && (
              <div
                className={`rounded-xl px-3.5 py-2.5 text-xs flex items-center gap-2 border ${
                  modelsFeedback.ok
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                    : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
                }`}
              >
                {modelsFeedback.ok ? (
                  <Check className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{modelsFeedback.message}</span>
              </div>
            )}

            {testResult && (
              <div
                className={`rounded-xl px-3.5 py-2.5 text-xs flex items-center gap-2 border ${
                  testResult.ok
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                    : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
                }`}
              >
                {testResult.ok ? (
                  <Check className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        </section>

        {/* Section 3: Default Report Preferences */}
        <section className="rounded-2xl bg-surface-card border border-border-subtle shadow-soft p-5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-ink-primary">周报默认偏好</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              设置生成周报时的默认岗位视角、汇报风格、输出格式与补充规范，在「生成周报」页仍可按周临时微调
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                默认岗位
              </label>
              <select
                value={normalizedRole}
                onChange={(e) => {
                  setForm({ ...form, default_role: e.target.value });
                  if (e.target.value !== "custom") {
                    setCustomRoleError(null);
                  }
                }}
                className="w-full rounded-xl bg-surface-elevated border border-border-subtle px-3 py-2 text-sm text-ink-primary focus:outline-none focus:border-brand transition-colors"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {selectedRoleOption && (
                <p className="text-[11px] text-ink-muted mt-1.5 leading-relaxed">
                  {selectedRoleOption.hint}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                默认汇报风格
              </label>
              <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-surface-elevated p-1 border border-border-subtle">
                {STYLE_OPTIONS.map((item) => {
                  const active = normalizedStyle === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      title={item.desc}
                      onClick={() => setForm({ ...form, default_style: item.value })}
                      className={`rounded-lg py-1.5 text-xs font-medium transition-all ${
                        active
                          ? "bg-surface-card text-brand shadow-sm border border-border-subtle"
                          : "text-ink-secondary hover:text-ink-primary"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              {selectedStyleOption && (
                <p className="text-[11px] text-ink-muted mt-1.5 leading-relaxed">
                  {selectedStyleOption.desc}
                </p>
              )}
            </div>
          </div>

          {normalizedRole === "custom" && (
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                自定义默认岗位名称 <span className="text-red-500">*</span>
              </label>
              <input
                ref={customRoleInputRef}
                type="text"
                value={form.custom_role}
                onChange={(e) => {
                  setForm({ ...form, custom_role: e.target.value });
                  if (e.target.value.trim()) {
                    setCustomRoleError(null);
                  }
                }}
                placeholder="例如：跨境电商运营、算法工程师、项目经理"
                className={`w-full max-w-sm rounded-xl bg-surface-elevated border px-3.5 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none transition-colors ${
                  customRoleError
                    ? "border-red-500 focus:border-red-500"
                    : "border-border-subtle focus:border-brand"
                }`}
              />
              {customRoleError && (
                <p className="text-[11px] text-red-600 dark:text-red-400 mt-1.5">
                  {customRoleError}
                </p>
              )}
            </div>
          )}

          {/* Output Format & Last Week Plan Closure */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border-subtle">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                默认输出格式
              </label>
              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-surface-elevated p-1 border border-border-subtle">
                {REPORT_FORMAT_OPTIONS.map((item) => {
                  const active = normalizedFormat === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      title={item.desc}
                      onClick={() => setForm({ ...form, report_format: item.value })}
                      className={`rounded-lg py-1.5 text-xs font-medium transition-all ${
                        active
                          ? "bg-surface-card text-brand shadow-sm border border-border-subtle"
                          : "text-ink-secondary hover:text-ink-primary"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              {selectedFormatOption && (
                <p className="text-[11px] text-ink-muted mt-1.5 leading-relaxed">
                  {selectedFormatOption.desc}
                </p>
              )}
            </div>

            <div className="rounded-xl bg-surface-elevated/70 border border-border-subtle px-3.5 py-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-brand-subtle text-brand flex items-center justify-center shrink-0 mt-0.5">
                  <GitBranch className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-ink-primary">参考上周计划闭环对照</p>
                  <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
                    自动读取上一周归档的「下周工作计划」作为只读对照，提升周报连贯感
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={form.include_last_week_plan}
                onClick={() =>
                  setForm({ ...form, include_last_week_plan: !form.include_last_week_plan })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors mt-0.5 ${
                  form.include_last_week_plan ? "bg-brand" : "bg-border-strong"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                    form.include_last_week_plan ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Custom Instructions */}
          <div className="pt-4 border-t border-border-subtle space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-ink-secondary">
                附加撰写规范 <span className="text-ink-muted font-normal">（可选）</span>
              </label>
              <div className="flex items-center gap-3 text-[11px]">
                {form.report_custom_instructions.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, report_custom_instructions: "" })}
                    className="text-ink-muted hover:text-ink-primary transition-colors"
                  >
                    清空
                  </button>
                )}
                <span
                  className={
                    instructionsLen > MAX_CUSTOM_INSTRUCTIONS_CHARS
                      ? "text-red-500 font-medium tabular-nums"
                      : "text-ink-muted tabular-nums"
                  }
                >
                  {instructionsLen} / {MAX_CUSTOM_INSTRUCTIONS_CHARS}
                </span>
              </div>
            </div>

            <textarea
              rows={3}
              value={form.report_custom_instructions}
              onChange={(e) => setForm({ ...form, report_custom_instructions: e.target.value })}
              placeholder="例如：控制总字数在 300 字以内；按【核心项目】【常规支持】【风险阻塞】分组；保留关键数据指标与进度百分比"
              className={`w-full resize-y rounded-xl bg-surface-elevated border px-3.5 py-2.5 text-sm leading-relaxed text-ink-primary placeholder:text-ink-muted focus:outline-none transition-colors ${
                instructionsLen > MAX_CUSTOM_INSTRUCTIONS_CHARS
                  ? "border-red-500 focus:border-red-500"
                  : "border-border-subtle focus:border-brand"
              }`}
            />

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] text-ink-muted mr-0.5">快捷填入：</span>
              {CUSTOM_INSTRUCTION_PRESETS.map((preset) => {
                const added = form.report_custom_instructions.includes(preset);
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={added}
                    onClick={() => handleAppendPresetInstruction(preset)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] border transition-colors ${
                      added
                        ? "bg-brand-subtle/60 border-brand/25 text-brand opacity-70 cursor-default"
                        : "bg-surface-elevated hover:bg-surface-hover border-border-subtle text-ink-secondary hover:text-ink-primary"
                    }`}
                  >
                    {added ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Plus className="w-3 h-3 text-ink-muted" />
                    )}
                    <span>{preset}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Section 4: Shortcut & Reminder */}
        <section className="rounded-2xl bg-surface-card border border-border-subtle shadow-soft p-5 space-y-5">
          <h2 className="text-sm font-semibold text-ink-primary">极速记录与定时提醒</h2>

          {/* Global Shortcut */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-border-subtle">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand-subtle text-brand flex items-center justify-center shrink-0 mt-0.5">
                <Keyboard className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-ink-primary">全局快速记录快捷键</p>
                <p className="text-xs text-ink-muted mt-0.5">
                  任意界面按下组合键呼出悬浮输入框（{platform === "macos" ? "macOS 默认 Option + W" : "Windows 默认 Alt + W"}）
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRecordingShortcut(true)}
                onBlur={() => setRecordingShortcut(false)}
                onKeyDown={(e) => {
                  if (!recordingShortcut) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    setRecordingShortcut(false);
                    return;
                  }
                  const combo = keyEventToTauriShortcut(e);
                  if (combo) {
                    setForm({ ...form, shortcut: combo });
                    setRecordingShortcut(false);
                  }
                }}
                className={`min-w-[138px] rounded-xl px-3.5 py-2 text-xs font-semibold border transition-all ${
                  recordingShortcut
                    ? "bg-brand-subtle border-brand text-brand animate-pulse"
                    : "bg-surface-elevated border-border-subtle text-ink-primary hover:border-brand/50"
                }`}
              >
                {recordingShortcut
                  ? "请按下组合键..."
                  : formatShortcutForDisplay(form.shortcut, platform)}
              </button>

              {form.shortcut !== "Alt+W" && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, shortcut: "Alt+W" })}
                  title="恢复默认快捷键"
                  className="p-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border-subtle text-ink-secondary transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Workday Reminder */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand-subtle text-brand flex items-center justify-center shrink-0 mt-0.5">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-ink-primary">工作日定时兜底提醒</p>
                <p className="text-xs text-ink-muted mt-0.5">
                  每周一至周五到点触发系统通知：“今天干了啥？花 10 秒记一笔吧”
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="time"
                value={form.reminder_time}
                disabled={!form.reminder_enabled}
                onChange={(e) => setForm({ ...form, reminder_time: e.target.value })}
                className="rounded-xl bg-surface-elevated border border-border-subtle px-3 py-1.5 text-xs font-medium text-ink-primary disabled:opacity-40 focus:outline-none focus:border-brand"
              />
              <button
                type="button"
                onClick={handleTestNotification}
                className="rounded-xl bg-surface-elevated hover:bg-surface-hover border border-border-subtle px-3 py-1.5 text-xs text-ink-secondary hover:text-ink-primary transition-colors"
              >
                测试通知
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={form.reminder_enabled}
                onClick={() => setForm({ ...form, reminder_enabled: !form.reminder_enabled })}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
                  form.reminder_enabled ? "bg-brand" : "bg-border-strong"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                    form.reminder_enabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Section 5: Mobile Remote Capture via WebDAV */}
        <WebDavSettingsCard
          form={form}
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        />

        {/* Sticky Unsaved Changes Bar */}
        {isDirty && (
          <div className="sticky bottom-3 z-20 rounded-2xl bg-surface-card/95 backdrop-blur border border-brand/35 shadow-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-ink-primary">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <span className="font-medium">有未保存的设置更改</span>
              <span className="text-ink-muted hidden sm:inline">
                保存后将立即应用到周报生成与后台服务
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={handleDiscardChanges}
                className="rounded-xl border border-border-subtle bg-surface-elevated hover:bg-surface-hover px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink-primary transition-colors disabled:opacity-50"
              >
                放弃更改
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-xs font-medium px-3.5 py-1.5 shadow-sm transition-colors"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>保存设置</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
