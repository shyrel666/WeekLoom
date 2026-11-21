use crate::db::{self, AppSettings, DbState, DEFAULT_WEBDAV_SYNC_INTERVAL_MINS, DEFAULT_WEBDAV_URL};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{DateTime, Local, NaiveDate};
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use url::Url;

const MAX_REMOTE_FILE_BYTES: u64 = 128 * 1024; // 128 KB safety cap
const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
    <D:getlastmodified/>
    <D:getcontentlength/>
  </D:prop>
</D:propfind>"#;

#[derive(Debug, Clone)]
pub struct WebDavConfig {
    pub enabled: bool,
    pub url: String,
    pub username: String,
    pub password: String,
    pub sync_interval_mins: u32,
}

impl From<&AppSettings> for WebDavConfig {
    fn from(s: &AppSettings) -> Self {
        Self {
            enabled: s.webdav_enabled,
            url: if s.webdav_url.trim().is_empty() {
                DEFAULT_WEBDAV_URL.to_string()
            } else {
                s.webdav_url.trim().to_string()
            },
            username: s.webdav_username.trim().to_string(),
            password: s.webdav_password.clone(),
            sync_interval_mins: if s.webdav_sync_interval_mins == 0 {
                DEFAULT_WEBDAV_SYNC_INTERVAL_MINS
            } else {
                s.webdav_sync_interval_mins.clamp(1, 120)
            },
        }
    }
}

