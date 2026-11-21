import type { Platform } from "../types";

export interface WeekRange {
  start: string; // YYYY-MM-DD (Monday)
  end: string; // YYYY-MM-DD (Sunday)
  label: string; // e.g. 2026-11-16 ~ 2026-11-22
  isCurrentWeek: boolean;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDateISO(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function getTodayISO(): string {
  return formatDateISO(new Date());
}

export function shiftISODateByDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + deltaDays);
  return formatDateISO(date);
}

/**
 * Returns the Monday..Sunday range shifted by `weekOffset` weeks from the current week.
 */
export function getWeekRange(weekOffset = 0): WeekRange {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = base.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(base);
  monday.setDate(base.getDate() + diffToMonday + weekOffset * 7);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const start = formatDateISO(monday);
  const end = formatDateISO(sunday);

  return {
    start,
    end,
    label: `${start} ~ ${end}`,
    isCurrentWeek: weekOffset === 0,
  };
}

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function formatChineseDateHeading(dateStr: string): {
  title: string;
  weekday: string;
  isToday: boolean;
} {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const weekday = WEEKDAY_NAMES[date.getDay()] ?? "";
  const isToday = dateStr === getTodayISO();
  return {
    title: `${m}月${d}日`,
    weekday,
    isToday,
  };
}

export function formatShortcutForDisplay(shortcut: string, platform: Platform): string {
  if (!shortcut) return platform === "macos" ? "Option + W" : "Alt + W";
  return shortcut
    .split("+")
    .map((part) => {
      const p = part.trim();
      const lower = p.toLowerCase();
      if (lower === "alt" || lower === "option") {
        return platform === "macos" ? "Option" : "Alt";
      }
      if (lower === "cmdorctrl" || lower === "commandorcontrol") {
        return platform === "macos" ? "Cmd" : "Ctrl";
      }
      if (lower === "cmd" || lower === "command" || lower === "super" || lower === "meta") {
        return platform === "macos" ? "Cmd" : "Win";
      }
      if (lower === "ctrl" || lower === "control") {
        return "Ctrl";
      }
      if (lower === "shift") {
        return "Shift";
      }
      return p.toUpperCase();
    })
    .join(" + ");
}
