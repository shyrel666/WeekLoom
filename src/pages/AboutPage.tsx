import { useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { Bug, Check, Copy, ExternalLink, FolderOpen, Github, History, MessagesSquare, X } from "lucide-react";
import { BrandLogoMark } from "../components/BrandLogo";
import { SoftwareUpdate, UpdateBadge } from "../components/SoftwareUpdate";
import type { AppUpdater } from "../hooks/useAppUpdater";
import type { AppInfo, AppSettings } from "../types";
import { copyTextToClipboard } from "../utils/clipboard";

const platforms = { windows: "Windows", macos: "macOS", linux: "Linux" };
const card = "rounded-2xl border border-border-subtle bg-surface-card p-5 shadow-soft";
const chip = "inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-elevated px-2.5 py-1 text-[11px] text-ink-secondary";
const toolButton = "inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-elevated px-3 py-2 text-xs text-ink-secondary hover:bg-surface-hover disabled:opacity-50";

function systemLabel(info: AppInfo) {
  const arch = info.platform === "macos" && info.arch === "aarch64" ? "Apple Silicon"
    : info.arch === "x86_64" ? "x64" : info.arch;
  return `${platforms[info.platform]} · ${arch}`;
}

// Only these environment fields leave the About page via clipboard or issue URL.
function diagnostics(info: AppInfo) {
  return [`应用版本：${info.name} v${info.version}`, `操作系统：${platforms[info.platform]}`,
    `架构：${info.arch}`, `Tauri 版本：${info.tauri_version}`].join("\n");
}

function projectLinks(info: AppInfo) {
  const issue = new URL(`${info.repo_url}/issues/new`);
  issue.searchParams.set("body", `### 问题描述\n\n\n### 复现步骤\n\n1. \n\n### 运行环境\n\n${diagnostics(info)}`);
  return [
    { icon: Github, title: "GitHub 仓库", hint: "查看源码 · 点亮 Star", url: info.repo_url },
    { icon: History, title: "更新日志与发行版", hint: "历代版本与离线安装包", url: `${info.repo_url}/releases` },
    { icon: Bug, title: "反馈问题", hint: "提交 Bug 并附上运行环境", url: issue.href },
    { icon: MessagesSquare, title: "功能建议与讨论", hint: "参与讨论或提出新想法", url: `${info.repo_url}/issues` },
  ];
}

export function AboutPage({ updater, settings }: { updater: AppUpdater; settings: AppSettings | null }) {
  const { info } = updater;
  const [copied, setCopied] = useState<"version" | "diagnostics" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (kind: "version" | "diagnostics") => {
    if (!info) return;
    updater.setActionError("");
    try {
      await copyTextToClipboard(kind === "version" ? `v${info.version}` : diagnostics(info));
      setCopied(kind);
    } catch {
      updater.setActionError("无法写入剪贴板，请重试。");
    }
  };

  const openDirectory = async () => {
    if (!info) return;
    updater.setActionError("");
    try {
      await openPath(info.app_data_dir);
    } catch {
      updater.setActionError("无法打开数据目录，请检查目录是否存在及系统访问权限。");
    }
  };

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="max-w-3xl mx-auto space-y-5 pb-12">
        <h1 className="text-xl font-semibold tracking-tight">关于</h1>
        <section className={`${card} bg-gradient-to-br from-surface-card via-surface-card to-brand-subtle`}>
          <div className="flex items-start gap-4">
            <BrandLogoMark size={68} className="shrink-0 rounded-2xl drop-shadow-sm" />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-2xl font-semibold tracking-tight">{info?.name ?? "WeekLoom"}</h2>
                <UpdateBadge status={updater.state.status} />
              </div>
              <p className="mt-1 text-sm text-ink-secondary">织碎成篇 · 让周五的周报只需 10 秒</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <button type="button" title="复制当前版本号" disabled={!info} onClick={() => void copy("version")}
                  className={`${chip} hover:border-brand/40 hover:text-brand`}>
                  {copied === "version" ? <Check size={12} /> : <Copy size={12} />}
                  {copied === "version" ? "已复制" : info ? `v${info.version}` : "读取版本…"}
                </button>
                {info && <span className={chip}>{systemLabel(info)}</span>}
                <span className={chip}>Local-First</span>
              </div>
            </div>
          </div>
        </section>

        <SoftwareUpdate updater={updater} settings={settings} />

        <section className={card}>
          <h2 className="text-sm font-semibold">开源仓库与社区</h2>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {info && projectLinks(info).map(({ icon: Icon, title, hint, url }) => (
              <button key={title} type="button" onClick={() => void updater.openLink(url)}
                className="group flex min-w-0 items-center gap-3 rounded-xl border border-border-subtle bg-surface-elevated p-3 text-left transition-colors hover:border-brand/40 hover:bg-brand-subtle">
                <Icon className="h-[18px] w-[18px] shrink-0 text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-ink-primary">{title}</span>
                  <span className="mt-1 block text-[11px] text-ink-muted">{hint}</span>
                </span>
                <ExternalLink className="h-3 w-3 shrink-0 text-ink-muted group-hover:text-brand" />
              </button>
            ))}
          </div>
        </section>

        <section className={card}>
          <h2 className="text-sm font-semibold">运行环境与本地数据</h2>
          {info && (
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-xs">
              <dt className="text-ink-muted">应用版本</dt><dd>v{info.version}</dd>
              <dt className="text-ink-muted">Tauri 版本</dt><dd>{info.tauri_version}</dd>
              <dt className="text-ink-muted">系统与架构</dt><dd>{systemLabel(info)}</dd>
              <dt className="text-ink-muted">数据目录</dt><dd className="truncate select-text" title={info.app_data_dir}>{info.app_data_dir}</dd>
            </dl>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={toolButton} disabled={!info} onClick={() => void openDirectory()}>
              <FolderOpen size={14} />打开数据目录
            </button>
            <button type="button" className={toolButton} disabled={!info} onClick={() => void copy("diagnostics")}>
              {copied === "diagnostics" ? <Check size={14} /> : <Copy size={14} />}
              {copied === "diagnostics" ? "已复制" : "复制诊断信息"}
            </button>
          </div>
        </section>

        <section className={card}>
          <h2 className="text-sm font-semibold">技术栈与隐私</h2>
          <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
            WeekLoom 采用本地 SQLite 存储，零遥测。更新检查仅访问 GitHub 发行信息。
          </p>
          <ul aria-label="开源技术栈" className="mt-3 flex flex-wrap gap-1.5">
            {["Tauri v2", "Rust", "React", "TypeScript", "SQLite", "Tailwind CSS", "Lucide"].map((name) =>
              <li key={name} className={chip}>{name}</li>)}
          </ul>
        </section>
        {updater.actionError && (
          <div role="alert" className="sticky bottom-2 flex items-center justify-between gap-2 rounded-xl border border-brand/40 bg-surface-card px-3 py-2 text-xs text-ink-secondary shadow-soft">
            {updater.actionError}
            <button type="button" aria-label="关闭提示" onClick={() => updater.setActionError("")}><X size={14} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
