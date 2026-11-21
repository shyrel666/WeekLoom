import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CornerDownLeft } from "lucide-react";
import { BrandLogoMark } from "./BrandLogo";
import type { AppSettings } from "../types";

export const QuickCapture: React.FC = () => {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => {
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 30);
  };

  useEffect(() => {
    document.documentElement.classList.add("quick-capture-mode");

    // Sync theme on initial load
    invoke<AppSettings>("get_settings")
      .then((settings) => {
        document.documentElement.classList.toggle("dark", settings.theme === "dark");
      })
      .catch(() => {});

    const unlistenFocusPromise = listen("quick-capture-focus", () => {
      focusInput();
    });

    const unlistenSettingsPromise = listen<AppSettings>("settings-updated", (event) => {
      document.documentElement.classList.toggle("dark", event.payload.theme === "dark");
    });

    const onWindowFocus = () => focusInput();
    window.addEventListener("focus", onWindowFocus);
    focusInput();

    return () => {
      window.removeEventListener("focus", onWindowFocus);
      unlistenFocusPromise.then((u) => u());
      unlistenSettingsPromise.then((u) => u());
    };
  }, []);

  const handleClose = async () => {
    setContent("");
    await invoke("hide_quick_capture_window");
  };

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      await invoke("add_work_log", { content: trimmed, targetDate: null });
      setContent("");
      await invoke("hide_quick_capture_window");
    } catch (err) {
      console.error("Quick capture save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="h-screen w-screen p-2 flex items-center justify-center bg-transparent">
      <div className="w-full rounded-2xl bg-surface-card border border-border-strong shadow-float px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-lg overflow-hidden ring-1 ring-black/10 dark:ring-white/10">
            <BrandLogoMark size={26} />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={content}
            disabled={saving}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="随手记一笔刚完成的工作碎片..."
            className="flex-1 bg-transparent text-[15px] text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!content.trim() || saving}
            className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-40 text-white text-xs font-medium px-2.5 py-1.5 transition-colors"
          >
            <CornerDownLeft className="w-3.5 h-3.5" />
            <span>记录</span>
          </button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-ink-muted px-0.5 pt-0.5 border-t border-border-subtle">
          <span>自动带时间戳写入本周记录 · WeekLoom</span>
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border-subtle font-sans text-[10px]">
                Enter
              </kbd>{" "}
              保存
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border-subtle font-sans text-[10px]">
                Esc
              </kbd>{" "}
              隐藏
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
