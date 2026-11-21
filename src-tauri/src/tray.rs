use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(not(target_os = "macos"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager, PhysicalPosition};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub struct QuickCaptureState {
    pub last_shown_at: Mutex<Option<Instant>>,
}

impl Default for QuickCaptureState {
    fn default() -> Self {
        Self {
            last_shown_at: Mutex::new(None),
        }
    }
}

pub struct AppQuittingState(pub AtomicBool);

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide_quick_capture(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quick-capture") {
        let _ = window.hide();
    }
}

pub fn show_quick_capture(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quick-capture") {
        // Position at upper-center of current or primary monitor
        let monitor = window
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| window.primary_monitor().ok().flatten());
        if let Some(monitor) = monitor {
            let monitor_pos = monitor.position();
            let monitor_size = monitor.size();
            if let Ok(win_size) = window.outer_size() {
                let x = monitor_pos.x + ((monitor_size.width as i32 - win_size.width as i32) / 2);
                let y = monitor_pos.y + ((monitor_size.height as f64 * 0.2) as i32);
                let _ = window.set_position(PhysicalPosition::new(x, y));
            }
        }

        if let Some(state) = app.try_state::<QuickCaptureState>() {
            if let Ok(mut guard) = state.last_shown_at.lock() {
                *guard = Some(Instant::now());
            }
        }

        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to("quick-capture", "quick-capture-focus", ());
    }
}

pub fn toggle_quick_capture(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quick-capture") {
        if window.is_visible().unwrap_or(false) {
            hide_quick_capture(app);
        } else {
            show_quick_capture(app);
        }
    }
}

pub fn setup_tray(app: &App) -> tauri::Result<()> {
    let quick_item = MenuItem::with_id(app, "quick_capture", "快速记录", true, None::<&str>)?;
    let open_item = MenuItem::with_id(app, "show_main", "打开主界面", true, None::<&str>)?;
    let update_item = MenuItem::with_id(app, "check_update", "检查更新", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&quick_item, &open_item, &update_item, &sep, &quit_item])?;

    let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    let builder = TrayIconBuilder::with_id("weekloom-tray")
        .icon(tray_icon)
        .tooltip("WeekLoom")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"));

    #[cfg(target_os = "macos")]
    let builder = builder.icon_as_template(true);

    builder
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "quick_capture" => {
                show_quick_capture(app_handle);
            }
            "show_main" => {
                show_main_window(app_handle);
            }
            "check_update" => {
                show_main_window(app_handle);
                let _ = app_handle.emit_to("main", "check-for-updates", ());
            }
            "quit" => {
                if let Some(quitting) = app_handle.try_state::<AppQuittingState>() {
                    quitting.0.store(true, Ordering::SeqCst);
                }
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            #[cfg(not(target_os = "macos"))]
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }

            #[cfg(target_os = "macos")]
            {
                let _ = (tray, event);
            }
        })
        .build(app)?;

    Ok(())
}

pub fn register_quick_capture_shortcut(
    app: &AppHandle,
    shortcut_str: &str,
) -> Result<(), String> {
    let trimmed = shortcut_str.trim();
    if trimmed.is_empty() {
        return Err("快捷键不能为空".to_string());
    }

    let parsed = Shortcut::from_str(trimmed)
        .map_err(|_| format!("快捷键格式无效：「{}」，示例：Alt+W", trimmed))?;

    let manager = app.global_shortcut();
    let _ = manager.unregister_all();

    manager
        .on_shortcut(parsed, move |app_handle, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_quick_capture(app_handle);
            }
        })
        .map_err(|e| {
            format!(
                "快捷键「{}」注册失败（可能与其他应用冲突）：{}",
                trimmed, e
            )
        })?;

    Ok(())
}
