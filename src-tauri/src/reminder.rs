use chrono::{Datelike, Local, Weekday};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone)]
pub struct ReminderConfig {
    pub enabled: bool,
    pub time: String,
}

pub struct ReminderState(pub Arc<Mutex<ReminderConfig>>);

pub fn start_reminder_thread(app_handle: AppHandle, config: Arc<Mutex<ReminderConfig>>) {
    thread::spawn(move || {
        let mut last_notified_key = String::new();

        loop {
            thread::sleep(Duration::from_secs(15));

            let (enabled, target_time) = match config.lock() {
                Ok(guard) => (guard.enabled, guard.time.clone()),
                Err(_) => continue,
            };

            if !enabled || target_time.trim().is_empty() {
                continue;
            }

            let now = Local::now();
            let is_workday = matches!(
                now.weekday(),
                Weekday::Mon | Weekday::Tue | Weekday::Wed | Weekday::Thu | Weekday::Fri
            );
            if !is_workday {
                continue;
            }

            let current_hm = now.format("%H:%M").to_string();
            let current_date = now.format("%Y-%m-%d").to_string();
            let key = format!("{}_{}", current_date, target_time.trim());

            if current_hm == target_time.trim() && last_notified_key != key {
                last_notified_key = key;
                let _ = app_handle
                    .notification()
                    .builder()
                    .title("WeekLoom")
                    .body("今天干了啥？花 10 秒记一笔吧")
                    .show();
            }
        }
    });
}
