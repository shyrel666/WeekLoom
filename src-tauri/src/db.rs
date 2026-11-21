use chrono::{Duration as ChronoDuration, Local, NaiveDate};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

pub const DEFAULT_ROLE_PRESET: &str = "general";
pub const DEFAULT_REPORT_STYLE: &str = "concise";
pub const DEFAULT_REPORT_FORMAT: &str = "plain";
pub const MAX_CUSTOM_INSTRUCTIONS_CHARS: usize = 500;
pub const DB_FILENAME: &str = "weekloom.db";

pub const DEFAULT_WEBDAV_URL: &str = "https://dav.jianguoyun.com/dav/WeekLoom/inbox/";
pub const DEFAULT_WEBDAV_SYNC_INTERVAL_MINS: u32 = 5;

fn default_report_format() -> String {
    DEFAULT_REPORT_FORMAT.to_string()
}

fn default_true() -> bool {
    true
}

fn default_webdav_url() -> String {
    DEFAULT_WEBDAV_URL.to_string()
}

fn default_webdav_sync_interval() -> u32 {
    DEFAULT_WEBDAV_SYNC_INTERVAL_MINS
}

/// Maps both stable preset IDs and legacy Chinese labels to canonical role preset IDs.
pub fn normalize_role_preset(raw: &str) -> &'static str {
    match raw.trim() {
        "general" | "通用职场" => "general",
        "product_ops" | "产品 / 运营" => "product_ops",
        "sales_biz" | "销售 / 商务" => "sales_biz",
        "admin_hr_fin" | "行政 / 人事 / 财务" => "admin_hr_fin",
        "tech" | "研发 / 技术" => "tech",
        "design" | "设计 / 创意" => "design",
        "custom" | "自定义岗位" => "custom",
        _ => DEFAULT_ROLE_PRESET,
    }
}

/// Maps both stable style IDs and legacy Chinese labels to canonical report style IDs.
pub fn normalize_report_style(raw: &str) -> &'static str {
    match raw.trim() {
        "concise" | "精简干练" => "concise",
        "detailed" | "详实专业" => "detailed",
        "impact" | "突出成果" => "impact",
        _ => DEFAULT_REPORT_STYLE,
    }
}

/// Maps output format values to canonical format IDs (`plain` | `markdown`).
pub fn normalize_report_format(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "markdown" | "md" => "markdown",
        _ => DEFAULT_REPORT_FORMAT,
    }
}

/// Returns the human-readable Chinese display label for known role preset IDs,
/// or the original string for custom role titles / legacy Chinese labels.
pub fn role_display_name(role: &str) -> &str {
    match role.trim() {
        "general" => "通用职场",
        "product_ops" => "产品 / 运营",
        "sales_biz" => "销售 / 商务",
        "admin_hr_fin" => "行政 / 人事 / 财务",
        "tech" => "研发 / 技术",
        "design" => "设计 / 创意",
        "custom" => "通用职场",
        other => other,
    }
}

pub struct DbState(pub Mutex<Connection>);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkLog {
    pub id: i64,
    pub content: String,
    pub created_at: String,
    pub log_date: String,
    pub log_time: String,
    #[serde(default)]
    pub is_remote: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeeklyReport {
    pub id: i64,
    pub week_start: String,
    pub week_end: String,
    pub role: String,
    pub style: String,
    pub summary: String,
    pub next_plan: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub api_key: String,
    pub model: String,
    pub default_role: String,
    pub custom_role: String,
    pub default_style: String,
    #[serde(default = "default_report_format")]
    pub report_format: String,
    #[serde(default)]
    pub report_custom_instructions: String,
    #[serde(default = "default_true")]
    pub include_last_week_plan: bool,
    pub reminder_enabled: bool,
    pub reminder_time: String,
    pub shortcut: String,
    pub theme: String,
    #[serde(default)]
    pub webdav_enabled: bool,
    #[serde(default = "default_webdav_url")]
    pub webdav_url: String,
    #[serde(default)]
    pub webdav_username: String,
    #[serde(default)]
    pub webdav_password: String,
    #[serde(default = "default_webdav_sync_interval")]
    pub webdav_sync_interval_mins: u32,
    #[serde(default = "default_true")]
    pub auto_check_update: bool,
    #[serde(default)]
    pub skipped_version: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            model: "deepseek-flash".to_string(),
            default_role: DEFAULT_ROLE_PRESET.to_string(),
            custom_role: String::new(),
            default_style: DEFAULT_REPORT_STYLE.to_string(),
            report_format: default_report_format(),
            report_custom_instructions: String::new(),
            include_last_week_plan: true,
            reminder_enabled: true,
            reminder_time: "17:30".to_string(),
            shortcut: "Alt+W".to_string(),
            theme: "light".to_string(),
            webdav_enabled: false,
            webdav_url: default_webdav_url(),
            webdav_username: String::new(),
            webdav_password: String::new(),
            webdav_sync_interval_mins: DEFAULT_WEBDAV_SYNC_INTERVAL_MINS,
            auto_check_update: true,
            skipped_version: String::new(),
        }
    }
}

