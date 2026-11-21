import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { AppInfo, AppSettings, ReleaseInfo } from "../types";

type Release = ReleaseInfo & { manualNotice?: string };

interface Progress {
  received: number;
  total?: number;
  bytesPerSecond: number;
  finished: boolean;
}

type UpdateState =
  | { status: "idle" | "checking" | "up-to-date" }
  | { status: "available" | "installing"; release: Release }
  | { status: "downloading"; release: Release; progress: Progress }
  | { status: "ready"; release: Release; installed?: boolean }
  | { status: "error"; message: string };

function canCheck(state: UpdateState) {
  return ["idle", "available", "up-to-date", "error"].includes(state.status);
}

async function githubUpdate(manualNotice: string): Promise<UpdateState> {
  const release = await invoke<ReleaseInfo | null>("check_github_release");
  return release
    ? { status: "available", release: { ...release, manualNotice } }
    : { status: "up-to-date" };
}

export function useAppUpdater(settings: AppSettings | null) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [actionError, setActionError] = useState("");
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [startupDiscovery, setStartupDiscovery] = useState(false);
  const current = useRef(state);
  const native = useRef<Update | null>(null);
  const checked = useRef(false);

  const publish = useCallback((next: UpdateState) => {
    current.current = next;
    setState(next);
  }, []);

  const closeNative = useCallback(() => {
    const previous = native.current;
    native.current = null;
    if (previous) void previous.close().catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    invoke<AppInfo>("get_app_info").then(
      (result) => { if (active) setInfo(result); },
      () => { if (active) publish({ status: "error", message: "无法读取应用环境，请重试。" }); }
    );
    return () => {
      active = false;
      closeNative();
    };
  }, [closeNative, publish]);

  const checkForUpdates = useCallback(async (startup = false) => {
    if (!canCheck(current.current) || (startup && checked.current)) return;
    checked.current = true;
    setStartupDiscovery(startup);
    publish({ status: "checking" });
    setActionError("");
    closeNative();
    try {
      const app = info ?? await invoke<AppInfo>("get_app_info");
      if (!info) setInfo(app);
      if (app.updater_configured) {
        try {
          const update = await check({ timeout: 12_000 });
          native.current = update;
          publish(update ? {
            status: "available",
            release: {
              version: update.version,
              published_at: update.date ?? null,
              body: update.body ?? "",
              release_url: `${app.repo_url}/releases`,
              download_url: null,
            },
          } : { status: "up-to-date" });
          return;
        } catch {
          publish(await githubUpdate("本次更新可从 GitHub 发行页下载安装。"));
        }
      } else {
        publish(await githubUpdate("此版本通过 GitHub 安装包更新，下载后打开安装包即可。"));
      }
    } catch (error) {
      publish({ status: "error", message: typeof error === "string" ? error : "更新检查未完成，请重试。" });
    } finally {
      setLastChecked(new Date());
    }
  }, [info, publish, closeNative]);

  useEffect(() => {
    if (!info || !settings?.auto_check_update || checked.current) return;
    const timer = window.setTimeout(() => void checkForUpdates(true), 4000);
    return () => window.clearTimeout(timer);
  }, [info, settings?.auto_check_update, checkForUpdates]);

  const openLink = async (url: string) => {
    setActionError("");
    try {
      await invoke("open_https_url", { url });
      return true;
    } catch (error) {
      setActionError(typeof error === "string" ? error : "无法打开系统浏览器。");
      return false;
    }
  };

  const savePreferences = async (patch: { autoCheckUpdate?: boolean; skippedVersion?: string }) => {
    setSavingPreferences(true);
    setActionError("");
    try {
      await invoke("update_update_preferences", patch);
      if (patch.skippedVersion) setPromptDismissed(true);
    } catch {
      setActionError("更新偏好保存失败，请重试。");
    } finally {
      setSavingPreferences(false);
    }
  };

  const startUpdate = async () => {
    const selected = current.current;
    if (selected.status !== "available") return;
    const { release } = selected;
    if (release.manualNotice) {
      if (await openLink(release.download_url ?? release.release_url)) setPromptDismissed(true);
      return;
    }
    const update = native.current;
    if (!update) return;
    setPromptDismissed(true);
    setActionError("");

    let received = 0;
    let total: number | undefined;
    let finished = false;
    let sampleTime = performance.now();
    let sampleBytes = 0;
    const showProgress = () => {
      const now = performance.now();
      const bytesPerSecond = (received - sampleBytes) * 1000 / Math.max(1, now - sampleTime);
      publish({ status: "downloading", release, progress: { received, total, bytesPerSecond, finished } });
      sampleTime = now;
      sampleBytes = received;
    };
    showProgress();
    const timer = window.setInterval(showProgress, 500);
    try {
      await update.download((event) => {
        if (native.current !== update || current.current.status !== "downloading") return;
        switch (event.event) {
          case "Started": total = event.data.contentLength; break;
          case "Progress": received += event.data.chunkLength; break;
          case "Finished": finished = true; showProgress(); break;
        }
      }, { timeout: 15 * 60_000 }).finally(() => window.clearInterval(timer));
      publish({ status: "ready", release });
    } catch {
      // The plugin verifies the signature before download() resolves.
      closeNative();
      publish({ status: "checking" });
      try {
        publish(await githubUpdate("应用内下载或签名校验未完成，请从 GitHub 下载发行安装包。"));
      } catch (error) {
        publish({ status: "error", message: typeof error === "string" ? error : "下载未完成，请重试。" });
      }
    }
  };

  const install = async () => {
    const selected = current.current;
    if (selected.status !== "ready" || !native.current) return;
    const { release } = selected;
    let installed = selected.installed ?? false;
    publish({ status: "installing", release });
    setActionError("");
    try {
      await invoke("set_app_quitting", { quitting: true });
      if (!installed) {
        await native.current.install();
        installed = true;
      }
      // Windows exits into the installer, which relaunches the app itself.
      if (info?.platform !== "windows") await relaunch();
    } catch {
      try {
        await invoke("set_app_quitting", { quitting: false });
      } catch {
        setActionError("窗口关闭状态未恢复，请从托盘退出后重新打开 WeekLoom。");
      }
      if (installed) {
        publish({ status: "ready", release, installed: true });
      } else {
        closeNative();
        publish({ status: "error", message: "安装未能完成，可重试或前往 GitHub 下载安装包。" });
      }
    }
  };

  const release = "release" in state ? state.release : null;
  const hasUpdate = !!release && !!settings && release.version !== settings.skipped_version;
  return {
    info, state, release, lastChecked, hasUpdate, canCheck: canCheck(state),
    promptOpen: startupDiscovery && settings?.auto_check_update && hasUpdate && !promptDismissed && state.status === "available",
    dismissPrompt: () => setPromptDismissed(true),
    actionError, setActionError, openLink, savingPreferences, savePreferences,
    checkForUpdates, startUpdate, install,
  };
}

export type AppUpdater = ReturnType<typeof useAppUpdater>;
