import { useEffect, useState } from "react";
import { getTodayISO } from "../utils/date";

/**
 * Tracks the current local calendar date (YYYY-MM-DD) and refreshes automatically
 * when the tray-resident window regains focus/visibility or crosses midnight.
 */
export function useTodayISO(): string {
  const [todayISO, setTodayISO] = useState<string>(() => getTodayISO());

  useEffect(() => {
    const syncToday = () => {
      const current = getTodayISO();
      setTodayISO((prev) => (prev === current ? prev : current));
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncToday();
      }
    };

    window.addEventListener("focus", syncToday);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = window.setInterval(syncToday, 60_000);

    return () => {
      window.removeEventListener("focus", syncToday);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(timer);
    };
  }, []);

  return todayISO;
}
