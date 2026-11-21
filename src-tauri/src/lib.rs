mod ai;
mod android_import;
mod db;
mod reminder;
mod tray;
mod updater;
mod webdav;

use ai::{DeepSeekModelInfo, GeneratedReport, ReportGenerateOptions};
use db::{AppSettings, DbState, WeeklyReport, WorkLog};
use reminder::{ReminderConfig, ReminderState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tray::{
    hide_quick_capture, register_quick_capture_shortcut, setup_tray, show_quick_capture,
    AppQuittingState, QuickCaptureState,
};
use webdav::{MobileHelperInfo, WebDavConfig, WebDavState, WebDavSyncResult, WebDavSyncStatus};

#[tauri::command]
fn get_platform() -> &'static str {
    std::env::consts::OS
}

#[tauri::command]
fn get_work_logs(
    db: State<'_, DbState>,
    week_start: String,
    week_end: String,
) -> Result<Vec<WorkLog>, String> {
    let conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
    db::get_work_logs(&conn, &week_start, &week_end)
}

#[tauri::command]
fn add_work_log(
    app: AppHandle,
    db: State<'_, DbState>,
    content: String,
    target_date: Option<String>,
) -> Result<WorkLog, String> {
    let log = {
        let conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
        db::add_work_log(&conn, &content, target_date)?
    };
    let _ = app.emit("work-logs-updated", ());
    Ok(log)
}

#[tauri::command]
fn update_work_log(
    app: AppHandle,
    db: State<'_, DbState>,
    id: i64,
    content: String,
) -> Result<WorkLog, String> {
    let log = {
        let conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
        db::update_work_log(&conn, id, &content)?
    };
    let _ = app.emit("work-logs-updated", ());
    Ok(log)
}

#[tauri::command]
fn delete_work_log(app: AppHandle, db: State<'_, DbState>, id: i64) -> Result<(), String> {
    {
        let conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
        db::delete_work_log(&conn, id)?;
    }
    let _ = app.emit("work-logs-updated", ());
    Ok(())
}

#[tauri::command]
fn get_weekly_report(
    db: State<'_, DbState>,
    week_start: String,
) -> Result<Option<WeeklyReport>, String> {
    let conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
    db::get_weekly_report_by_week(&conn, &week_start)
}

#[tauri::command]
fn list_weekly_reports(db: State<'_, DbState>) -> Result<Vec<WeeklyReport>, String> {
    let conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
    db::list_weekly_reports(&conn)
}

#[tauri::command]
fn save_weekly_report(
    app: AppHandle,
    db: State<'_, DbState>,
    week_start: String,
    week_end: String,
    role: String,
    style: String,
    summary: String,
    next_plan: String,
) -> Result<WeeklyReport, String> {
    let report = {
        let conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
        db::upsert_weekly_report(
            &conn,
            &week_start,
            &week_end,
            &role,
            &style,
            &summary,
            &next_plan,
        )?
    };
    let _ = app.emit("reports-updated", ());
    Ok(report)
}

#[tauri::command]
fn delete_weekly_report(app: AppHandle, db: State<'_, DbState>, id: i64) -> Result<(), String> {
    {
        let conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
        db::delete_weekly_report(&conn, id)?;
    }
    let _ = app.emit("reports-updated", ());
    Ok(())
}

#[tauri::command]
fn get_settings(db: State<'_, DbState>) -> Result<AppSettings, String> {
    let conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
    db::get_settings(&conn)
}

