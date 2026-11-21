import { useEffect, useRef } from "react";
import { ArrowRight, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import type { AppUpdater } from "../hooks/useAppUpdater";
import type { AppSettings, ReleaseInfo } from "../types";
import { ReleaseNotes } from "./ReleaseNotes";

const primary = "inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-medium text-white shadow-sm hover:bg-brand-hover disabled:opacity-50";
const secondary = "inline-flex items-center justify-center gap-1.5 rounded-xl border border-border-subtle bg-surface-card px-3 py-2 text-xs font-medium text-ink-secondary hover:bg-surface-hover disabled:opacity-50";
const quiet = "rounded-lg px-2 py-1.5 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink-primary disabled:opacity-50";

const statusLabels = {
  idle: "尚未检查", checking: "检查中", "up-to-date": "已是最新", available: "发现新版本",
  downloading: "正在下载", ready: "等待重启", installing: "正在安装", error: "需要重试",
};

export function UpdateBadge({ status }: { status: AppUpdater["state"]["status"] }) {
  const color = status === "up-to-date" ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
    : status === "idle" ? "bg-surface-elevated text-ink-muted" : "bg-brand-subtle text-brand";
  return (
    <span role="status" className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />{statusLabels[status]}
    </span>
  );
}

function ReleaseDetails({ release, updater }: { release: ReleaseInfo; updater: AppUpdater }) {
  const date = release.published_at ? new Date(release.published_at) : null;
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm tabular-nums">
          <span className="text-ink-secondary">v{updater.info?.version}</span>
          <ArrowRight className="h-3.5 w-3.5 text-ink-muted" aria-label="更新到" />
          <strong className="text-brand">v{release.version}</strong>
        </div>
        <span className="text-[11px] text-ink-muted">
          {date && Number.isFinite(date.getTime()) ? `发布于 ${date.toLocaleDateString("zh-CN")}` : "暂未提供发布日期"}
        </span>
      </div>
      <ReleaseNotes body={release.body} openLink={updater.openLink} />
    </div>
  );
}

type Downloading = Extract<AppUpdater["state"], { status: "downloading" }>;

function DownloadProgress({ progress }: Pick<Downloading, "progress">) {
  const { received, total, bytesPerSecond, finished } = progress;
  const percent = total ? Math.min(100, Math.floor(received / total * 100)) : undefined;
  const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
  const speed = bytesPerSecond >= 1048576 ? mb(bytesPerSecond) : `${(bytesPerSecond / 1024).toFixed(0)} KB`;
  return (
    <div className="space-y-2 rounded-xl bg-surface-elevated p-3.5">
      <div className="flex justify-between text-xs font-medium">
        <span>{finished ? "正在校验更新包签名…" : "正在下载更新包"}</span>
        <span className="tabular-nums text-brand">{percent === undefined ? "下载中" : `${percent}%`}</span>
      </div>
      <div role="progressbar" aria-label="更新下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-border-subtle">
        <div className={`h-full rounded-full bg-brand transition-all duration-500 ${percent === undefined ? "w-1/3 animate-pulse" : ""}`}
          style={percent === undefined ? undefined : { width: `${percent}%` }} />
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-ink-secondary">
        <span>{mb(received)} / {total ? mb(total) : "总大小未知"}</span><span>{speed}/s</span>
      </div>
    </div>
  );
}