pub fn init_db(app_data_dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("无法创建应用数据目录: {}", e))?;

    let db_path = app_data_dir.join(DB_FILENAME);
    let conn =
        Connection::open(&db_path).map_err(|e| format!("无法打开本地 SQLite 数据库: {}", e))?;

    init_schema(&conn)?;
    Ok(conn)
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(|e| format!("检查表结构失败: {}", e))?;
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("读取表结构失败: {}", e))?;
    for col in cols {
        if col.map_err(|e| format!("解析列名失败: {}", e))? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS work_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            log_date TEXT NOT NULL,
            log_time TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_work_logs_date ON work_logs(log_date);

        CREATE TABLE IF NOT EXISTS weekly_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            week_start TEXT NOT NULL UNIQUE,
            week_end TEXT NOT NULL,
            role TEXT NOT NULL,
            style TEXT NOT NULL,
            summary TEXT NOT NULL,
            next_plan TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_weekly_reports_week ON weekly_reports(week_start DESC);

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )
    .map_err(|e| format!("初始化数据库表结构失败: {}", e))?;

    // One-time migrations gated by SQLite user_version so explicit user selections persist
    let user_version: i32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);
    if user_version < 1 {
        conn.execute_batch(
            "
            UPDATE settings SET value = 'deepseek-flash' WHERE key = 'model' AND value = 'deepseek-chat';
            PRAGMA user_version = 1;
            ",
        )
        .map_err(|e| format!("数据库版本迁移失败 (v1): {}", e))?;
    }

    if user_version < 2 {
        if !has_column(conn, "work_logs", "external_id")? {
            conn.execute_batch("ALTER TABLE work_logs ADD COLUMN external_id TEXT;")
                .map_err(|e| format!("数据库新增 external_id 列失败: {}", e))?;
        }
        conn.execute_batch(
            "
            CREATE UNIQUE INDEX IF NOT EXISTS idx_work_logs_external_id
                ON work_logs(external_id)
                WHERE external_id IS NOT NULL;
            PRAGMA user_version = 2;
            ",
        )
        .map_err(|e| format!("数据库版本迁移失败 (v2): {}", e))?;
    }

    if user_version < 3 {
        // Migrate legacy Chinese display strings in settings to stable enum IDs
        let migrate_key = |key: &str, normalizer: fn(&str) -> &'static str| -> Result<(), String> {
            let current: Option<String> = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = ?1",
                    params![key],
                    |row| row.get(0),
                )
                .ok();
            if let Some(raw) = current {
                let normalized = normalizer(&raw);
                if normalized != raw {
                    conn.execute(
                        "UPDATE settings SET value = ?1 WHERE key = ?2",
                        params![normalized, key],
                    )
                    .map_err(|e| format!("迁移设置项 {} 失败: {}", key, e))?;
                }
            }
            Ok(())
        };

        migrate_key("default_role", normalize_role_preset)?;
        migrate_key("default_style", normalize_report_style)?;

        // Guard against legacy invalid state: custom role selected with blank custom_role
        let migrated_role: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'default_role'",
                [],
                |row| row.get(0),
            )
            .ok();
        if migrated_role.as_deref() == Some("custom") {
            let custom_role_val: String = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'custom_role'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_default();
            if custom_role_val.trim().is_empty() {
                conn.execute(
                    "UPDATE settings SET value = ?1 WHERE key = 'default_role'",
                    params![DEFAULT_ROLE_PRESET],
                )
                .map_err(|e| format!("修复空白自定义岗位失败: {}", e))?;
            }
        }

        conn.execute_batch("PRAGMA user_version = 3;")
            .map_err(|e| format!("数据库版本迁移失败 (v3): {}", e))?;
    }

    Ok(())
}

