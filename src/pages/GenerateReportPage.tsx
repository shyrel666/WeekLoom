import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  BookmarkCheck,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Loader2,
  Save,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { CopyButton } from "../components/CopyButton";
import { useTodayISO } from "../hooks/useTodayISO";
import {
  DEFAULT_ROLE_PRESET,
  REPORT_FORMAT_OPTIONS,
  ROLE_OPTIONS,
  STYLE_OPTIONS,
  getRoleLabel,
  getStyleLabel,
  normalizeReportFormat,
  normalizeReportStyle,
  normalizeRolePreset,
  type AppSettings,
  type ReportFormatId,
  type ReportStyleId,
  type RolePresetId,
  type WeeklyReport,
  type WorkLog,
} from "../types";
import { getWeekRange, shiftISODateByDays } from "../utils/date";

interface GenerateReportPageProps {
  settings: AppSettings;
  onSettingsUpdated: (updated: AppSettings) => void;
  onGoSettings: () => void;
  onGoLogs: () => void;
}

export const GenerateReportPage: React.FC<GenerateReportPageProps> = ({
  settings,
  onSettingsUpdated,
  onGoSettings,
  onGoLogs,
}) => {
  const todayISO = useTodayISO();
  const [weekOffset, setWeekOffset] = useState(0);
  const week = useMemo(() => getWeekRange(weekOffset), [weekOffset, todayISO]);
  const activeWeekStartRef = useRef<string>(week.start);
  activeWeekStartRef.current = week.start;

  const [role, setRole] = useState<RolePresetId>(() => normalizeRolePreset(settings.default_role));
  const [customRole, setCustomRole] = useState(settings.custom_role || "");
  const [style, setStyle] = useState<ReportStyleId>(() =>
    normalizeReportStyle(settings.default_style)
  );
  const [reportFormat, setReportFormat] = useState<ReportFormatId>(() =>
    normalizeReportFormat(settings.report_format)
  );

  const [logCount, setLogCount] = useState<number>(0);
  const [hasPrevWeekPlan, setHasPrevWeekPlan] = useState<boolean>(false);
  const [summary, setSummary] = useState("");
  const [nextPlan, setNextPlan] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [archivedMeta, setArchivedMeta] = useState<{ role: string; style: string } | null>(null);

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultSavedNotice, setDefaultSavedNotice] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync defaults if user updates them in settings
  useEffect(() => {
    setRole(normalizeRolePreset(settings.default_role));
    setCustomRole(settings.custom_role || "");
    setStyle(normalizeReportStyle(settings.default_style));
    setReportFormat(normalizeReportFormat(settings.report_format));
  }, [
    settings.default_role,
    settings.custom_role,
    settings.default_style,
    settings.report_format,
  ]);

  useEffect(() => {
    let cancelled = false;
    const prevWeekStart = shiftISODateByDays(week.start, -7);

    (async () => {
      try {
        const [logs, existing, prevReport] = await Promise.all([
          invoke<WorkLog[]>("get_work_logs", {
            weekStart: week.start,
            weekEnd: week.end,
          }),
          invoke<WeeklyReport | null>("get_weekly_report", {
            weekStart: week.start,
          }),
          settings.include_last_week_plan
            ? invoke<WeeklyReport | null>("get_weekly_report", {
                weekStart: prevWeekStart,
              })
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setLogCount(logs.length);
        setHasPrevWeekPlan(Boolean(prevReport?.next_plan?.trim()));
        if (existing) {
          setSummary(existing.summary);
          setNextPlan(existing.next_plan);
          setLastUpdated(existing.updated_at);
          setArchivedMeta({ role: existing.role, style: existing.style });
        } else {
          setSummary("");
          setNextPlan("");
          setLastUpdated(null);
          setArchivedMeta(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load week context:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [week.start, week.end, settings.include_last_week_plan]);

  useEffect(() => {
    let cancelled = false;
    const unlistenLogs = listen("work-logs-updated", () => {
      invoke<WorkLog[]>("get_work_logs", {
        weekStart: week.start,
        weekEnd: week.end,
      })
        .then((logs) => {
          if (!cancelled) {
            setLogCount(logs.length);
          }
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      unlistenLogs.then((u) => u());
    };
  }, [week.start, week.end]);

  const resolvedRole = useMemo(() => {
    if (role === "custom") {
      return customRole.trim() || DEFAULT_ROLE_PRESET;
    }
    return role;
  }, [role, customRole]);

  const selectedRoleHint = useMemo(() => {
    return ROLE_OPTIONS.find((item) => item.value === role)?.hint ?? "";
  }, [role]);

  const isDifferentFromDefault = useMemo(() => {
    const defaultRole = normalizeRolePreset(settings.default_role);
    const defaultStyle = normalizeReportStyle(settings.default_style);
    const defaultFormat = normalizeReportFormat(settings.report_format);
    if (role !== defaultRole) return true;
    if (role === "custom" && customRole.trim() !== settings.custom_role.trim()) return true;
    if (style !== defaultStyle) return true;
    if (reportFormat !== defaultFormat) return true;
    return false;
  }, [role, customRole, style, reportFormat, settings]);

  const hasCustomInstructions = settings.report_custom_instructions.trim().length > 0;

  const handleSetAsDefault = async () => {
    if (savingDefault) return;
    setErrorMsg(null);

    if (role === "custom" && !customRole.trim()) {
      setErrorMsg("请先填写自定义岗位名称，再设为默认偏好");
      return;
    }

    setSavingDefault(true);
    try {
      const latest = await invoke<AppSettings>("get_settings");
      const updated: AppSettings = {
        ...latest,
        default_role: role,
        custom_role: role === "custom" ? customRole.trim() : latest.custom_role,
        default_style: style,
        report_format: reportFormat,
      };
      await invoke("save_settings", { settings: updated });
      const persisted = await invoke<AppSettings>("get_settings");
      onSettingsUpdated(persisted);
      setDefaultSavedNotice(true);
      window.setTimeout(() => setDefaultSavedNotice(false), 2000);
    } catch (err) {
      setErrorMsg(typeof err === "string" ? err : String(err));
    } finally {
      setSavingDefault(false);
    }
  };

  const handleGenerate = async () => {
    if (generating) return;
    setErrorMsg(null);

    if (role === "custom" && !customRole.trim()) {
      setErrorMsg("请先填写自定义岗位名称，或选择内置岗位预设");
      return;
    }

    const targetWeekStart = week.start;
    const targetWeekEnd = week.end;
    setGenerating(true);
    try {
      const report = await invoke<WeeklyReport>("generate_weekly_report", {
        weekStart: targetWeekStart,
        weekEnd: targetWeekEnd,
        role: resolvedRole,
        style,
        format: reportFormat,
        customInstructions: settings.report_custom_instructions,
        includeLastWeekPlan: settings.include_last_week_plan,
      });
      if (activeWeekStartRef.current === targetWeekStart) {
        setSummary(report.summary);
        setNextPlan(report.next_plan);
        setLastUpdated(report.updated_at);
        setArchivedMeta({ role: report.role, style: report.style });
      }
    } catch (err) {
      if (activeWeekStartRef.current === targetWeekStart) {
        setErrorMsg(typeof err === "string" ? err : String(err));
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveManual = async () => {
    if (saving || (!summary.trim() && !nextPlan.trim())) return;
    const targetWeekStart = week.start;
    const targetWeekEnd = week.end;
    // Preserve original archived role/style metadata when editing an existing week's report
    const saveRole = archivedMeta ? archivedMeta.role : resolvedRole;
    const saveStyle = archivedMeta ? archivedMeta.style : style;

    setSaving(true);
    setErrorMsg(null);
    try {
      const saved = await invoke<WeeklyReport>("save_weekly_report", {
        weekStart: targetWeekStart,
        weekEnd: targetWeekEnd,
        role: saveRole,
        style: saveStyle,
        summary,
        nextPlan,
      });
      if (activeWeekStartRef.current === targetWeekStart) {
        setLastUpdated(saved.updated_at);
        setArchivedMeta({ role: saved.role, style: saved.style });
        setSavedNotice(true);
        window.setTimeout(() => setSavedNotice(false), 1800);
      }
    } catch (err) {
      if (activeWeekStartRef.current === targetWeekStart) {
        setErrorMsg(typeof err === "string" ? err : String(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const isMissingKeyError = errorMsg?.includes("API Key");

  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto w-full px-7 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary tracking-tight">生成周报</h1>
          <p className="text-xs text-ink-muted mt-1">
            {reportFormat === "markdown"
              ? "结合岗位视角与汇报风格，调用 DeepSeek 自动提炼为 Markdown，适合粘贴至飞书 / Notion / 文档"
              : "结合岗位视角与汇报风格，调用 DeepSeek 自动提炼并分栏一键复制到企业微信 / 钉钉「汇报」"}
          </p>
        </div>

        {/* Week Selector */}
        <div className="flex items-center gap-2">
          {!week.isCurrentWeek && (
            <button
              type="button"
              disabled={generating}
              onClick={() => setWeekOffset(0)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-brand bg-brand-subtle hover:bg-brand/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              回到本周
            </button>
          )}
          <div className="inline-flex items-center rounded-xl bg-surface-card border border-border-subtle shadow-soft p-1">
            <button
              type="button"
              disabled={generating}
              onClick={() => setWeekOffset((v) => v - 1)}
              className="p-1.5 rounded-lg text-ink-secondary hover:text-ink-primary hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="上一周"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 flex items-center gap-2 text-xs font-medium text-ink-primary tabular-nums">
              <Calendar className="w-3.5 h-3.5 text-brand" />
              <span>{week.label}</span>
              <span className="px-1.5 py-0.5 rounded-md bg-surface-elevated text-ink-secondary text-[10px]">
                {logCount} 条记录
              </span>
            </div>
            <button
              type="button"
              disabled={generating}
              onClick={() => setWeekOffset((v) => v + 1)}
              className="p-1.5 rounded-lg text-ink-secondary hover:text-ink-primary hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="下一周"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Generation Controls Card */}
      <div className="rounded-2xl bg-surface-card border border-border-subtle shadow-soft p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          {/* Role selector */}
          <div className={role === "custom" ? "md:col-span-3" : "md:col-span-4"}>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              岗位视角
            </label>
            <select
              value={role}
              onChange={(e) => setRole(normalizeRolePreset(e.target.value))}
              className="w-full rounded-xl bg-surface-elevated border border-border-subtle px-3 py-2 text-sm text-ink-primary focus:outline-none focus:border-brand transition-colors"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom role input */}
          {role === "custom" && (
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                自定义岗位名称
              </label>
              <input
                type="text"
                value={customRole}
                onChange={(e) => setCustomRole(e.target.value)}
                placeholder="如：数据分析师、项目经理"
                className="w-full rounded-xl bg-surface-elevated border border-border-subtle px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-brand transition-colors"
              />
            </div>
          )}

          {/* Style pills */}
          <div className={role === "custom" ? "md:col-span-3" : "md:col-span-5"}>
            <label className="block text-xs font-medium text-ink-secondary mb-1.5">
              汇报风格
            </label>
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-surface-elevated p-1 border border-border-subtle">
              {STYLE_OPTIONS.map((item) => {
                const active = style === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setStyle(item.value)}
                    title={item.desc}
                    className={`rounded-lg py-1.5 px-2 text-xs font-medium transition-all ${
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
          </div>

          {/* Generate CTA */}
          <div className="md:col-span-3 flex justify-end">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-70 text-white text-sm font-medium px-4 py-2.5 shadow-sm transition-all"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>正在编织周报...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>一键生成本周周报</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Secondary Preference Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 mt-3 pt-2.5 border-t border-border-subtle text-[11px] text-ink-muted">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span>{selectedRoleHint}</span>

            {settings.include_last_week_plan && hasPrevWeekPlan && (
              <span
                title="生成时会自动参考上周归档周报中的「下周工作计划」进行闭环对照"
                className="inline-flex items-center gap-1 rounded-md bg-brand-subtle/80 text-brand px-1.5 py-0.5 font-medium"
              >
                <GitBranch className="w-3 h-3" />
                <span>已关联上周计划</span>
              </span>
            )}

            {hasCustomInstructions && (
              <button
                type="button"
                onClick={onGoSettings}
                title={`当前生效附加规范：${settings.report_custom_instructions}`}
                className="inline-flex items-center gap-1 rounded-md bg-surface-elevated hover:bg-surface-hover border border-border-subtle text-ink-secondary hover:text-ink-primary px-1.5 py-0.5 transition-colors"
              >
                <SlidersHorizontal className="w-3 h-3 text-brand" />
                <span>已启用附加规范</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Compact Output Format Switch */}
            <div className="inline-flex items-center rounded-lg bg-surface-elevated p-0.5 border border-border-subtle">
              {REPORT_FORMAT_OPTIONS.map((item) => {
                const active = reportFormat === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    title={item.desc}
                    onClick={() => setReportFormat(item.value)}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
                      active
                        ? "bg-surface-card text-brand shadow-sm"
                        : "text-ink-secondary hover:text-ink-primary"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {/* One-click "Set as Default" when preferences diverge */}
            {(isDifferentFromDefault || defaultSavedNotice) && (
              <button
                type="button"
                disabled={savingDefault || defaultSavedNotice}
                onClick={() => void handleSetAsDefault()}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium border transition-colors ${
                  defaultSavedNotice
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                    : "bg-brand-subtle/70 hover:bg-brand-subtle border-brand/25 text-brand"
                }`}
              >
                {savingDefault ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : defaultSavedNotice ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <BookmarkCheck className="w-3 h-3" />
                )}
                <span>{defaultSavedNotice ? "已设为默认" : "设为默认"}</span>
              </button>
            )}

            {logCount === 0 && (
              <button
                type="button"
                onClick={onGoLogs}
                className="text-brand hover:underline font-medium"
              >
                本周暂无记录，点击前往补充 →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {errorMsg && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-center justify-between gap-3 text-xs text-red-700 dark:text-red-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          {isMissingKeyError && (
            <button
              type="button"
              onClick={onGoSettings}
              className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 px-2.5 py-1 font-medium transition-colors"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              <span>去配置 Key</span>
            </button>
          )}
        </div>
      )}

      {/* Dual-Pane Report Workspace */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Summary Pane */}
        <div className="flex flex-col rounded-2xl bg-surface-card border border-border-subtle shadow-soft overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-elevated/50">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand" />
              <h2 className="text-sm font-semibold text-ink-primary">本周工作总结</h2>
            </div>
            <CopyButton text={summary} />
          </div>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={
              generating
                ? "DeepSeek 正在整理本周工作碎片、归类合并同类项..."
                : "点击上方「一键生成本周周报」，或直接在此编辑本周工作总结..."
            }
            className="flex-1 w-full resize-none bg-transparent p-4 text-sm leading-7 text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
        </div>

        {/* Next Week Plan Pane */}
        <div className="flex flex-col rounded-2xl bg-surface-card border border-border-subtle shadow-soft overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-elevated/50">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-ink-muted" />
              <h2 className="text-sm font-semibold text-ink-primary">下周工作计划</h2>
            </div>
            <CopyButton text={nextPlan} />
          </div>
          <textarea
            value={nextPlan}
            onChange={(e) => setNextPlan(e.target.value)}
            placeholder={
              generating
                ? "正在从本周记录中提取待跟进事项并拟定下周计划..."
                : "AI 将自动识别本周未完待办与重点推进方向，生成下周工作计划..."
            }
            className="flex-1 w-full resize-none bg-transparent p-4 text-sm leading-7 text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
        </div>
      </div>

      {/* Footer Save Bar */}
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-ink-muted">
        <div className="truncate">
          {lastUpdated ? (
            <span>
              已自动归档至历史周报
              {archivedMeta
                ? ` · ${getRoleLabel(archivedMeta.role)} / ${getStyleLabel(archivedMeta.style)}`
                : ""}
              {" · "}最近保存：{lastUpdated}
            </span>
          ) : (
            <span>生成后将按周次自动存入本地历史周报</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSaveManual}
          disabled={saving || (!summary.trim() && !nextPlan.trim())}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-surface-card hover:bg-surface-hover border border-border-subtle px-3.5 py-2 text-xs font-medium text-ink-primary disabled:opacity-40 transition-colors"
        >
          {savedNotice ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-700 dark:text-emerald-400">修改已保存</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? "保存中..." : "保存修改"}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