impl WebDavConfig {
    pub fn is_configured(&self) -> bool {
        !self.url.trim().is_empty()
            && !self.username.trim().is_empty()
            && !self.password.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WebDavSyncStatus {
    pub syncing: bool,
    pub last_sync_at: Option<String>,
    pub last_imported_count: usize,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDavSyncResult {
    pub imported_count: usize,
    pub skipped_duplicates: usize,
    pub skipped_invalid: usize,
    pub failed_deletes: usize,
    pub synced_at: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MobileHelperInfo {
    pub inbox_url: String,
    pub auth_header: String,
    pub sample_json_body: String,
    pub curl_command: String,
    pub android_shortcuts_json: String,
}

pub struct WebDavState {
    pub config: Arc<Mutex<WebDavConfig>>,
    pub status: Arc<Mutex<WebDavSyncStatus>>,
    pub sync_lock: Arc<tokio::sync::Mutex<()>>,
}

impl WebDavState {
    pub fn new(config: WebDavConfig) -> Self {
        Self {
            config: Arc::new(Mutex::new(config)),
            status: Arc::new(Mutex::new(WebDavSyncStatus::default())),
            sync_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub fn update_config(&self, next: WebDavConfig) {
        if let Ok(mut guard) = self.config.lock() {
            *guard = next;
        }
    }

    pub fn snapshot_config(&self) -> WebDavConfig {
        self.config
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| WebDavConfig {
                enabled: false,
                url: DEFAULT_WEBDAV_URL.to_string(),
                username: String::new(),
                password: String::new(),
                sync_interval_mins: DEFAULT_WEBDAV_SYNC_INTERVAL_MINS,
            })
    }

    pub fn snapshot_status(&self) -> WebDavSyncStatus {
        self.status
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PropfindEntry {
    url: Url,
    filename: String,
    last_modified: Option<String>,
    content_length: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RemoteJsonPayload {
    content: Option<String>,
    text: Option<String>,
    log_date: Option<String>,
    date: Option<String>,
    log_time: Option<String>,
    time: Option<String>,
    id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedRemoteLog {
    external_id: String,
    content: String,
    log_date: String,
    log_time: String,
}

fn build_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("初始化 WebDAV 网络客户端失败: {}", e))
}

pub fn normalize_inbox_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("请填写 WebDAV 收件箱目录地址".to_string());
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("WebDAV 地址必须以 https:// 或 http:// 开头".to_string());
    }

    let mut parsed =
        Url::parse(trimmed).map_err(|_| "WebDAV 地址格式无效，请检查 URL 拼写".to_string())?;
    parsed.set_query(None);
    parsed.set_fragment(None);

    if !parsed.path().ends_with('/') {
        let with_slash = format!("{}/", parsed.path());
        parsed.set_path(&with_slash);
    }

    Ok(parsed)
}

fn map_reqwest_error(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "连接超时：WebDAV 服务器响应较慢或网络不稳定，请稍后重试".to_string()
    } else if err.is_connect() {
        "无法连接到 WebDAV 服务器，请检查网络连接、地址或代理设置".to_string()
    } else {
        format!("WebDAV 网络请求失败：{}", err)
    }
}

fn map_webdav_status_error(status: StatusCode) -> String {
    match status.as_u16() {
        401 => "认证失败（401）：请检查账号和密码；若使用坚果云，请务必填写「第三方应用管理」生成的专用应用密码，而非登录密码".to_string(),
        403 => "访问被拒绝（403）：请确认账号有权限读写该目录（坚果云需指向 /dav/ 下的子目录，如 /dav/WeekLoom/inbox/）".to_string(),
        404 => "远端收件箱目录不存在（404），请点击「测试并初始化目录」自动创建".to_string(),
        405 => "服务器不支持当前 WebDAV 方法（405），请确认填写的是标准 WebDAV 地址".to_string(),
        409 => "远端上级目录不存在（409），请点击「测试并初始化目录」自动创建多级目录".to_string(),
        429 | 503 => format!(
            "WebDAV 触发限流或服务繁忙（HTTP {}），已自动降低同步频率，请稍后再试",
            status.as_u16()
        ),
        500..=599 => format!("WebDAV 服务器暂时不可用（HTTP {}），请稍后重试", status.as_u16()),
        _ => format!("WebDAV 返回异常状态码（HTTP {}）", status.as_u16()),
    }
}

fn is_rate_limited_error(msg: &str) -> bool {
    msg.contains("429") || msg.contains("503") || msg.contains("限流")
}

fn parent_directory_url(url: &Url) -> Option<Url> {
    let segments: Vec<&str> = url
        .path_segments()
        .map(|s| s.filter(|seg| !seg.is_empty()).collect())
        .unwrap_or_default();
    if segments.len() <= 1 {
        return None;
    }
    let mut parent = url.clone();
    let parent_path = format!("/{}/", segments[..segments.len() - 1].join("/"));
    parent.set_path(&parent_path);
    Some(parent)
}

async fn mkcol_recursive(
    client: &reqwest::Client,
    target: &Url,
    username: &str,
    password: &str,
    depth: u8,
) -> Result<(), String> {
    if depth > 6 {
        return Err("创建 WebDAV 多级目录层级过深，请先在网盘内手动创建目标文件夹".to_string());
    }

    let mkcol = Method::from_bytes(b"MKCOL").map_err(|e| e.to_string())?;
    let resp = client
        .request(mkcol, target.clone())
        .basic_auth(username, Some(password))
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = resp.status();
    if status.is_success() || status == StatusCode::METHOD_NOT_ALLOWED {
        return Ok(());
    }

    if status == StatusCode::CONFLICT {
        if let Some(parent) = parent_directory_url(target) {
            Box::pin(mkcol_recursive(client, &parent, username, password, depth + 1)).await?;
            let retry_mkcol = Method::from_bytes(b"MKCOL").map_err(|e| e.to_string())?;
            let retry_resp = client
                .request(retry_mkcol, target.clone())
                .basic_auth(username, Some(password))
                .send()
                .await
                .map_err(map_reqwest_error)?;
            let retry_status = retry_resp.status();
            if retry_status.is_success() || retry_status == StatusCode::METHOD_NOT_ALLOWED {
                return Ok(());
            }
            return Err(map_webdav_status_error(retry_status));
        }
    }

    Err(map_webdav_status_error(status))
}

async fn ensure_inbox_directory(
    client: &reqwest::Client,
    inbox_url: &Url,
    username: &str,
    password: &str,
) -> Result<bool, String> {
    let propfind = Method::from_bytes(b"PROPFIND").map_err(|e| e.to_string())?;
    let probe = client
        .request(propfind, inbox_url.clone())
        .basic_auth(username, Some(password))
        .header("Depth", "0")
        .header("Content-Type", "application/xml; charset=utf-8")
        .body(PROPFIND_BODY)
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = probe.status();
    if status.is_success() || status == StatusCode::MULTI_STATUS {
        return Ok(false); // already existed
    }

    if status == StatusCode::NOT_FOUND || status == StatusCode::CONFLICT {
        mkcol_recursive(client, inbox_url, username, password, 0).await?;
        return Ok(true); // newly created
    }

    Err(map_webdav_status_error(status))
}

async fn list_inbox_entries(
    client: &reqwest::Client,
    inbox_url: &Url,
    username: &str,
    password: &str,
) -> Result<Vec<PropfindEntry>, String> {
    let propfind = Method::from_bytes(b"PROPFIND").map_err(|e| e.to_string())?;
    let resp = client
        .request(propfind, inbox_url.clone())
        .basic_auth(username, Some(password))
        .header("Depth", "1")
        .header("Content-Type", "application/xml; charset=utf-8")
        .body(PROPFIND_BODY)
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = resp.status();
    if !status.is_success() && status != StatusCode::MULTI_STATUS {
        return Err(map_webdav_status_error(status));
    }

    let xml = resp
        .text()
        .await
        .map_err(|e| format!("读取 WebDAV 目录列表失败: {}", e))?;

    parse_propfind_entries(&xml, inbox_url)
}

fn percent_decode_str(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h1), Some(h2)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h1 << 4) | h2);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn decode_xml_entity(raw: &str) -> Option<String> {
    match raw {
        "amp" => Some("&".to_string()),
        "lt" => Some("<".to_string()),
        "gt" => Some(">".to_string()),
        "quot" => Some("\"".to_string()),
        "apos" => Some("'".to_string()),
        _ => {
            if let Some(hex) = raw.strip_prefix("#x").or_else(|| raw.strip_prefix("#X")) {
                u32::from_str_radix(hex, 16)
                    .ok()
                    .and_then(char::from_u32)
                    .map(|c| c.to_string())
            } else if let Some(dec) = raw.strip_prefix('#') {
                dec.parse::<u32>()
                    .ok()
                    .and_then(char::from_u32)
                    .map(|c| c.to_string())
            } else {
                None
            }
        }
    }
}

fn is_supported_inbox_file(filename: &str) -> bool {
    if filename.is_empty() || filename.starts_with('.') {
        return false;
    }
    let lower = filename.to_lowercase();
    lower.ends_with(".json") || lower.ends_with(".txt") || lower.ends_with(".md")
}

fn parse_propfind_entries(xml: &str, inbox_url: &Url) -> Result<Vec<PropfindEntry>, String> {
    let mut reader = Reader::from_str(xml);
    let mut entries = Vec::new();

    let mut in_response = false;
    let mut in_resourcetype = false;
    let mut active_field: Option<&'static str> = None;
    let mut field_buf = String::new();

    let mut cur_href: Option<String> = None;
    let mut cur_is_collection = false;
    let mut cur_last_modified: Option<String> = None;
    let mut cur_content_length: Option<u64> = None;

    let normalized_inbox_path = percent_decode_str(inbox_url.path().trim_end_matches('/'));

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let local = e.local_name();
                let name = local.as_ref();
                if name.eq_ignore_ascii_case("response") {
                    in_response = true;
                    in_resourcetype = false;
                    active_field = None;
                    field_buf.clear();
                    cur_href = None;
                    cur_is_collection = false;
                    cur_last_modified = None;
                    cur_content_length = None;
                } else if in_response {
                    if name.eq_ignore_ascii_case("resourcetype") {
                        in_resourcetype = true;
                    } else if in_resourcetype && name.eq_ignore_ascii_case("collection") {
                        cur_is_collection = true;
                    } else if name.eq_ignore_ascii_case("href") && cur_href.is_none() {
                        active_field = Some("href");
                        field_buf.clear();
                    } else if name.eq_ignore_ascii_case("getlastmodified") {
                        active_field = Some("getlastmodified");
                        field_buf.clear();
                    } else if name.eq_ignore_ascii_case("getcontentlength") {
                        active_field = Some("getcontentlength");
                        field_buf.clear();
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                let local = e.local_name();
                let name = local.as_ref();
                if in_response && in_resourcetype && name.eq_ignore_ascii_case("collection") {
                    cur_is_collection = true;
                }
            }
            Ok(Event::Text(e)) => {
                if active_field.is_some() {
                    field_buf.push_str(e.as_ref());
                }
            }
            Ok(Event::CData(e)) => {
                if active_field.is_some() {
                    field_buf.push_str(e.as_ref());
                }
            }
            Ok(Event::GeneralRef(e)) => {
                if active_field.is_some() {
                    if let Some(decoded) = decode_xml_entity(e.as_ref()) {
                        field_buf.push_str(&decoded);
                    }
                }
            }
            Ok(Event::End(e)) => {
                let local = e.local_name();
                let name = local.as_ref();
                if name.eq_ignore_ascii_case("resourcetype") {
                    in_resourcetype = false;
                } else if let Some(field) = active_field {
                    if name.eq_ignore_ascii_case(field) {
                        let val = field_buf.trim().to_string();
                        if !val.is_empty() {
                            match field {
                                "href" if cur_href.is_none() => cur_href = Some(val),
                                "getlastmodified" => cur_last_modified = Some(val),
                                "getcontentlength" => {
                                    if let Ok(len) = val.parse::<u64>() {
                                        cur_content_length = Some(len);
                                    }
                                }
                                _ => {}
                            }
                        }
                        active_field = None;
                        field_buf.clear();
                    }
                }

                if name.eq_ignore_ascii_case("response") && in_response {
                    in_response = false;
                    if !cur_is_collection {
                        if let Some(href) = cur_href.take() {
                            if let Ok(resolved) = inbox_url.join(&href) {
                                let resolved_path =
                                    percent_decode_str(resolved.path().trim_end_matches('/'));
                                if resolved_path != normalized_inbox_path {
                                    let raw_name = resolved
                                        .path_segments()
                                        .and_then(|mut s| s.next_back())
                                        .unwrap_or("");
                                    let filename = percent_decode_str(raw_name);
                                    let within_size = cur_content_length
                                        .map(|len| len <= MAX_REMOTE_FILE_BYTES)
                                        .unwrap_or(true);
                                    if is_supported_inbox_file(&filename) && within_size {
                                        entries.push(PropfindEntry {
                                            url: resolved,
                                            filename,
                                            last_modified: cur_last_modified.take(),
                                            content_length: cur_content_length,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("解析 WebDAV 目录响应 XML 失败: {}", e)),
            _ => {}
        }
    }

    // Sort oldest / smallest filename first for chronological import
    entries.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(entries)
}

fn normalize_date_str(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized = trimmed.replace('/', "-");
    if let Ok(d) = NaiveDate::parse_from_str(&normalized, "%Y-%m-%d") {
        return Some(d.format("%Y-%m-%d").to_string());
    }
    if normalized.len() == 8 && normalized.bytes().all(|b| b.is_ascii_digit()) {
        if let Ok(d) = NaiveDate::parse_from_str(&normalized, "%Y%m%d") {
            return Some(d.format("%Y-%m-%d").to_string());
        }
    }
    None
}

fn normalize_time_str(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.contains(':') {
        let parts: Vec<&str> = trimmed.split(':').collect();
        if parts.len() >= 2 && parts.len() <= 3 {
            let h: u32 = parts[0].parse().ok()?;
            let m: u32 = parts[1].parse().ok()?;
            if h <= 23 && m <= 59 {
                return Some(format!("{:02}:{:02}", h, m));
            }
        }
        return None;
    }
    let digits: String = trimmed.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() == 4 || digits.len() == 6 {
        let h: u32 = digits[0..2].parse().ok()?;
        let m: u32 = digits[2..4].parse().ok()?;
        if h <= 23 && m <= 59 {
            return Some(format!("{:02}:{:02}", h, m));
        }
    }
    None
}

/// Extracts optional `(YYYY-MM-DD, HH:MM)` from common shortcut filenames such as:
/// - `20261121-182035.json`
/// - `2026-11-21_18-20-35.txt`
/// - `20261121182035.json`
/// - `2026-11-21.txt`
fn extract_datetime_from_filename(filename: &str) -> (Option<String>, Option<String>) {
    let stem = filename
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(filename);

    let bytes = stem.as_bytes();

    // Pattern A: YYYY-MM-DD (optionally followed by sep + HH-MM or HHMM)
    for i in 0..bytes.len() {
        if i + 10 <= bytes.len()
            && bytes[i + 4] == b'-'
            && bytes[i + 7] == b'-'
            && bytes[i..i + 4].iter().all(u8::is_ascii_digit)
            && bytes[i + 5..i + 7].iter().all(u8::is_ascii_digit)
            && bytes[i + 8..i + 10].iter().all(u8::is_ascii_digit)
        {
            if let Some(date) = normalize_date_str(&stem[i..i + 10]) {
                let rest = &stem[i + 10..];
                let time = extract_leading_time(rest);
                return (Some(date), time);
            }
        }
    }

    // Pattern B: YYYYMMDD (optionally followed by sep + HH-MM or HHMM)
    for i in 0..bytes.len() {
        if i + 8 <= bytes.len() && bytes[i..i + 8].iter().all(u8::is_ascii_digit) {
            if let Ok(year) = stem[i..i + 4].parse::<u32>() {
                if (2000..=2100).contains(&year) {
                    if let Some(date) = normalize_date_str(&stem[i..i + 8]) {
                        let rest = &stem[i + 8..];
                        let time = extract_leading_time(rest);
                        return (Some(date), time);
                    }
                }
            }
        }
    }

    (None, None)
}

fn extract_leading_time(rest: &str) -> Option<String> {
    let trimmed = rest.trim_start_matches(|c: char| matches!(c, '_' | '-' | ' ' | 'T' | 't'));
    let b = trimmed.as_bytes();

    // HH-MM / HH:MM / HH.MM
    if b.len() >= 5
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && matches!(b[2], b'-' | b':' | b'.')
        && b[3].is_ascii_digit()
        && b[4].is_ascii_digit()
    {
        let candidate = format!("{}:{}", &trimmed[0..2], &trimmed[3..5]);
        if let Some(t) = normalize_time_str(&candidate) {
            return Some(t);
        }
    }

    // HHMM / HHMMSS
    if b.len() >= 4 && b[0..4].iter().all(u8::is_ascii_digit) {
        let candidate = format!("{}:{}", &trimmed[0..2], &trimmed[2..4]);
        if let Some(t) = normalize_time_str(&candidate) {
            return Some(t);
        }
    }

    None
}

fn parse_http_last_modified(raw: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(s) = raw.map(str::trim).filter(|v| !v.is_empty()) else {
        return (None, None);
    };
    if let Ok(dt) = DateTime::parse_from_rfc2822(s) {
        let local = dt.with_timezone(&Local);
        return (
            Some(local.format("%Y-%m-%d").to_string()),
            Some(local.format("%H:%M").to_string()),
        );
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        let local = dt.with_timezone(&Local);
        return (
            Some(local.format("%Y-%m-%d").to_string()),
            Some(local.format("%H:%M").to_string()),
        );
    }
    (None, None)
}

fn parse_remote_file(
    filename: &str,
    body: &str,
    last_modified: Option<&str>,
) -> Option<ParsedRemoteLog> {
    let cleaned = body.trim_start_matches('\u{feff}').trim();
    if cleaned.is_empty() {
        return None;
    }

    let is_json_ext = filename.to_lowercase().ends_with(".json");
    let (file_date, file_time) = extract_datetime_from_filename(filename);
    let (mod_date, mod_time) = parse_http_last_modified(last_modified);
    let now = Local::now();

    if is_json_ext || cleaned.starts_with('{') {
        match serde_json::from_str::<RemoteJsonPayload>(cleaned) {
            Ok(payload) => {
                let raw_content = payload.content.or(payload.text).unwrap_or_default();
                let content = raw_content.replace("\r\n", "\n").trim().to_string();
                if content.is_empty() {
                    return None;
                }

                let explicit_date = payload
                    .log_date
                    .or(payload.date)
                    .and_then(|d| normalize_date_str(&d));
                let explicit_time = payload
                    .log_time
                    .or(payload.time)
                    .and_then(|t| normalize_time_str(&t));

                let log_date = explicit_date
                    .or(file_date)
                    .or(mod_date)
                    .unwrap_or_else(|| now.format("%Y-%m-%d").to_string());
                let log_time = explicit_time
                    .or(file_time)
                    .or(mod_time)
                    .unwrap_or_else(|| now.format("%H:%M").to_string());

                let id_part = payload
                    .id
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| filename.to_string());

                return Some(ParsedRemoteLog {
                    external_id: format!("webdav:{}", id_part),
                    content,
                    log_date,
                    log_time,
                });
            }
            Err(_) if is_json_ext => {
                // Malformed .json file: skip without deleting so user data isn't lost
                return None;
            }
            Err(_) => {
                // Fall through to plain text for .txt/.md files that happen to start with '{'
            }
        }
    }

    let content = cleaned.replace("\r\n", "\n");
    if content.is_empty() {
        return None;
    }

    let log_date = file_date
        .or(mod_date)
        .unwrap_or_else(|| now.format("%Y-%m-%d").to_string());
    let log_time = file_time
        .or(mod_time)
        .unwrap_or_else(|| now.format("%H:%M").to_string());

    Some(ParsedRemoteLog {
        external_id: format!("webdav:{}", filename),
        content,
        log_date,
        log_time,
    })
}

pub async fn test_and_init_webdav(
    url: &str,
    username: &str,
    password: &str,
) -> Result<String, String> {
    let inbox_url = normalize_inbox_url(url)?;
    let user = username.trim();
    if user.is_empty() {
        return Err("请填写 WebDAV 用户名（坚果云为注册邮箱）".to_string());
    }
    if password.is_empty() {
        return Err("请填写 WebDAV 密码（坚果云请使用第三方应用专用密码）".to_string());
    }

    let client = build_client(20)?;
    let created = ensure_inbox_directory(&client, &inbox_url, user, password).await?;
    let entries = list_inbox_entries(&client, &inbox_url, user, password).await?;

    if created {
        Ok(format!(
            "连接成功！已自动创建远端收件箱目录（当前有 {} 条待同步记录）",
            entries.len()
        ))
    } else {
        Ok(format!(
            "连接成功！远端收件箱目录就绪（当前有 {} 条待同步记录）",
            entries.len()
        ))
    }
}

pub async fn sync_webdav_inbox(
    app: &AppHandle,
    config: &WebDavConfig,
    notify_on_import: bool,
) -> Result<WebDavSyncResult, String> {
    let inbox_url = normalize_inbox_url(&config.url)?;
    let user = config.username.trim();
    if user.is_empty() || config.password.is_empty() {
        return Err("请先在「设置」中填写 WebDAV 账号与应用密码".to_string());
    }

    let webdav_state = app.state::<WebDavState>();
    let _guard = webdav_state.sync_lock.lock().await;

    // Mark syncing=true
    if let Ok(mut st) = webdav_state.status.lock() {
        st.syncing = true;
    }
    let _ = app.emit("webdav-status-updated", webdav_state.snapshot_status());

    let outcome: Result<WebDavSyncResult, String> = async {
        let client = build_client(25)?;
        let entries = match list_inbox_entries(&client, &inbox_url, user, &config.password).await {
            Ok(list) => list,
            Err(err) if err.contains("404") => {
                // Auto-initialize inbox directory if missing
                ensure_inbox_directory(&client, &inbox_url, user, &config.password).await?;
                Vec::new()
            }
            Err(err) => return Err(err),
        };

        let mut imported_count = 0usize;
        let mut skipped_duplicates = 0usize;
        let mut skipped_invalid = 0usize;
        let mut failed_deletes = 0usize;

        for entry in entries {
            let get_resp = match client
                .get(entry.url.clone())
                .basic_auth(user, Some(&config.password))
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => continue,
            };

            if !get_resp.status().is_success() {
                continue;
            }

            let bytes = match get_resp.bytes().await {
                Ok(b) if (b.len() as u64) <= MAX_REMOTE_FILE_BYTES => b,
                _ => {
                    skipped_invalid += 1;
                    continue;
                }
            };

            let body = String::from_utf8_lossy(&bytes);
            let Some(parsed) =
                parse_remote_file(&entry.filename, &body, entry.last_modified.as_deref())
            else {
                skipped_invalid += 1;
                continue;
            };

            let insert_res = {
                let db_state = app.state::<DbState>();
                let conn = db_state
                    .0
                    .lock()
                    .map_err(|_| "数据库锁定失败".to_string())?;
                db::add_remote_work_log(
                    &conn,
                    &parsed.content,
                    &parsed.log_date,
                    &parsed.log_time,
                    &parsed.external_id,
                )?
            };

            match insert_res {
                Some(_) => imported_count += 1,
                None => skipped_duplicates += 1,
            }

            // Delete remote inbox item after durable local insert (or confirmed duplicate)
            let del_res = client
                .delete(entry.url.clone())
                .basic_auth(user, Some(&config.password))
                .send()
                .await;
            match del_res {
                Ok(r) if r.status().is_success() || r.status() == StatusCode::NOT_FOUND => {}
                _ => failed_deletes += 1,
            }
        }

        let synced_at = Local::now().format("%H:%M:%S").to_string();
        let message = if imported_count > 0 {
            format!("同步完成：成功导入 {} 条手机端工作记录", imported_count)
        } else if skipped_invalid > 0 {
            format!("同步完成：暂无新记录（跳过 {} 个非标准文件）", skipped_invalid)
        } else {
            "同步完成：远端收件箱暂无新记录".to_string()
        };

        Ok(WebDavSyncResult {
            imported_count,
            skipped_duplicates,
            skipped_invalid,
            failed_deletes,
            synced_at,
            message,
        })
    }
    .await;

    match outcome {
        Ok(res) => {
            if let Ok(mut st) = webdav_state.status.lock() {
                st.syncing = false;
                st.last_sync_at = Some(res.synced_at.clone());
                st.last_imported_count = res.imported_count;
                st.last_error = None;
            }
            let _ = app.emit("webdav-status-updated", webdav_state.snapshot_status());

            if res.imported_count > 0 {
                let _ = app.emit("work-logs-updated", ());
                if notify_on_import {
                    let _ = app
                        .notification()
                        .builder()
                        .title("WeekLoom 远程同步")
                        .body(format!("已自动导入 {} 条手机端工作记录", res.imported_count))
                        .show();
                }
            }

            Ok(res)
        }
        Err(err) => {
            if let Ok(mut st) = webdav_state.status.lock() {
                st.syncing = false;
                st.last_error = Some(err.clone());
            }
            let _ = app.emit("webdav-status-updated", webdav_state.snapshot_status());
            Err(err)
        }
    }
}

const ANDROID_CATEGORY_ID: &str = "7f8b3c10-1000-4a10-8b10-000000000001";
const ANDROID_SHORTCUT_ID: &str = "7f8b3c10-2000-4a10-8b10-000000000001";
const ANDROID_VAR_CONTENT_ID: &str = "7f8b3c10-3000-4a10-8b10-000000000001";
const ANDROID_VAR_TS_ID: &str = "7f8b3c10-3000-4a10-8b10-000000000002";

/// Generates a ready-to-import JSON configuration strictly matching the upstream
/// Waboodoo/HTTP-Shortcuts schema (v90+, compatible with Android HTTP Shortcuts 3.28 ~ 4.8+).
pub fn build_android_http_shortcuts_json(
    inbox_url: &str,
    username: &str,
    password: &str,
) -> Result<String, String> {
    let created_at = Local::now().to_rfc3339();
    let target_url = format!("{}{{{{{}}}}}.txt", inbox_url, ANDROID_VAR_TS_ID);
    let body_content = format!("{{{{{}}}}}", ANDROID_VAR_CONTENT_ID);

    let payload = json!({
        "version": 90,
        "compatibilityVersion": 90,
        "createdAt": created_at,
        "variables": [
            {
                "id": ANDROID_VAR_CONTENT_ID,
                "key": "weekloom_content",
                "type": "text",
                "title": "今天干了啥？",
                "message": "输入内容或点键盘麦克风语音输入，点确定即发到 WeekLoom",
                "rememberValue": false,
                "urlEncode": false,
                "jsonEncode": false,
                "isShareText": true,
                "isShareTitle": false,
                "isMultiline": true,
                "isExcludeValueFromExport": false
            },
            {
                "id": ANDROID_VAR_TS_ID,
                "key": "weekloom_ts",
                "type": "timestamp",
                "data": "{\"format\":\"yyyyMMdd-HHmmss\"}",
                "rememberValue": false,
                "urlEncode": false,
                "jsonEncode": false,
                "isShareText": false,
                "isShareTitle": false,
                "isMultiline": false,
                "isExcludeValueFromExport": false
            }
        ],
        "categories": [
            {
                "id": ANDROID_CATEGORY_ID,
                "name": "WeekLoom",
                "layoutType": "linear_list",
                "shortcuts": [
                    {
                        "id": ANDROID_SHORTCUT_ID,
                        "executionType": "app",
                        "name": "记一笔 WeekLoom",
                        "description": "随时随手记一笔工作碎片（支持键盘语音输入、分享文本直发、断网自动补发）",
                        "method": "PUT",
                        "url": target_url,
                        "authentication": "basic",
                        "username": username,
                        "password": password,
                        "requestBodyType": "custom_text",
                        "contentType": "text/plain; charset=utf-8",
                        "bodyContent": body_content,
                        "timeout": 15000,
                        "waitForInternet": true,
                        "launcherShortcut": true,
                        "quickSettingsTileShortcut": true,
                        "responseHandling": {
                            "uiType": "toast",
                            "successOutput": "message",
                            "successMessage": "已发送到 WeekLoom ✓",
                            "failureOutput": "simple"
                        }
                    }
                ]
            }
        ]
    });

    serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("生成 Android HTTP Shortcuts 配置 JSON 失败: {}", e))
}

pub fn build_mobile_helper(
    url: &str,
    username: &str,
    password: &str,
) -> Result<MobileHelperInfo, String> {
    let inbox_url = normalize_inbox_url(url)?.to_string();
    let user = username.trim();
    if user.is_empty() || password.is_empty() {
        return Err("请先填写 WebDAV 用户名和应用密码，再生成手机配置参数".to_string());
    }

    let raw_creds = format!("{}:{}", user, password);
    let auth_header = format!("Basic {}", BASE64_STANDARD.encode(raw_creds.as_bytes()));

    let sample_json_body = "{\n  \"content\": \"拜访华东客户确认合同条款\",\n  \"log_date\": \"2026-11-21\",\n  \"log_time\": \"18:20\"\n}".to_string();

    // Shell-safe single-quoted strings for quick terminal testing or manual cURL import
    let esc = |s: &str| s.replace('\'', "'\\''");
    let now_stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let curl_command = format!(
        "curl -X PUT '{}{}.json' -u '{}:{}' -H 'Content-Type: application/json; charset=utf-8' -d '{{\"content\":\"测试一条来自手机的工作记录\"}}'",
        esc(&inbox_url),
        now_stamp,
        esc(user),
        esc(password)
    );

    let android_shortcuts_json = build_android_http_shortcuts_json(&inbox_url, user, password)?;

    Ok(MobileHelperInfo {
        inbox_url,
        auth_header,
        sample_json_body,
        curl_command,
        android_shortcuts_json,
    })
}

pub fn export_android_shortcuts_file(
    app: &AppHandle,
    url: &str,
    username: &str,
    password: &str,
) -> Result<String, String> {
    let helper = build_mobile_helper(url, username, password)?;
    let target_dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().desktop_dir())
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| format!("无法获取系统下载目录: {}", e))?;

    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("无法访问导出目录: {}", e))?;

    let file_path = target_dir.join("weekloom-android-shortcuts.json");
    std::fs::write(&file_path, helper.android_shortcuts_json.as_bytes())
        .map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

pub fn start_webdav_sync_loop(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Brief startup delay so UI and DB finish initializing smoothly
        tokio::time::sleep(Duration::from_secs(4)).await;

        let mut last_attempt: Option<Instant> = None;
        let mut backoff_secs: u64 = 0;

        loop {
            let cfg = app_handle.state::<WebDavState>().snapshot_config();

            if cfg.enabled && cfg.is_configured() {
                let base_interval_secs = (cfg.sync_interval_mins.clamp(1, 120) as u64) * 60;
                let required_wait = base_interval_secs.max(backoff_secs);
                let due = match last_attempt {
                    None => true,
                    Some(prev) => prev.elapsed() >= Duration::from_secs(required_wait),
                };

                if due {
                    last_attempt = Some(Instant::now());
                    match sync_webdav_inbox(&app_handle, &cfg, true).await {
                        Ok(_) => {
                            backoff_secs = 0;
                        }
                        Err(err) => {
                            if is_rate_limited_error(&err) {
                                backoff_secs = if backoff_secs == 0 {
                                    600
                                } else {
                                    (backoff_secs * 2).min(1800)
                                };
                            }
                            eprintln!("[WeekLoom] WebDAV background sync warning: {}", err);
                        }
                    }
                }
            } else {
                // Reset timer when disabled so re-enabling triggers a prompt sync
                last_attempt = None;
                backoff_secs = 0;
            }

            tokio::time::sleep(Duration::from_secs(15)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_inbox_url() {
        let u = normalize_inbox_url("https://dav.jianguoyun.com/dav/WeekLoom/inbox").unwrap();
        assert_eq!(u.as_str(), "https://dav.jianguoyun.com/dav/WeekLoom/inbox/");
        assert!(normalize_inbox_url("dav.jianguoyun.com/dav").is_err());
    }

    #[test]
    fn test_parse_propfind_nutstore_xml() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/dav/WeekLoom/inbox/</d:href>
            <d:propstat>
              <d:prop>
                <d:resourcetype><d:collection/></d:resourcetype>
                <d:getlastmodified>Sat, 21 Nov 2026 10:00:00 GMT</d:getlastmodified>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
          <d:response>
            <d:href>/dav/WeekLoom/inbox/20261121-182035.json</d:href>
            <d:propstat>
              <d:prop>
                <d:resourcetype/>
                <d:getcontentlength>96</d:getcontentlength>
                <d:getlastmodified>Sat, 21 Nov 2026 10:20:35 GMT</d:getlastmodified>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>
          <d:response>
            <d:href>/dav/WeekLoom/inbox/.DS_Store</d:href>
            <d:propstat>
              <d:prop><d:resourcetype/><d:getcontentlength>6148</d:getcontentlength></d:prop>
            </d:propstat>
          </d:response>
          <d:response>
            <d:href>/dav/WeekLoom/inbox/2026-11-20_09-15-00%20note.txt</d:href>
            <d:propstat>
              <d:prop>
                <d:resourcetype/>
                <d:getcontentlength>42</d:getcontentlength>
              </d:prop>
            </d:propstat>
          </d:response>
        </d:multistatus>"#;

        let base = Url::parse("https://dav.jianguoyun.com/dav/WeekLoom/inbox/").unwrap();
        let entries = parse_propfind_entries(xml, &base).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].filename, "2026-11-20_09-15-00 note.txt");
        assert_eq!(entries[1].filename, "20261121-182035.json");
        assert_eq!(
            entries[1].url.as_str(),
            "https://dav.jianguoyun.com/dav/WeekLoom/inbox/20261121-182035.json"
        );
    }

    #[test]
    fn test_extract_datetime_from_filename_patterns() {
        assert_eq!(
            extract_datetime_from_filename("20261121-182035.json"),
            (Some("2026-11-21".to_string()), Some("18:20".to_string()))
        );
        assert_eq!(
            extract_datetime_from_filename("2026-11-21_09-05-12.txt"),
            (Some("2026-11-21".to_string()), Some("09:05".to_string()))
        );
        assert_eq!(
            extract_datetime_from_filename("20261121143022.json"),
            (Some("2026-11-21".to_string()), Some("14:30".to_string()))
        );
        assert_eq!(
            extract_datetime_from_filename("2026-11-19.txt"),
            (Some("2026-11-19".to_string()), None)
        );
    }

    #[test]
    fn test_parse_remote_file_json_and_plaintext() {
        let json_body = r#"{"content":"拜访华东客户","log_date":"2026-11-20","log_time":"16:40"}"#;
        let parsed = parse_remote_file("msg1.json", json_body, None).unwrap();
        assert_eq!(parsed.content, "拜访华东客户");
        assert_eq!(parsed.log_date, "2026-11-20");
        assert_eq!(parsed.log_time, "16:40");
        assert_eq!(parsed.external_id, "webdav:msg1.json");

        // The iPhone template adds milliseconds to distinguish rapid entries.
        let minimal_json = r#"{"content":"地铁上改完需求文档"}"#;
        for name in ["20261121-183045.json", "20261121-183045-042.json"] {
            let parsed = parse_remote_file(name, minimal_json, None).unwrap();
            assert_eq!(parsed.content, "地铁上改完需求文档");
            assert_eq!(parsed.log_date, "2026-11-21");
            assert_eq!(parsed.log_time, "18:30");
        }

        // Plaintext .txt with filename timestamp
        let txt = "  外勤完成设备巡检  \r\n";
        let parsed3 = parse_remote_file("2026-11-18_11-25-00.txt", txt, None).unwrap();
        assert_eq!(parsed3.content, "外勤完成设备巡检");
        assert_eq!(parsed3.log_date, "2026-11-18");
        assert_eq!(parsed3.log_time, "11:25");

        // Broken .json should return None (not blindly import garbage)
        assert!(parse_remote_file("bad.json", "{not valid json", None).is_none());
    }

    #[test]
    fn test_build_mobile_helper() {
        let info = build_mobile_helper(
            "https://dav.jianguoyun.com/dav/WeekLoom/inbox",
            "alice@example.com",
            "secret-pass",
        )
        .unwrap();
        assert_eq!(info.inbox_url, "https://dav.jianguoyun.com/dav/WeekLoom/inbox/");
        assert!(info.auth_header.starts_with("Basic "));
        assert!(info.curl_command.contains("curl -X PUT"));
        assert!(info.curl_command.contains("alice@example.com:secret-pass"));

        // Verify Android HTTP Shortcuts v90 schema strictly
        let parsed: serde_json::Value =
            serde_json::from_str(&info.android_shortcuts_json).unwrap();
        assert_eq!(parsed["version"], 90);
        assert_eq!(parsed["compatibilityVersion"], 90);
        let vars = parsed["variables"].as_array().unwrap();
        assert_eq!(vars.len(), 2);
        assert_eq!(vars[0]["type"], "text");
        assert_eq!(vars[0]["isMultiline"], true);
        assert_eq!(vars[0]["isShareText"], true);
        assert_eq!(vars[1]["type"], "timestamp");
        let ts_data: serde_json::Value =
            serde_json::from_str(vars[1]["data"].as_str().unwrap()).unwrap();
        assert_eq!(ts_data["format"], "yyyyMMdd-HHmmss");

        let shortcut = &parsed["categories"][0]["shortcuts"][0];
        assert_eq!(shortcut["method"], "PUT");
        assert_eq!(shortcut["authentication"], "basic");
        assert_eq!(shortcut["username"], "alice@example.com");
        assert_eq!(shortcut["password"], "secret-pass");
        assert_eq!(shortcut["requestBodyType"], "custom_text");
        assert_eq!(shortcut["waitForInternet"], true);
        assert!(shortcut["url"]
            .as_str()
            .unwrap()
            .ends_with(&format!("{{{{{}}}}}.txt", ANDROID_VAR_TS_ID)));
        assert_eq!(
            shortcut["bodyContent"].as_str().unwrap(),
            format!("{{{{{}}}}}", ANDROID_VAR_CONTENT_ID)
        );
    }

    #[test]
    fn test_mock_webdav_init_and_list_e2e() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::atomic::{AtomicBool, Ordering};

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        let parent_created = Arc::new(AtomicBool::new(false));
        let inbox_created = Arc::new(AtomicBool::new(false));
        let parent_flag = parent_created.clone();
        let inbox_flag = inbox_created.clone();

        let server_thread = std::thread::spawn(move || {
            let expected_auth = format!(
                "basic {}",
                BASE64_STANDARD.encode("alice@example.com:app-pass")
            )
            .to_lowercase();

            // Handle up to 5 requests for the init + list flow
            for _ in 0..5 {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    continue;
                }
                let req = String::from_utf8_lossy(&buf[..n]);
                let first_line = req.lines().next().unwrap_or("");
                let mut parts = first_line.split_whitespace();
                let method = parts.next().unwrap_or("");
                let path = parts.next().unwrap_or("");

                let auth_ok = req
                    .lines()
                    .any(|l| l.to_lowercase().starts_with("authorization:") && l.to_lowercase().contains(&expected_auth));

                if !auth_ok {
                    let _ = stream.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue;
                }

                match (method, path) {
                    ("PROPFIND", "/dav/WeekLoom/inbox/") if !inbox_flag.load(Ordering::SeqCst) => {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                    ("MKCOL", "/dav/WeekLoom/inbox/") if !parent_flag.load(Ordering::SeqCst) => {
                        let _ = stream.write_all(b"HTTP/1.1 409 Conflict\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                    ("MKCOL", "/dav/WeekLoom/") => {
                        parent_flag.store(true, Ordering::SeqCst);
                        let _ = stream.write_all(b"HTTP/1.1 201 Created\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                    ("MKCOL", "/dav/WeekLoom/inbox/") => {
                        inbox_flag.store(true, Ordering::SeqCst);
                        let _ = stream.write_all(b"HTTP/1.1 201 Created\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                    ("PROPFIND", "/dav/WeekLoom/inbox/") => {
                        let xml = r#"<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/WeekLoom/inbox/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/dav/WeekLoom/inbox/20261121-120000.json</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>48</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>"#;
                        let resp = format!(
                            "HTTP/1.1 207 Multi-Status\r\nContent-Type: application/xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            xml.len(),
                            xml
                        );
                        let _ = stream.write_all(resp.as_bytes());
                    }
                    _ => {
                        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                }
            }
        });

        let url = format!("http://{}/dav/WeekLoom/inbox", addr);
        let msg = tauri::async_runtime::block_on(test_and_init_webdav(
            &url,
            "alice@example.com",
            "app-pass",
        ))
        .unwrap();

        server_thread.join().unwrap();
        assert!(parent_created.load(Ordering::SeqCst));
        assert!(inbox_created.load(Ordering::SeqCst));
        assert!(msg.contains("已自动创建远端收件箱目录"));
        assert!(msg.contains("1 条待同步记录"));
    }
}