pub fn get_work_logs(
    conn: &Connection,
    week_start: &str,
    week_end: &str,
) -> Result<Vec<WorkLog>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, content, created_at, log_date, log_time, (external_id IS NOT NULL)
             FROM work_logs
             WHERE log_date >= ?1 AND log_date <= ?2
             ORDER BY log_date DESC, created_at DESC, id DESC",
        )
        .map_err(|e| format!("查询工作记录失败: {}", e))?;

    let rows = stmt
        .query_map(params![week_start, week_end], |row| {
            Ok(WorkLog {
                id: row.get(0)?,
                content: row.get(1)?,
                created_at: row.get(2)?,
                log_date: row.get(3)?,
                log_time: row.get(4)?,
                is_remote: row.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(|e| format!("读取工作记录失败: {}", e))?;

    let mut logs = Vec::new();
    for item in rows {
        logs.push(item.map_err(|e| format!("解析工作记录失败: {}", e))?);
    }
    Ok(logs)
}

pub fn add_work_log(
    conn: &Connection,
    content: &str,
    target_date: Option<String>,
) -> Result<WorkLog, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("工作记录内容不能为空".to_string());
    }

    let now = Local::now();
    let log_date = match target_date {
        Some(d) if NaiveDate::parse_from_str(d.trim(), "%Y-%m-%d").is_ok() => d.trim().to_string(),
        _ => now.format("%Y-%m-%d").to_string(),
    };
    let log_time = now.format("%H:%M").to_string();
    let created_at = format!("{} {}", log_date, now.format("%H:%M:%S"));

    conn.execute(
        "INSERT INTO work_logs (content, created_at, log_date, log_time) VALUES (?1, ?2, ?3, ?4)",
        params![trimmed, created_at, log_date, log_time],
    )
    .map_err(|e| format!("写入工作记录失败: {}", e))?;

    let id = conn.last_insert_rowid();
    Ok(WorkLog {
        id,
        content: trimmed.to_string(),
        created_at,
        log_date,
        log_time,
        is_remote: false,
    })
}

fn normalize_hhmm(raw: &str) -> Option<String> {
    let parts: Vec<&str> = raw.trim().split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let hour: u32 = parts[0].parse().ok()?;
    let min: u32 = parts[1].parse().ok()?;
    if hour > 23 || min > 59 {
        return None;
    }
    if parts.len() == 3 {
        let sec: u32 = parts[2].parse().ok()?;
        if sec > 59 {
            return None;
        }
    }
    Some(format!("{:02}:{:02}", hour, min))
}

/// Inserts a remotely synced work log idempotently via `external_id`.
/// Returns `Ok(None)` when the same `external_id` has already been imported.
pub fn add_remote_work_log(
    conn: &Connection,
    content: &str,
    log_date: &str,
    log_time: &str,
    external_id: &str,
) -> Result<Option<WorkLog>, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("远程工作记录内容不能为空".to_string());
    }
    let ext_id = external_id.trim();
    if ext_id.is_empty() {
        return Err("远程记录缺少去重标识".to_string());
    }

    let now = Local::now();
    let valid_date = if NaiveDate::parse_from_str(log_date.trim(), "%Y-%m-%d").is_ok() {
        log_date.trim().to_string()
    } else {
        now.format("%Y-%m-%d").to_string()
    };
    let valid_time = normalize_hhmm(log_time).unwrap_or_else(|| now.format("%H:%M").to_string());
    let created_at = format!("{} {}:00", valid_date, valid_time);

    let affected = conn
        .execute(
            "INSERT OR IGNORE INTO work_logs (content, created_at, log_date, log_time, external_id)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![trimmed, created_at, valid_date, valid_time, ext_id],
        )
        .map_err(|e| format!("写入远程工作记录失败: {}", e))?;

    if affected == 0 {
        return Ok(None);
    }

    let id = conn.last_insert_rowid();
    Ok(Some(WorkLog {
        id,
        content: trimmed.to_string(),
        created_at,
        log_date: valid_date,
        log_time: valid_time,
        is_remote: true,
    }))
}