#[tauri::command]
fn update_update_preferences(
    app: AppHandle,
    db: State<'_, DbState>,
    auto_check_update: Option<bool>,
    skipped_version: Option<String>,
) -> Result<(), String> {
    let saved = {
        let mut conn = db.0.lock().map_err(|_| "数据库锁定失败")?;
        db::update_update_preferences(&mut conn, auto_check_update, skipped_version.as_deref())?;
        db::get_settings(&conn)?
    };
    app.emit("settings-updated", saved).map_err(|_| "更新偏好已保存，暂时无法刷新界面。".into())
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    db: State<'_, DbState>,
    reminder_state: State<'_, ReminderState>,
    webdav_state: State<'_, WebDavState>,
    settings: AppSettings,
) -> Result<Option<String>, String> {
    let (prev_shortcut, persisted) = {
        let mut conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
        let old = db::get_settings(&conn)?;
        db::save_settings(&mut conn, &settings)?;
        let latest = db::get_settings(&conn)?;
        (old.shortcut, latest)
    };

    // Update live reminder thread config
    if let Ok(mut guard) = reminder_state.0.lock() {
        guard.enabled = persisted.reminder_enabled;
        guard.time = persisted.reminder_time.clone();
    }

    // Update live WebDAV background sync config
    webdav_state.update_config(WebDavConfig::from(&persisted));

    // Broadcast theme & settings update to all windows (including quick-capture)
    let _ = app.emit("settings-updated", &persisted);

    // Re-register global shortcut if changed
    let mut shortcut_warning: Option<String> = None;
    if persisted.shortcut != prev_shortcut {
        if let Err(err) = register_quick_capture_shortcut(&app, &persisted.shortcut) {
            // Restore previous shortcut in both OS and DB so state stays consistent
            let _ = register_quick_capture_shortcut(&app, &prev_shortcut);
            let mut reverted = persisted.clone();
            reverted.shortcut = prev_shortcut;
            if let Ok(mut conn) = db.0.lock() {
                let _ = db::save_settings(&mut conn, &reverted);
            }
            let _ = app.emit("settings-updated", &reverted);
            shortcut_warning = Some(err);
        }
    }

    Ok(shortcut_warning)
}

#[tauri::command]
async fn test_webdav_connection(
    url: String,
    username: String,
    password: String,
) -> Result<String, String> {
    webdav::test_and_init_webdav(&url, &username, &password).await
}

#[tauri::command]
async fn sync_webdav_now(
    app: AppHandle,
    webdav_state: State<'_, WebDavState>,
    url: Option<String>,
    username: Option<String>,
    password: Option<String>,
) -> Result<WebDavSyncResult, String> {
    let mut cfg = webdav_state.snapshot_config();
    if let Some(u) = url {
        cfg.url = u;
    }
    if let Some(user) = username {
        cfg.username = user;
    }
    if let Some(pass) = password {
        cfg.password = pass;
    }
    webdav::sync_webdav_inbox(&app, &cfg, false).await
}

#[tauri::command]
fn get_webdav_status(webdav_state: State<'_, WebDavState>) -> WebDavSyncStatus {
    webdav_state.snapshot_status()
}

#[tauri::command]
fn build_webdav_mobile_helper(
    url: String,
    username: String,
    password: String,
) -> Result<MobileHelperInfo, String> {
    webdav::build_mobile_helper(&url, &username, &password)
}

#[tauri::command]
fn export_android_shortcuts_file(
    app: AppHandle,
    url: String,
    username: String,
    password: String,
) -> Result<String, String> {
    webdav::export_android_shortcuts_file(&app, &url, &username, &password)
}

#[tauri::command]
async fn fetch_deepseek_models(api_key: String) -> Result<Vec<DeepSeekModelInfo>, String> {
    ai::fetch_deepseek_models(&api_key).await
}

#[tauri::command]
async fn test_deepseek_connection(api_key: String, model: String) -> Result<String, String> {
    ai::test_deepseek_connection(&api_key, &model).await
}

#[tauri::command]
async fn generate_weekly_report(
    app: AppHandle,
    db: State<'_, DbState>,
    week_start: String,
    week_end: String,
    role: String,
    style: String,
    format: Option<String>,
    custom_instructions: Option<String>,
    include_last_week_plan: Option<bool>,
) -> Result<WeeklyReport, String> {
    let (settings, logs, last_week_plan) = {
        let conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
        let settings = db::get_settings(&conn)?;
        let logs = db::get_work_logs(&conn, &week_start, &week_end)?;
        let use_prev_plan = include_last_week_plan.unwrap_or(settings.include_last_week_plan);
        let prev_plan = if use_prev_plan {
            db::get_previous_week_plan(&conn, &week_start)?
        } else {
            None
        };
        (settings, logs, prev_plan)
    };

    let effective_role = {
        let trimmed = role.trim();
        if trimmed.is_empty() || trimmed == "custom" || trimmed == "自定义岗位" {
            db::DEFAULT_ROLE_PRESET.to_string()
        } else {
            trimmed.to_string()
        }
    };
    let effective_style = db::normalize_report_style(&style).to_string();
    let effective_format = format
        .as_deref()
        .map(db::normalize_report_format)
        .unwrap_or_else(|| db::normalize_report_format(&settings.report_format))
        .to_string();
    let effective_instructions = custom_instructions
        .unwrap_or(settings.report_custom_instructions)
        .trim()
        .to_string();

    let week_range = format!("{} ~ {}", week_start, week_end);
    let options = ReportGenerateOptions {
        role: &effective_role,
        style: &effective_style,
        format: &effective_format,
        custom_instructions: &effective_instructions,
        last_week_plan: last_week_plan.as_deref(),
    };
    let generated: GeneratedReport = ai::generate_weekly_report(
        &settings.api_key,
        &settings.model,
        &options,
        &week_range,
        &logs,
    )
    .await?;

    let saved = {
        let conn = db.0.lock().map_err(|_| "数据库锁定失败".to_string())?;
        db::upsert_weekly_report(
            &conn,
            &week_start,
            &week_end,
            &effective_role,
            &effective_style,
            &generated.summary,
            &generated.next_plan,
        )?
    };

    let _ = app.emit("reports-updated", ());
    Ok(saved)
}

