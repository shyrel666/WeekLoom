import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Smartphone,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { Platform, WebDavSyncResult, WebDavSyncStatus, WorkLog } from "../types";
import { useTodayISO } from "../hooks/useTodayISO";
import {
  formatChineseDateHeading,
  formatShortcutForDisplay,
  getWeekRange,
} from "../utils/date";

interface WorkLogsPageProps {
  platform: Platform;
  shortcut: string;
  webdavEnabled: boolean;
  onGoGenerate: () => void;
}

export const WorkLogsPage: React.FC<WorkLogsPageProps> = ({
  platform,
  shortcut,
  webdavEnabled,
  onGoGenerate,
}) => {
  const todayISO = useTodayISO();
  const [weekOffset, setWeekOffset] = useState(0);
  const week = useMemo(() => getWeekRange(weekOffset), [weekOffset, todayISO]);

  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [backfillDate, setBackfillDate] = useState<string>(todayISO);

  // WebDAV remote sync state
  const [webdavStatus, setWebdavStatus] = useState<WebDavSyncStatus>({
    syncing: false,
    last_sync_at: null,
    last_imported_count: 0,
    last_error: null,
  });
  const [manualSyncing, setManualSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  useEffect(() => {
    if (week.isCurrentWeek) {
      setBackfillDate(todayISO);
    } else {
      setBackfillDate(week.start);
    }
  }, [week.isCurrentWeek, week.start, todayISO]);

  useEffect(() => {
    if (!webdavEnabled) return;
    invoke<WebDavSyncStatus>("get_webdav_status")
      .then((status) => setWebdavStatus(status))
      .catch(() => {});

    const unlistenStatus = listen<WebDavSyncStatus>("webdav-status-updated", (event) => {
      setWebdavStatus(event.payload);
    });
    return () => {
      unlistenStatus.then((u) => u());
    };
  }, [webdavEnabled]);

  const handleManualSync = async () => {
    if (manualSyncing || webdavStatus.syncing) return;
    setManualSyncing(true);
    setSyncNotice(null);
    try {
      const res = await invoke<WebDavSyncResult>("sync_webdav_now");
      setSyncNotice({ ok: true, text: res.message });
      window.setTimeout(() => setSyncNotice(null), 3500);
    } catch (err) {
      setSyncNotice({
        ok: false,
        text: typeof err === "string" ? err : String(err),
      });
    } finally {
      setManualSyncing(false);
    }
  };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<WorkLog[]>("get_work_logs", {
        weekStart: week.start,
        weekEnd: week.end,
      });
      setLogs(data);
    } catch (err) {
      console.error("Failed to fetch work logs:", err);
    } finally {
      setLoading(false);
    }
  }, [week.start, week.end]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    const unlistenPromise = listen("work-logs-updated", () => {
      fetchLogs();
    });
    return () => {
      unlistenPromise.then((u) => u());
    };
  }, [fetchLogs]);

  const groupedLogs = useMemo(() => {
    const map = new Map<string, WorkLog[]>();
    for (const log of logs) {
      const list = map.get(log.log_date) ?? [];
      list.push(log);
      map.set(log.log_date, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [logs]);

  const handleAdd = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      await invoke("add_work_log", {
        content: trimmed,
        targetDate: backfillDate || null,
      });
      setInputValue("");
      await fetchLogs();
    } catch (err) {
      console.error("Failed to add work log:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEdit = (log: WorkLog) => {
    setEditingId(log.id);
    setEditingText(log.content);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const handleSaveEdit = async (id: number) => {
    const trimmed = editingText.trim();
    if (!trimmed) return;
    try {
      await invoke("update_work_log", { id, content: trimmed });
      setEditingId(null);
      setEditingText("");
      await fetchLogs();
    } catch (err) {
      console.error("Failed to update work log:", err);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await invoke("delete_work_log", { id });
      setLogs((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error("Failed to delete work log:", err);
    }
  };

  const shortcutDisplay = formatShortcutForDisplay(shortcut, platform);
  const isSyncingRemote = manualSyncing || webdavStatus.syncing;
  const isBackfillingOtherDay = backfillDate !== todayISO;

  return (
    <div className="h-full flex flex-col max-w-4xl mx-auto w-full px-7 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary tracking-tight">工作记录</h1>
          <p className="text-xs text-ink-muted mt-1">
            平时随手记下工作碎片，周五一键编织成专业周报
          </p>
        </div>

        {/* Week Navigation & Remote Sync */}
        <div className="flex items-center gap-2">
          {webdavEnabled && (
            <button
              type="button"
              onClick={handleManualSync}
              disabled={isSyncingRemote}
              title={
                webdavStatus.last_error
                  ? `上次同步异常：${webdavStatus.last_error}`
                  : webdavStatus.last_sync_at
                  ? `上次同步：${webdavStatus.last_sync_at}（点击立即拉取手机记录）`
                  : "从 WebDAV 收件箱拉取手机端记录"
              }
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium shadow-soft transition-colors disabled:opacity-60 ${
                webdavStatus.last_error
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
                  : "bg-surface-card border-border-subtle text-ink-secondary hover:text-ink-primary hover:bg-surface-hover"
              }`}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-brand ${isSyncingRemote ? "animate-spin" : ""}`}
              />
              <span>{isSyncingRemote ? "同步中..." : "同步手机"}</span>
            </button>
          )}
          {!week.isCurrentWeek && (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-brand bg-brand-subtle hover:bg-brand/20 transition-colors"
            >
              回到本周
            </button>
          )}
          <div className="inline-flex items-center rounded-xl bg-surface-card border border-border-subtle shadow-soft p-1">
            <button
              type="button"
              onClick={() => setWeekOffset((v) => v - 1)}
              title="上一周"
              className="p-1.5 rounded-lg text-ink-secondary hover:text-ink-primary hover:bg-surface-hover transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 flex items-center gap-2 text-xs font-medium text-ink-primary tabular-nums">
              <Calendar className="w-3.5 h-3.5 text-brand" />
              <span>{week.label}</span>
              {week.isCurrentWeek && (
                <span className="px-1.5 py-0.5 rounded-md bg-brand-subtle text-brand text-[10px] font-semibold">
                  本周
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setWeekOffset((v) => v + 1)}
              title="下一周"
              className="p-1.5 rounded-lg text-ink-secondary hover:text-ink-primary hover:bg-surface-hover transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Sync Toast Banner */}
      {syncNotice && (
        <div
          className={`mb-4 rounded-xl px-4 py-2.5 text-xs flex items-center justify-between gap-2 border ${
            syncNotice.ok
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
              : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {syncNotice.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{syncNotice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setSyncNotice(null)}
            className="p-0.5 opacity-70 hover:opacity-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Quick Add Input Card */}
      <div className="rounded-2xl bg-surface-card border border-border-subtle shadow-soft p-3.5 mb-5">
        <div className="flex items-center gap-2.5">
          <input
            type="text"
            value={inputValue}
            disabled={submitting}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder={
              !isBackfillingOtherDay
                ? "刚刚完成了什么？输入一句工作碎片，按 Enter 立即记录..."
                : `补录 ${backfillDate} 的工作记录，按 Enter 保存...`
            }
            className="flex-1 bg-transparent text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none px-1.5 py-1"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              type="date"
              value={backfillDate}
              min={week.start}
              max={week.end}
              title="选择记录所属日期（支持补录本周任意一天）"
              onChange={(e) => setBackfillDate(e.target.value)}
              className={`rounded-lg bg-surface-elevated border px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand transition-colors ${
                isBackfillingOtherDay
                  ? "border-brand/50 text-brand font-medium"
                  : "border-border-subtle text-ink-secondary"
              }`}
            />
            {week.isCurrentWeek && isBackfillingOtherDay && (
              <button
                type="button"
                onClick={() => setBackfillDate(todayISO)}
                title="切回今天"
                className="px-2 py-1.5 rounded-lg text-[11px] font-medium text-brand bg-brand-subtle hover:bg-brand/20 transition-colors"
              >
                今天
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!inputValue.trim() || submitting}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-40 text-white text-xs font-medium px-4 py-2 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>记一笔</span>
          </button>
        </div>

        <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-border-subtle text-[11px] text-ink-muted px-1">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-brand" />
            <span>
              随时按{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border-subtle text-ink-secondary font-medium">
                {shortcutDisplay}
              </kbd>{" "}
              呼出全局极速记录悬浮窗
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>共 {logs.length} 条记录</span>
            {logs.length > 0 && week.isCurrentWeek && (
              <button
                type="button"
                onClick={onGoGenerate}
                className="inline-flex items-center gap-1 text-brand hover:text-brand-hover font-medium transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>去生成周报</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Grouped Logs List */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-5 pb-4">
        {loading ? (
          <div className="py-16 text-center text-sm text-ink-muted">正在加载工作记录...</div>
        ) : groupedLogs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-strong bg-surface-card/50 py-16 px-6 text-center">
            <div className="w-11 h-11 rounded-2xl bg-brand-subtle text-brand flex items-center justify-center mx-auto mb-3">
              <Zap className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-ink-primary">
              {week.isCurrentWeek ? "本周还没有工作记录" : "该周暂无工作记录"}
            </p>
            <p className="text-xs text-ink-muted mt-1.5 max-w-sm mx-auto leading-relaxed">
              在上方输入框随手记一笔，或直接按下{" "}
              <span className="font-medium text-ink-secondary">{shortcutDisplay}</span>{" "}
              通过极速悬浮窗记录，周末即可一键生成职场周报。
            </p>
          </div>
        ) : (
          groupedLogs.map(([dateStr, items]) => {
            const { title, weekday, isToday } = formatChineseDateHeading(dateStr);
            return (
              <section key={dateStr} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs font-semibold text-ink-primary">{title}</span>
                  <span className="text-xs text-ink-muted">{weekday}</span>
                  {isToday && (
                    <span className="px-1.5 py-0.5 rounded-md bg-brand-subtle text-brand text-[10px] font-semibold">
                      今天
                    </span>
                  )}
                  <div className="flex-1 h-px bg-border-subtle ml-1" />
                  <span className="text-[11px] text-ink-muted">{items.length} 条</span>
                </div>

                <div className="rounded-2xl bg-surface-card border border-border-subtle shadow-soft divide-y divide-border-subtle overflow-hidden">
                  {items.map((log) => {
                    const isEditing = editingId === log.id;
                    return (
                      <div
                        key={log.id}
                        className="group flex items-start gap-3 px-4 py-3 hover:bg-surface-elevated/60 transition-colors"
                      >
                        <div className="shrink-0 mt-0.5 flex items-center gap-1.5 min-w-[44px]">
                          <span className="text-xs font-medium tabular-nums text-ink-muted">
                            {log.log_time}
                          </span>
                          {log.is_remote && (
                            <span
                              title="来自手机端 WebDAV 远程记录"
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-brand-subtle text-brand text-[10px] font-medium"
                            >
                              <Smartphone className="w-2.5 h-2.5" />
                              <span>手机</span>
                            </span>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="flex-1 flex items-center gap-2">
                            <input
                              type="text"
                              autoFocus
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleSaveEdit(log.id);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  handleCancelEdit();
                                }
                              }}
                              className="flex-1 rounded-lg bg-surface-bg border border-brand px-2.5 py-1 text-sm text-ink-primary focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(log.id)}
                              title="保存"
                              className="p-1.5 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              title="取消"
                              className="p-1.5 rounded-lg bg-surface-hover text-ink-secondary hover:text-ink-primary transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <p
                              onDoubleClick={() => handleStartEdit(log)}
                              title="双击可快速编辑"
                              className="flex-1 text-sm text-ink-primary leading-relaxed break-words whitespace-pre-wrap select-text"
                            >
                              {log.content}
                            </p>
                            <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(log)}
                                title="编辑"
                                className="p-1.5 rounded-lg text-ink-muted hover:text-ink-primary hover:bg-surface-hover transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(log.id)}
                                title="删除"
                                className="p-1.5 rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
};