pub fn update_work_log(conn: &Connection, id: i64, content: &str) -> Result<WorkLog, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("工作记录内容不能为空".to_string());
    }

    let affected = conn
        .execute(
            "UPDATE work_logs SET content = ?1 WHERE id = ?2",
            params![trimmed, id],
        )
        .map_err(|e| format!("更新工作记录失败: {}", e))?;

    if affected == 0 {
        return Err("未找到对应的工作记录".to_string());
    }

    conn.query_row(
        "SELECT id, content, created_at, log_date, log_time, (external_id IS NOT NULL)
         FROM work_logs WHERE id = ?1",
        params![id],
        |row| {
            Ok(WorkLog {
                id: row.get(0)?,
                content: row.get(1)?,
                created_at: row.get(2)?,
                log_date: row.get(3)?,
                log_time: row.get(4)?,
                is_remote: row.get::<_, i64>(5)? != 0,
            })
        },
    )
    .map_err(|e| format!("读取更新后的记录失败: {}", e))
}

pub fn delete_work_log(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM work_logs WHERE id = ?1", params![id])
        .map_err(|e| format!("删除工作记录失败: {}", e))?;
    Ok(())
}

pub fn upsert_weekly_report(
    conn: &Connection,
    week_start: &str,
    week_end: &str,
    role: &str,
    style: &str,
    summary: &str,
    next_plan: &str,
) -> Result<WeeklyReport, String> {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "INSERT INTO weekly_reports (week_start, week_end, role, style, summary, next_plan, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(week_start) DO UPDATE SET
           week_end = excluded.week_end,
           role = excluded.role,
           style = excluded.style,
           summary = excluded.summary,
           next_plan = excluded.next_plan,
           updated_at = excluded.updated_at",
        params![week_start, week_end, role, style, summary, next_plan, now],
    )
    .map_err(|e| format!("保存周报失败: {}", e))?;

    get_weekly_report_by_week(conn, week_start)?
        .ok_or_else(|| "保存后读取周报失败".to_string())
}