#[tauri::command]
fn open_quick_capture_window(app: AppHandle) {
    show_quick_capture(&app);
}

#[tauri::command]
fn hide_quick_capture_window(app: AppHandle) {
    hide_quick_capture(&app);
}

#[tauri::command]
fn send_test_notification(app: AppHandle) -> Result<(), String> {
    app.notification()
        .builder()
        .title("WeekLoom")
        .body("今天干了啥？花 10 秒记一笔吧")
        .show()
        .map_err(|e| format!("发送系统通知失败: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new()
            .default_version_comparator(|current, release| release.version.cmp_precedence(&current).is_gt())
            .build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .manage(QuickCaptureState::default())
        .manage(android_import::AndroidImportState::default())
        .manage(AppQuittingState(AtomicBool::new(false)))
        .setup(|app| {
            // Initialize SQLite in OS-standard app_data_dir
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("无法获取系统应用数据目录: {}", e))?;
            let conn = db::init_db(&app_data_dir)?;
            let settings = db::get_settings(&conn).unwrap_or_default();

            app.manage(DbState(Mutex::new(conn)));

            // Start workday reminder background thread
            let reminder_cfg = Arc::new(Mutex::new(ReminderConfig {
                enabled: settings.reminder_enabled,
                time: settings.reminder_time.clone(),
            }));
            app.manage(ReminderState(reminder_cfg.clone()));
            reminder::start_reminder_thread(app.handle().clone(), reminder_cfg);

            // Start WebDAV mobile inbox background sync loop
            app.manage(WebDavState::new(WebDavConfig::from(&settings)));
            webdav::start_webdav_sync_loop(app.handle().clone());

            // Setup system tray / macOS menu bar icon
            setup_tray(app)?;

            // Register global shortcut safely without crashing on conflict
            if let Err(err) = register_quick_capture_shortcut(app.handle(), &settings.shortcut) {
                eprintln!("[WeekLoom] Global shortcut registration warning: {}", err);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            match event {
                WindowEvent::CloseRequested { api, .. }
                    if label == "main" || label == "quick-capture" =>
                {
                    if label == "main" {
                        window.state::<android_import::AndroidImportState>().stop(None);
                        let _ = window.emit_to("main", "android-import-dismissed", ());
                    }
                    let is_quitting = window
                        .app_handle()
                        .try_state::<AppQuittingState>()
                        .map(|s| s.0.load(Ordering::SeqCst))
                        .unwrap_or(false);
                    if !is_quitting {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                WindowEvent::Focused(false) if label == "quick-capture" => {
                    // Guard against initial show/focus race (220ms grace window)
                    let should_hide = window
                        .app_handle()
                        .try_state::<QuickCaptureState>()
                        .and_then(|s| s.last_shown_at.lock().ok().and_then(|g| *g))
                        .map(|t| t.elapsed() > Duration::from_millis(220))
                        .unwrap_or(true);
                    if should_hide {
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_platform,
            updater::get_app_info,
            updater::check_github_release,
            updater::open_https_url,
            updater::set_app_quitting,
            update_update_preferences,
            get_work_logs,
            add_work_log,
            update_work_log,
            delete_work_log,
            get_weekly_report,
            list_weekly_reports,
            save_weekly_report,
            delete_weekly_report,
            get_settings,
            save_settings,
            fetch_deepseek_models,
            test_deepseek_connection,
            generate_weekly_report,
            open_quick_capture_window,
            hide_quick_capture_window,
            send_test_notification,
            test_webdav_connection,
            sync_webdav_now,
            get_webdav_status,
            build_webdav_mobile_helper,
            android_import::start_android_import,
            android_import::stop_android_import,
            export_android_shortcuts_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building WeekLoom application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            if !has_visible_windows {
                tray::show_main_window(app_handle);
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, event);
        }
    });
}
