import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  Archive,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Info,
  Loader2,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Zap,
} from "lucide-react";
import { BrandLogo } from "./components/BrandLogo";
import { QuickCapture } from "./components/QuickCapture";
import { UpdateDialog } from "./components/SoftwareUpdate";
import { useAppUpdater } from "./hooks/useAppUpdater";
import { AboutPage } from "./pages/AboutPage";
import { GenerateReportPage } from "./pages/GenerateReportPage";
import { HistoryReportsPage } from "./pages/HistoryReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkLogsPage } from "./pages/WorkLogsPage";
import { DEFAULT_SETTINGS, type AppSettings, type NavTab } from "./types";
import { formatShortcutForDisplay } from "./utils/date";

const SIDEBAR_COLLAPSED_KEY = "weekloom_sidebar_collapsed";

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "logs", label: "工作记录", icon: ClipboardList },
  { id: "generate", label: "生成周报", icon: Sparkles },
  { id: "history", label: "历史周报", icon: Archive },
  { id: "settings", label: "设置", icon: Settings },
];

const MainShell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>("logs");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [loadedSettings, setSettings] = useState<AppSettings | null>(null);
  const settings = loadedSettings ?? DEFAULT_SETTINGS;
  const updater = useAppUpdater(loadedSettings);
  const platform = updater.info?.platform ?? "windows";

  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<NavTab | null>(null);
  const [savingBeforeLeave, setSavingBeforeLeave] = useState(false);
  const settingsSaveRef = useRef<(() => Promise<boolean>) | null>(null);

  useEffect(() => {
    invoke<AppSettings>("get_settings")
      .then((loaded) => {
        setSettings(loaded);
        document.documentElement.classList.toggle("dark", loaded.theme === "dark");
      })
      .catch((err) => {
        console.error("Failed to load settings:", err);
      });

    const unlistenPromise = listen<AppSettings>("settings-updated", (event) => {
      setSettings(event.payload);
      document.documentElement.classList.toggle("dark", event.payload.theme === "dark");
    });

    return () => {
      unlistenPromise.then((u) => u());
    };
  }, []);

  const handleSelectTab = useCallback(
    (target: NavTab) => {
      if (target === activeTab) return;
      if (activeTab === "settings" && settingsDirty) {
        setPendingTab(target);
        return;
      }
      setActiveTab(target);
    },
    [activeTab, settingsDirty]
  );

  const trayUpdateRequest = useRef<() => void>(() => {});
  trayUpdateRequest.current = () => {
    handleSelectTab("about");
    void updater.checkForUpdates();
  };
  useEffect(() => {
    const unlisten = listen("check-for-updates", () => trayUpdateRequest.current());
    return () => { void unlisten.then((stop) => stop()); };
  }, []);

  // A pending form or theme save can finish after an update preference changed.
  const applyGeneralSettings = (updated: AppSettings) => {
    setSettings((current) => current ? {
      ...updated, auto_check_update: current.auto_check_update, skipped_version: current.skipped_version,
    } : updated);
  };

  const handleDiscardAndLeave = () => {
    if (!pendingTab) return;
    const target = pendingTab;
    setPendingTab(null);
    setSettingsDirty(false);
    setActiveTab(target);
  };

  const handleSaveAndLeave = async () => {
    if (!pendingTab || savingBeforeLeave) return;
    const target = pendingTab;
    setSavingBeforeLeave(true);
    try {
      const ok = (await settingsSaveRef.current?.()) ?? false;
      setPendingTab(null);
      if (ok) {
        setSettingsDirty(false);
        setActiveTab(target);
      }
    } finally {
      setSavingBeforeLeave(false);
    }
  };

  const handleToggleTheme = async () => {
    const previousTheme = settings.theme;
    const nextTheme: "light" | "dark" = previousTheme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    try {
      const latest = await invoke<AppSettings>("get_settings");
      const next: AppSettings = { ...latest, theme: nextTheme };
      await invoke("save_settings", { settings: next });
      applyGeneralSettings(next);
    } catch (err) {
      document.documentElement.classList.toggle("dark", previousTheme === "dark");
      console.error("Failed to save theme toggle:", err);
    }
  };

  const handleOpenQuickCapture = () => {
    invoke("open_quick_capture_window").catch(() => {});
  };

  const toggleSidebar = () => {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // The layout still applies to this window if storage is unavailable.
    }
  };

  const shortcutDisplay = formatShortcutForDisplay(settings.shortcut, platform);
  const quickCaptureLabel = `快速记录（${shortcutDisplay}）`;
  const sidebarToggleLabel = sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏";
  const versionLabel = updater.info ? ` · v${updater.info.version}` : "";
  const aboutLabel = `关于 WeekLoom${versionLabel}${updater.hasUpdate ? "（发现新版本）" : ""}`;
  const themeLabel = settings.theme === "dark" ? "切换浅色模式" : "切换暖色暗黑";

  return (
    <div className="h-screen w-screen flex bg-surface-bg text-ink-primary overflow-hidden">
      <aside
        id="main-sidebar"
        className={`relative shrink-0 bg-surface-sidebar border-r border-border-subtle flex flex-col justify-between py-4 motion-safe:transition-[width] motion-safe:duration-200 ${
          sidebarCollapsed ? "w-16 px-2" : "w-56 px-4"
        }`}
      >
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarToggleLabel}
          title={sidebarToggleLabel}
          aria-expanded={!sidebarCollapsed}
          aria-controls="main-sidebar"
          className="absolute -right-3.5 top-6 z-10 grid h-7 w-7 place-items-center rounded-full border border-border-subtle bg-surface-card text-ink-secondary shadow-soft hover:border-brand/40 hover:text-brand"
        >
          {sidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
        <div>
          {/* Brand Header */}
          <div className={`flex h-9 items-center overflow-hidden ${sidebarCollapsed ? "justify-center" : "px-2"}`}>
            <BrandLogo compact={sidebarCollapsed} />
          </div>

          {/* Navigation Menu */}
          <nav aria-label="主导航" className="mt-6 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              const dirty = item.id === "settings" && settingsDirty;
              const label = dirty ? `${item.label}（有未保存的更改）` : item.label;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTab(item.id)}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  title={sidebarCollapsed ? label : undefined}
                  className={`relative w-full h-10 flex items-center rounded-xl text-sm font-medium transition-colors ${
                    sidebarCollapsed ? "justify-center" : "gap-3 px-3"
                  } ${
                    active
                      ? "bg-brand-subtle text-brand"
                      : "text-ink-secondary hover:text-ink-primary hover:bg-surface-hover"
                  }`}
                >
                  <Icon aria-hidden="true" className={`w-[18px] h-[18px] shrink-0 ${active ? "text-brand" : "text-ink-muted"}`} />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  {dirty && (
                    <span
                      title="有未保存的设置更改"
                      className={`w-2 h-2 rounded-full bg-amber-500 shrink-0 ${sidebarCollapsed ? "absolute right-1.5 top-1.5" : "ml-auto"}`}
                    />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="space-y-2.5 pt-4 border-t border-border-subtle">
          <button
            type="button"
            onClick={handleOpenQuickCapture}
            aria-label={quickCaptureLabel}
            title={sidebarCollapsed ? quickCaptureLabel : undefined}
            className={`w-full h-9 flex items-center overflow-hidden rounded-xl bg-surface-card hover:bg-surface-hover border border-border-subtle text-xs transition-colors shadow-soft ${
              sidebarCollapsed ? "justify-center" : "gap-1.5 px-3"
            }`}
          >
            <Zap aria-hidden="true" className={`shrink-0 text-brand ${sidebarCollapsed ? "w-[18px] h-[18px]" : "w-3.5 h-3.5"}`} />
            {!sidebarCollapsed && (
              <>
                <span className="shrink-0 font-medium text-ink-primary">快速记录</span>
                <kbd className="ml-auto truncate px-1.5 py-0.5 rounded bg-surface-elevated border border-border-subtle text-[10px] font-medium text-ink-muted">
                  {shortcutDisplay}
                </kbd>
              </>
            )}
          </button>

          <div className={`flex text-[11px] text-ink-muted ${sidebarCollapsed ? "flex-col gap-1" : "items-center justify-between px-1.5"}`}>
            <button type="button" onClick={() => handleSelectTab("about")} title={sidebarCollapsed ? aboutLabel : "关于 WeekLoom"}
              aria-label={aboutLabel}
              aria-current={activeTab === "about" ? "page" : undefined}
              className={`relative inline-flex min-w-0 items-center rounded-lg hover:text-brand ${
                sidebarCollapsed ? "h-9 justify-center hover:bg-surface-hover" : "gap-1.5 py-1"
              } ${activeTab === "about" ? "text-brand" : ""}`}>
              <Info className={`shrink-0 ${sidebarCollapsed ? "h-[18px] w-[18px]" : "h-3.5 w-3.5"}`} aria-hidden="true" />
              {!sidebarCollapsed && <span className="truncate">关于{versionLabel}</span>}
              {updater.hasUpdate && <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full bg-brand ${sidebarCollapsed ? "absolute top-1.5 right-2" : ""}`} />}
            </button>
            <button
              type="button"
              onClick={handleToggleTheme}
              title={themeLabel}
              aria-label={themeLabel}
              className={`grid place-items-center rounded-lg hover:bg-surface-hover text-ink-secondary hover:text-ink-primary transition-colors ${sidebarCollapsed ? "h-9" : "p-1.5"}`}
            >
              {settings.theme === "dark" ? (
                <Sun className="w-3.5 h-3.5" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* Right Main Workspace */}
      <main className="flex-1 min-w-0 h-full overflow-hidden">
        {activeTab === "logs" && (
          <WorkLogsPage
            platform={platform}
            shortcut={settings.shortcut}
            webdavEnabled={settings.webdav_enabled}
            onGoGenerate={() => handleSelectTab("generate")}
          />
        )}
        {activeTab === "generate" && (
          <GenerateReportPage
            settings={settings}
            onSettingsUpdated={applyGeneralSettings}
            onGoSettings={() => handleSelectTab("settings")}
            onGoLogs={() => handleSelectTab("logs")}
          />
        )}
        {activeTab === "history" && <HistoryReportsPage />}
        {activeTab === "settings" && (
          <SettingsPage
            settings={settings}
            platform={platform}
            onSettingsSaved={applyGeneralSettings}
            onDirtyChange={setSettingsDirty}
            saveHandlerRef={settingsSaveRef}
          />
        )}
        {activeTab === "about" && <AboutPage updater={updater} settings={loadedSettings} />}
      </main>

      {updater.promptOpen && !pendingTab && (
        <UpdateDialog updater={updater} onDetails={() => {
          updater.dismissPrompt();
          handleSelectTab("about");
        }} />
      )}

      {/* Unsaved Settings Leave Guard Modal */}
      {pendingTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] px-4">
          <div className="w-full max-w-sm rounded-2xl bg-surface-card border border-border-subtle shadow-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink-primary">设置尚未保存</h3>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  你修改了设置但尚未保存，直接切换页面会丢失这些更改。是否先保存再离开？
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={savingBeforeLeave}
                onClick={() => setPendingTab(null)}
                className="rounded-xl px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink-primary hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                留在当前页
              </button>
              <button
                type="button"
                disabled={savingBeforeLeave}
                onClick={handleDiscardAndLeave}
                className="rounded-xl border border-border-subtle bg-surface-elevated hover:bg-surface-hover px-3 py-1.5 text-xs font-medium text-ink-primary transition-colors disabled:opacity-50"
              >
                不保存离开
              </button>
              <button
                type="button"
                disabled={savingBeforeLeave}
                onClick={handleSaveAndLeave}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand hover:bg-brand-hover text-white px-3.5 py-1.5 text-xs font-medium shadow-sm transition-colors disabled:opacity-60"
              >
                {savingBeforeLeave && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>保存并离开</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const App: React.FC = () => {
  const isQuickCapture =
    new URLSearchParams(window.location.search).get("window") === "quick-capture";

  return isQuickCapture ? <QuickCapture /> : <MainShell />;
};

export default App;