pub fn get_weekly_report_by_week(
    conn: &Connection,
    week_start: &str,
) -> Result<Option<WeeklyReport>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, week_start, week_end, role, style, summary, next_plan, created_at, updated_at
             FROM weekly_reports
             WHERE week_start = ?1",
        )
        .map_err(|e| format!("查询周报失败: {}", e))?;

    let mut rows = stmt
        .query_map(params![week_start], |row| {
            Ok(WeeklyReport {
                id: row.get(0)?,
                week_start: row.get(1)?,
                week_end: row.get(2)?,
                role: row.get(3)?,
                style: row.get(4)?,
                summary: row.get(5)?,
                next_plan: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("读取周报失败: {}", e))?;

    if let Some(item) = rows.next() {
        Ok(Some(item.map_err(|e| format!("解析周报失败: {}", e))?))
    } else {
        Ok(None)
    }
}

pub fn list_weekly_reports(conn: &Connection) -> Result<Vec<WeeklyReport>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, week_start, week_end, role, style, summary, next_plan, created_at, updated_at
             FROM weekly_reports
             ORDER BY week_start DESC",
        )
        .map_err(|e| format!("查询历史周报失败: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(WeeklyReport {
                id: row.get(0)?,
                week_start: row.get(1)?,
                week_end: row.get(2)?,
                role: row.get(3)?,
                style: row.get(4)?,
                summary: row.get(5)?,
                next_plan: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("读取历史周报失败: {}", e))?;

    let mut list = Vec::new();
    for item in rows {
        list.push(item.map_err(|e| format!("解析历史周报失败: {}", e))?);
    }
    Ok(list)
}

pub fn delete_weekly_report(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM weekly_reports WHERE id = ?1", params![id])
        .map_err(|e| format!("删除历史周报失败: {}", e))?;
    Ok(())
}

/// Looks up the archived `next_plan` from the week immediately preceding `week_start` (7 days earlier).
/// Returns `Ok(None)` when no prior report exists or its `next_plan` is blank.
pub fn get_previous_week_plan(
    conn: &Connection,
    week_start: &str,
) -> Result<Option<String>, String> {
    let parsed = match NaiveDate::parse_from_str(week_start.trim(), "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return Ok(None),
    };
    let prev_week_start = (parsed - ChronoDuration::days(7))
        .format("%Y-%m-%d")
        .to_string();

    let report = get_weekly_report_by_week(conn, &prev_week_start)?;
    Ok(report
        .map(|r| r.next_plan.trim().to_string())
        .filter(|plan| !plan.is_empty()))
}

pub fn get_settings(conn: &Connection) -> Result<AppSettings, String> {
    let mut settings = AppSettings::default();
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| format!("查询设置失败: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("读取设置失败: {}", e))?;

    for row in rows {
        let (k, v) = row.map_err(|e| format!("解析设置失败: {}", e))?;
        match k.as_str() {
            "api_key" => settings.api_key = v,
            "model" if !v.trim().is_empty() => settings.model = v,
            "default_role" if !v.trim().is_empty() => {
                settings.default_role = normalize_role_preset(&v).to_string();
            }
            "custom_role" => settings.custom_role = v,
            "default_style" if !v.trim().is_empty() => {
                settings.default_style = normalize_report_style(&v).to_string();
            }
            "report_format" if !v.trim().is_empty() => {
                settings.report_format = normalize_report_format(&v).to_string();
            }
            "report_custom_instructions" => settings.report_custom_instructions = v,
            "include_last_week_plan" => settings.include_last_week_plan = v == "true",
            "reminder_enabled" => settings.reminder_enabled = v == "true",
            "reminder_time" if !v.trim().is_empty() => settings.reminder_time = v,
            "shortcut" if !v.trim().is_empty() => settings.shortcut = v,
            "theme" if v == "light" || v == "dark" => settings.theme = v,
            "auto_check_update" => settings.auto_check_update = v == "true",
            "skipped_version" => settings.skipped_version = v,
            "webdav_enabled" => settings.webdav_enabled = v == "true",
            "webdav_url" if !v.trim().is_empty() => settings.webdav_url = v,
            "webdav_username" => settings.webdav_username = v,
            "webdav_password" => settings.webdav_password = v,
            "webdav_sync_interval_mins" => {
                if let Ok(mins) = v.trim().parse::<u32>() {
                    settings.webdav_sync_interval_mins = mins.clamp(1, 120);
                }
            }
            _ => {}
        }
    }

    Ok(settings)
}

pub fn save_settings(conn: &mut Connection, settings: &AppSettings) -> Result<(), String> {
    let default_role = normalize_role_preset(&settings.default_role);
    let custom_role = settings.custom_role.trim();
    if default_role == "custom" && custom_role.is_empty() {
        return Err("已选择「自定义岗位」，请先填写自定义默认岗位名称".to_string());
    }

    let default_style = normalize_report_style(&settings.default_style);
    let report_format = normalize_report_format(&settings.report_format);
    let report_custom_instructions = settings.report_custom_instructions.trim();
    if report_custom_instructions.chars().count() > MAX_CUSTOM_INSTRUCTIONS_CHARS {
        return Err(format!(
            "附加撰写规范不能超过 {} 个字符",
            MAX_CUSTOM_INSTRUCTIONS_CHARS
        ));
    }

    let clamped_interval = settings.webdav_sync_interval_mins.clamp(1, 120).to_string();
    let webdav_url = if settings.webdav_url.trim().is_empty() {
        DEFAULT_WEBDAV_URL
    } else {
        settings.webdav_url.trim()
    };

    let pairs = [
        ("api_key", settings.api_key.as_str()),
        (
            "model",
            if settings.model.trim().is_empty() {
                "deepseek-flash"
            } else {
                settings.model.trim()
            },
        ),
        ("default_role", default_role),
        ("custom_role", custom_role),
        ("default_style", default_style),
        ("report_format", report_format),
        ("report_custom_instructions", report_custom_instructions),
        (
            "include_last_week_plan",
            if settings.include_last_week_plan {
                "true"
            } else {
                "false"
            },
        ),
        (
            "reminder_enabled",
            if settings.reminder_enabled {
                "true"
            } else {
                "false"
            },
        ),
        ("reminder_time", settings.reminder_time.as_str()),
        ("shortcut", settings.shortcut.as_str()),
        ("theme", settings.theme.as_str()),
        (
            "webdav_enabled",
            if settings.webdav_enabled {
                "true"
            } else {
                "false"
            },
        ),
        ("webdav_url", webdav_url),
        ("webdav_username", settings.webdav_username.trim()),
        ("webdav_password", settings.webdav_password.as_str()),
        ("webdav_sync_interval_mins", clamped_interval.as_str()),
    ];

    // Update preferences are saved independently of the settings form.
    save_setting_pairs(conn, pairs)
}

pub fn update_update_preferences(
    conn: &mut Connection,
    auto_check_update: Option<bool>,
    skipped_version: Option<&str>,
) -> Result<(), String> {
    let auto = auto_check_update.map(|on| ("auto_check_update", if on { "true" } else { "false" }));
    let skip = skipped_version.map(|version| ("skipped_version", version));
    save_setting_pairs(conn, [auto, skip].into_iter().flatten())
}

fn save_setting_pairs<'a>(
    conn: &mut Connection,
    pairs: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启设置保存事务失败: {}", e))?;

    for (key, value) in pairs {
        tx.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| format!("保存设置项 {} 失败: {}", key, e))?;
    }

    tx.commit()
        .map_err(|e| format!("提交设置保存事务失败: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_preferences_survive_legacy_settings_and_stale_form_saves() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let mut form = get_settings(&conn).unwrap();
        assert!(form.auto_check_update);
        assert!(form.skipped_version.is_empty());

        let mut legacy = serde_json::to_value(&form).unwrap();
        legacy.as_object_mut().unwrap().remove("auto_check_update");
        legacy.as_object_mut().unwrap().remove("skipped_version");
        let legacy: AppSettings = serde_json::from_value(legacy).unwrap();
        assert!(legacy.auto_check_update && legacy.skipped_version.is_empty());

        update_update_preferences(&mut conn, Some(false), None).unwrap();
        update_update_preferences(&mut conn, None, Some("1.2.0")).unwrap();
        form.theme = "dark".into();
        save_settings(&mut conn, &form).unwrap();
        let saved = get_settings(&conn).unwrap();
        assert_eq!(saved.theme, "dark");
        assert!(!saved.auto_check_update);
        assert_eq!(saved.skipped_version, "1.2.0");
    }

    #[test]
    fn test_schema_migration_and_remote_idempotency() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let local = add_work_log(&conn, "本地记录", Some("2026-11-20".to_string())).unwrap();
        assert!(!local.is_remote);

        let remote1 = add_remote_work_log(
            &conn,
            "手机端记录",
            "2026-11-20",
            "9:05",
            "webdav:20261120-090500.json",
        )
        .unwrap();
        assert!(remote1.is_some());
        let r = remote1.unwrap();
        assert!(r.is_remote);
        assert_eq!(r.log_date, "2026-11-20");
        assert_eq!(r.log_time, "09:05");

        // Duplicate external_id must be ignored idempotently
        let dup = add_remote_work_log(
            &conn,
            "手机端记录重复",
            "2026-11-20",
            "09:05",
            "webdav:20261120-090500.json",
        )
        .unwrap();
        assert!(dup.is_none());

        let logs = get_work_logs(&conn, "2026-11-16", "2026-11-22").unwrap();
        assert_eq!(logs.len(), 2);
        assert_eq!(logs.iter().filter(|l| l.is_remote).count(), 1);
    }

    #[test]
    fn test_webdav_settings_roundtrip() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let mut s = AppSettings::default();
        s.webdav_enabled = true;
        s.webdav_url = "https://dav.jianguoyun.com/dav/WeekLoom/inbox/".to_string();
        s.webdav_username = "alice@example.com".to_string();
        s.webdav_password = "app-secret-password".to_string();
        s.webdav_sync_interval_mins = 15;

        save_settings(&mut conn, &s).unwrap();
        let loaded = get_settings(&conn).unwrap();
        assert!(loaded.webdav_enabled);
        assert_eq!(loaded.webdav_url, s.webdav_url);
        assert_eq!(loaded.webdav_username, "alice@example.com");
        assert_eq!(loaded.webdav_password, "app-secret-password");
        assert_eq!(loaded.webdav_sync_interval_mins, 15);
    }

    #[test]
    fn test_v3_migration_from_legacy_chinese_preferences() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE work_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                log_date TEXT NOT NULL,
                log_time TEXT NOT NULL,
                external_id TEXT
            );
            CREATE TABLE weekly_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_start TEXT NOT NULL UNIQUE,
                week_end TEXT NOT NULL,
                role TEXT NOT NULL,
                style TEXT NOT NULL,
                summary TEXT NOT NULL,
                next_plan TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            INSERT INTO settings (key, value) VALUES ('default_role', '研发 / 技术');
            INSERT INTO settings (key, value) VALUES ('default_style', '突出成果');
            PRAGMA user_version = 2;
            ",
        )
        .unwrap();

        init_schema(&conn).unwrap();

        let loaded = get_settings(&conn).unwrap();
        assert_eq!(loaded.default_role, "tech");
        assert_eq!(loaded.default_style, "impact");
        assert_eq!(loaded.report_format, "plain");
        assert!(loaded.include_last_week_plan);
    }

    #[test]
    fn test_report_preferences_validation_and_roundtrip() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        // Blank custom role should be rejected cleanly without mutating DB
        let mut invalid = AppSettings::default();
        invalid.default_role = "custom".to_string();
        invalid.custom_role = "   ".to_string();
        invalid.default_style = "detailed".to_string();
        assert!(save_settings(&mut conn, &invalid).is_err());
        assert_eq!(get_settings(&conn).unwrap().default_style, "concise");

        // Valid preferences should persist with trimming
        let mut valid = AppSettings::default();
        valid.default_role = "custom".to_string();
        valid.custom_role = "  跨境电商运营  ".to_string();
        valid.default_style = "detailed".to_string();
        valid.report_format = "markdown".to_string();
        valid.report_custom_instructions = "  限 300 字内；突出转化率  ".to_string();
        valid.include_last_week_plan = false;

        save_settings(&mut conn, &valid).unwrap();
        let loaded = get_settings(&conn).unwrap();
        assert_eq!(loaded.default_role, "custom");
        assert_eq!(loaded.custom_role, "跨境电商运营");
        assert_eq!(loaded.default_style, "detailed");
        assert_eq!(loaded.report_format, "markdown");
        assert_eq!(loaded.report_custom_instructions, "限 300 字内；突出转化率");
        assert!(!loaded.include_last_week_plan);
    }

    #[test]
    fn test_get_previous_week_plan() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        assert_eq!(get_previous_week_plan(&conn, "2026-11-16").unwrap(), None);

        upsert_weekly_report(
            &conn,
            "2026-11-09",
            "2026-11-15",
            "tech",
            "concise",
            "1. 完成支付链路重构",
            "1. 推进灰度发布与压测\n2. 补齐告警看板",
        )
        .unwrap();

        let prev_plan = get_previous_week_plan(&conn, "2026-11-16").unwrap();
        assert_eq!(
            prev_plan.as_deref(),
            Some("1. 推进灰度发布与压测\n2. 补齐告警看板")
        );
    }
}
