import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Archive, Calendar, Check, Save, Trash2 } from "lucide-react";
import { CopyButton } from "../components/CopyButton";
import { getRoleLabel, getStyleLabel, type WeeklyReport } from "../types";

export const HistoryReportsPage: React.FC = () => {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [editSummary, setEditSummary] = useState("");
  const [editNextPlan, setEditNextPlan] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const selectedReport = reports.find((r) => r.id === selectedId) ?? null;

  const fetchReports = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const list = await invoke<WeeklyReport[]>("list_weekly_reports");
      setReports(list);
      setSelectedId((prev) => {
        if (prev && list.some((r) => r.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      console.error("Failed to list weekly reports:", err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchReports(false);
  }, [fetchReports]);

  useEffect(() => {
    const unlistenPromise = listen("reports-updated", () => {
      fetchReports(true);
    });
    return () => {
      unlistenPromise.then((u) => u());
    };
  }, [fetchReports]);

  useEffect(() => {
    if (selectedReport) {
      setEditSummary(selectedReport.summary);
      setEditNextPlan(selectedReport.next_plan);
      setConfirmDeleteId(null);
    } else {
      setEditSummary("");
      setEditNextPlan("");
    }
  }, [selectedReport?.id, selectedReport?.updated_at]);

  const handleSave = async () => {
    if (!selectedReport || saving) return;
    setSaving(true);
    try {
      const updated = await invoke<WeeklyReport>("save_weekly_report", {
        weekStart: selectedReport.week_start,
        weekEnd: selectedReport.week_end,
        role: selectedReport.role,
        style: selectedReport.style,
        summary: editSummary,
        nextPlan: editNextPlan,
      });
      setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 1800);
    } catch (err) {
      console.error("Failed to update weekly report:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await invoke("delete_weekly_report", { id });
      setConfirmDeleteId(null);
      const next = reports.filter((r) => r.id !== id);
      setReports(next);
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? null);
      }
    } catch (err) {
      console.error("Failed to delete weekly report:", err);
    }
  };

  return (
    <div className="h-full flex flex-col px-7 py-6">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-ink-primary tracking-tight">历史周报</h1>
        <p className="text-xs text-ink-muted mt-1">
          所有已生成与手动保存的周报均安全留底在本地 SQLite 数据库中
        </p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-ink-muted">
          正在加载历史周报...
        </div>
      ) : reports.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="rounded-2xl border border-dashed border-border-strong bg-surface-card/50 py-16 px-10 text-center max-w-md">
            <div className="w-11 h-11 rounded-2xl bg-brand-subtle text-brand flex items-center justify-center mx-auto mb-3">
              <Archive className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-ink-primary">暂无历史周报留底</p>
            <p className="text-xs text-ink-muted mt-1.5 leading-relaxed">
              在「生成周报」页面生成或保存修改后，系统会按周次自动归档到这里，方便随时复盘与复用。
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex gap-5">
          {/* Left Week List */}
          <aside className="w-64 shrink-0 flex flex-col rounded-2xl bg-surface-card border border-border-subtle shadow-soft overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle bg-surface-elevated/50 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-secondary">往期周次</span>
              <span className="text-[11px] text-ink-muted">{reports.length} 份</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {reports.map((item) => {
                const active = item.id === selectedId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left rounded-xl px-3 py-2.5 transition-all border ${
                      active
                        ? "bg-brand-subtle border-brand/35 text-ink-primary"
                        : "bg-transparent border-transparent hover:bg-surface-hover text-ink-secondary"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold tabular-nums">
                      <Calendar
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? "text-brand" : "text-ink-muted"
                        }`}
                      />
                      <span className="truncate">
                        {item.week_start} ~ {item.week_end}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-muted">
                      <span className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border-subtle truncate max-w-[110px]">
                        {getRoleLabel(item.role)}
                      </span>
                      <span className="truncate">{getStyleLabel(item.style)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Right Detail Pane */}
          {selectedReport && (
            <div className="flex-1 min-w-0 flex flex-col gap-4">
              {/* Top Action Bar */}
              <div className="rounded-2xl bg-surface-card border border-border-subtle shadow-soft px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink-primary tabular-nums">
                      {selectedReport.week_start} ~ {selectedReport.week_end}
                    </h2>
                    <span className="px-2 py-0.5 rounded-md bg-brand-subtle text-brand text-[11px] font-medium">
                      {getRoleLabel(selectedReport.role)}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-surface-elevated text-ink-secondary text-[11px]">
                      {getStyleLabel(selectedReport.style)}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-muted mt-1">
                    最后更新：{selectedReport.updated_at}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand hover:bg-brand-hover text-white px-3.5 py-1.5 text-xs font-medium transition-colors"
                  >
                    {savedNotice ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>已保存</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>{saving ? "保存中..." : "保存修改"}</span>
                      </>
                    )}
                  </button>

                  {confirmDeleteId === selectedReport.id ? (
                    <div className="inline-flex items-center gap-1.5 rounded-xl bg-red-500/10 border border-red-500/30 px-2.5 py-1">
                      <span className="text-[11px] text-red-600 dark:text-red-400">确认删除？</span>
                      <button
                        type="button"
                        onClick={() => handleDelete(selectedReport.id)}
                        className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:underline"
                      >
                        确定
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[11px] text-ink-muted hover:text-ink-primary ml-1"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(selectedReport.id)}
                      className="inline-flex items-center gap-1 rounded-xl border border-border-subtle bg-surface-elevated hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-500 px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>删除</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Dual Editable Content */}
              <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="flex flex-col rounded-2xl bg-surface-card border border-border-subtle shadow-soft overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-elevated/50">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-brand" />
                      <h3 className="text-sm font-semibold text-ink-primary">本周工作总结</h3>
                    </div>
                    <CopyButton text={editSummary} />
                  </div>
                  <textarea
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                    className="flex-1 w-full resize-none bg-transparent p-4 text-sm leading-7 text-ink-primary focus:outline-none"
                  />
                </div>

                <div className="flex flex-col rounded-2xl bg-surface-card border border-border-subtle shadow-soft overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-elevated/50">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-ink-muted" />
                      <h3 className="text-sm font-semibold text-ink-primary">下周工作计划</h3>
                    </div>
                    <CopyButton text={editNextPlan} />
                  </div>
                  <textarea
                    value={editNextPlan}
                    onChange={(e) => setEditNextPlan(e.target.value)}
                    className="flex-1 w-full resize-none bg-transparent p-4 text-sm leading-7 text-ink-primary focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