export function SoftwareUpdate({ updater, settings }: { updater: AppUpdater; settings: AppSettings | null }) {
  const { state, lastChecked, info } = updater;
  return (
    <section aria-labelledby="software-update" className="rounded-2xl border border-border-subtle bg-surface-card p-5 shadow-soft space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="software-update" className="text-sm font-semibold">软件更新</h2>
          <p className="mt-1 text-[11px] text-ink-muted">上次检查 · {lastChecked ? lastChecked.toLocaleString("zh-CN") : "尚未检查"}</p>
        </div>
        <button type="button" className={secondary} disabled={!updater.canCheck} onClick={() => void updater.checkForUpdates()}>
          <RefreshCw className={`h-3.5 w-3.5 ${state.status === "checking" ? "animate-spin" : ""}`} />
          {state.status === "checking" ? "正在检查" : state.status === "error" ? "重试" : "检查更新"}
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4">
        <span id="auto-update-label" className="text-xs font-medium text-ink-secondary">启动时自动检查更新</span>
        <button type="button" role="switch" aria-labelledby="auto-update-label" aria-checked={settings?.auto_check_update ?? false}
          disabled={!settings || updater.savingPreferences}
          onClick={() => void updater.savePreferences({ autoCheckUpdate: !settings?.auto_check_update })}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${settings?.auto_check_update ? "bg-brand" : "bg-border-strong"}`}>
          <span className={`mt-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${settings?.auto_check_update ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>

      {state.status === "up-to-date" && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-600/10 px-3.5 py-3 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />当前已是最新版本
        </p>
      )}
      {state.status === "available" && (
        <div className="space-y-3 rounded-xl border border-brand/40 p-4">
          <ReleaseDetails release={state.release} updater={updater} />
          {state.release.manualNotice && <p className="text-xs leading-relaxed text-ink-secondary">{state.release.manualNotice}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primary} onClick={() => void updater.startUpdate()}>
              <Download className="h-3.5 w-3.5" />
              {state.release.manualNotice
                ? state.release.download_url ? "下载安装包（当前平台）" : "前往 GitHub Releases 下载"
                : "立即下载并更新"}
            </button>
            {(!state.release.manualNotice || state.release.download_url) && (
              <button type="button" className={secondary} onClick={() => void updater.openLink(state.release.release_url)}>
                在 GitHub 查看<ExternalLink className="h-3 w-3" />
              </button>
            )}
            <button type="button" className={quiet} disabled={updater.savingPreferences || state.release.version === settings?.skipped_version}
              onClick={() => void updater.savePreferences({ skippedVersion: state.release.version })}>
              {state.release.version === settings?.skipped_version ? "已跳过此版本" : "跳过此版本"}
            </button>
          </div>
        </div>
      )}
      {state.status === "downloading" && <DownloadProgress progress={state.progress} />}
      {state.status === "ready" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-subtle p-3.5">
          <p className="text-xs text-ink-primary">{state.installed ? "新版已安装，请重新启动应用。" : `v${state.release.version} 已通过签名校验，可以安装。`}</p>
          <button type="button" className={primary} onClick={() => void updater.install()}>{state.installed ? "重新启动" : "立即重启并安装"}</button>
        </div>
      )}
      {state.status === "installing" && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-brand-subtle px-3.5 py-3 text-xs text-brand">
          <Loader2 className="h-4 w-4 animate-spin" />正在安装并重新启动 WeekLoom…
        </p>
      )}
      {state.status === "error" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-elevated p-3.5">
          <p className="text-xs leading-relaxed text-ink-secondary">{state.message}</p>
          {info && <button type="button" className={secondary} onClick={() => void updater.openLink(`${info.repo_url}/releases`)}>
            打开 GitHub Releases<ExternalLink className="h-3 w-3" />
          </button>}
        </div>
      )}
    </section>
  );
}

export function UpdateDialog({ updater, onDetails }: { updater: AppUpdater; onDetails: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const release = updater.release!;
  return (
    <dialog ref={dialogRef} aria-labelledby="update-dialog-title" onCancel={updater.dismissPrompt}
      className="m-auto w-[min(28rem,90vw)] max-h-[85vh] overflow-y-auto rounded-2xl border border-border-subtle bg-surface-card p-5 text-ink-primary shadow-float backdrop:bg-black/40 backdrop:backdrop-blur-[2px]">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-subtle text-brand"><Download className="h-5 w-5" /></span>
        <h2 id="update-dialog-title" className="flex-1 text-base font-semibold">发现新版本</h2>
        <button type="button" aria-label="关闭更新提醒" onClick={updater.dismissPrompt} className={quiet}><X className="h-4 w-4" /></button>
      </div>
      <ReleaseDetails updater={updater} release={release} />
      {release.manualNotice && <p className="mt-3 text-xs leading-relaxed text-ink-secondary">{release.manualNotice}</p>}
      {updater.actionError && <p role="alert" className="mt-2 text-xs text-brand">{updater.actionError}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={quiet} disabled={updater.savingPreferences}
          onClick={() => void updater.savePreferences({ skippedVersion: release.version })}>跳过此版本</button>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={quiet} onClick={updater.dismissPrompt} autoFocus>稍后提醒</button>
          <button type="button" className={secondary} onClick={onDetails}>查看详情</button>
          <button type="button" className={primary} onClick={() => {
            if (!release.manualNotice) onDetails();
            void updater.startUpdate();
          }}>立即更新</button>
        </div>
      </div>
    </dialog>
  );
}
