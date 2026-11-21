use crate::{db::DB_FILENAME, tray::AppQuittingState};
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::PublicKey;
use reqwest::{Client, StatusCode};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{env::consts, path::PathBuf, sync::atomic::Ordering, time::Duration};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use url::Url;

const REPO_URL: &str = "https://github.com/shyrel666/WeekLoom";
const LATEST_RELEASE_API: &str = "https://api.github.com/repos/shyrel666/WeekLoom/releases/latest";

#[derive(Serialize)]
pub struct AppInfo {
    name: String,
    version: String,
    platform: &'static str,
    arch: &'static str,
    tauri_version: &'static str,
    app_data_dir: PathBuf,
    db_path: PathBuf,
    repo_url: &'static str,
    updater_configured: bool,
}

// Tauri signer writes base64-encoded Minisign public key files.
fn valid_updater_key(key: &str) -> bool {
    STANDARD
        .decode(key)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .is_some_and(|text| PublicKey::decode(&text).is_ok())
}

#[tauri::command]
pub fn get_app_info(app: AppHandle) -> Result<AppInfo, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法读取应用数据目录")?;
    let updater_configured = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config["pubkey"].as_str())
        .is_some_and(valid_updater_key);
    Ok(AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
        platform: consts::OS,
        arch: consts::ARCH,
        tauri_version: tauri::VERSION,
        db_path: app_data_dir.join(DB_FILENAME),
        app_data_dir,
        repo_url: REPO_URL,
        updater_configured,
    })
}

#[tauri::command]
pub fn set_app_quitting(state: State<'_, AppQuittingState>, quitting: bool) {
    state.0.store(quitting, Ordering::SeqCst);
}

fn https_url(value: &str) -> Option<Url> {
    let (scheme, authority) = value.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("https") || authority.starts_with(['/', '\\']) {
        return None;
    }
    let url = Url::parse(value).ok()?;
    (url.scheme() == "https"
        && url.has_host()
        && url.username().is_empty()
        && url.password().is_none())
    .then_some(url)
}

#[tauri::command]
pub fn open_https_url(app: AppHandle, url: String) -> Result<(), String> {
    let url = https_url(&url).ok_or("只支持打开有效的 HTTPS 网页链接。")?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "无法打开链接，请检查系统默认浏览器。".into())
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    published_at: Option<String>,
    body: Option<String>,
    html_url: String,
    assets: Vec<Asset>,
}

#[derive(Serialize)]
pub struct ReleaseInfo {
    version: String,
    published_at: Option<String>,
    body: String,
    release_url: String,
    download_url: Option<String>,
}

fn newer_version(current: &Version, tag: &str) -> Result<Option<Version>, String> {
    let version = Version::parse(tag.strip_prefix('v').unwrap_or(tag))
        .map_err(|_| "发行版的版本号格式暂时无法识别，请在 GitHub 查看。")?;
    Ok(version.cmp_precedence(current).is_gt().then_some(version))
}

fn installer_rank(name: &str, platform: &str, arch: &str) -> Option<(u8, u8)> {
    let name = name
        .to_ascii_lowercase()
        .replace("x86_64", "x64")
        .replace("x86-64", "x64");
    let (_, ext) = name.rsplit_once('.')?;
    let format_rank = match (platform, ext) {
        ("windows", "exe") | ("macos", "dmg") | ("linux", "appimage") => 0,
        ("windows", "msi") | ("linux", "deb") => 1,
        ("linux", "rpm") => 2,
        _ => return None,
    };
    let mut tokens = name.split(|c: char| !c.is_ascii_alphanumeric());
    // In names such as win32-x64, win32 denotes the OS and x64 is the CPU.
    let cpu = tokens.clone().find_map(|token| match token {
        "amd64" | "x64" => Some("x86_64"),
        "arm64" | "aarch64" => Some("aarch64"),
        "x86" | "i386" | "i686" | "ia32" => Some("x86"),
        _ => None,
    });
    if let Some(cpu) = cpu {
        return (cpu == arch).then_some((0, format_rank));
    }
    let generic = match (platform, arch) {
        ("macos", "x86_64" | "aarch64") => "universal",
        ("windows", "x86_64") => "win64",
        ("windows", "x86") => "win32",
        _ => return None,
    };
    tokens
        .any(|token| token == generic)
        .then_some((1, format_rank))
}

fn installer_url(assets: &[Asset], platform: &str, arch: &str) -> Option<String> {
    assets
        .iter()
        .filter_map(|asset| {
            let rank = installer_rank(&asset.name, platform, arch)?;
            Some((rank, https_url(&asset.browser_download_url)?))
        })
        .min_by_key(|(rank, _)| *rank)
        .map(|(_, url)| url.into())
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "连接 GitHub 超时，请稍后重试。"
    } else if error.is_decode() {
        "暂时无法读取发行信息，请重试或前往 GitHub 查看。"
    } else {
        "暂时无法连接 GitHub，请检查网络连接后重试。"
    }
    .into()
}

#[tauri::command]
pub async fn check_github_release(app: AppHandle) -> Result<Option<ReleaseInfo>, String> {
    let current = &app.package_info().version;
    let response = Client::builder()
        .user_agent(format!("WeekLoom/{current}"))
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(network_error)?
        .get(LATEST_RELEASE_API)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(network_error)?;
    match response.status() {
        StatusCode::NOT_FOUND => return Err("仓库暂未发布正式版，可稍后再来查看。".into()),
        StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
            return Err("GitHub 暂时限制了更新请求，请稍后重试或直接查看发行页。".into());
        }
        status if !status.is_success() => {
            return Err("GitHub 暂时无法提供发行信息，请稍后重试。".into())
        }
        _ => {}
    }
    let release: GithubRelease = response.json().await.map_err(network_error)?;
    let Some(version) = newer_version(current, &release.tag_name)? else {
        return Ok(None);
    };
    Ok(Some(ReleaseInfo {
        version: version.to_string(),
        published_at: release.published_at,
        body: release.body.unwrap_or_default(),
        release_url: https_url(&release.html_url)
            .map(String::from)
            .unwrap_or_else(|| format!("{REPO_URL}/releases")),
        download_url: installer_url(&release.assets, consts::OS, consts::ARCH),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_semver_precedence_and_accepts_tag_prefix() {
        let current = Version::parse("0.2.0-beta.2").unwrap();
        for tag in ["v0.2.0", "0.2.0-beta.10", "v0.10.0"] {
            assert!(newer_version(&current, tag).unwrap().is_some());
        }
        for tag in ["v0.1.99", "0.2.0-alpha", "0.2.0-beta.2+build.9"] {
            assert!(newer_version(&current, tag).unwrap().is_none());
        }
        assert!(newer_version(&current, "v0.2").is_err());
        assert!(newer_version(&current, "0.02.0").is_err());
    }

    #[test]
    fn matches_installers_by_system_architecture_and_format() {
        let assets: Vec<_> = [
            "WeekLoom_x64-setup.exe.sig",
            "WeekLoom_arm64-setup.exe",
            "WeekLoom_x64.msi",
            "WeekLoom_x64-setup.exe",
            "WeekLoom_universal.dmg",
            "WeekLoom_x64.dmg",
            "WeekLoom_aarch64.dmg",
            "WeekLoom_amd64.deb",
            "WeekLoom_x86_64.AppImage",
        ]
        .iter()
        .map(|name| Asset {
            name: name.to_string(),
            browser_download_url: format!("https://example.org/{name}"),
        })
        .collect();
        for (platform, arch, file) in [
            ("windows", "x86_64", "WeekLoom_x64-setup.exe"),
            ("windows", "aarch64", "WeekLoom_arm64-setup.exe"),
            ("macos", "aarch64", "WeekLoom_aarch64.dmg"),
            ("macos", "x86_64", "WeekLoom_x64.dmg"),
            ("linux", "x86_64", "WeekLoom_x86_64.AppImage"),
        ] {
            assert_eq!(
                installer_url(&assets, platform, arch).unwrap(),
                format!("https://example.org/{file}")
            );
        }
        assert!(installer_url(&assets, "windows", "x86").is_none());
        assert!(installer_url(&assets, "linux", "aarch64").is_none());
        assert!(installer_url(&assets[4..5], "macos", "aarch64").is_some());
        assert!(installer_rank("WeekLoom-win32-x64.exe", "windows", "x86").is_none());
        assert!(installer_rank("WeekLoom-win32-x64.exe", "windows", "x86_64").is_some());
    }

    #[test]
    fn only_opens_absolute_https_links() {
        assert!(https_url("https://github.com/shyrel666/WeekLoom/issues/new?body=test").is_some());
        for value in [
            "http://example.org",
            "file:///etc/hosts",
            "javascript:alert(1)",
            "mailto:a@example.org",
            "//example.org",
            "https:example.org",
            "https:///bad",
            "https://",
            "https://name:pass@example.org",
        ] {
            assert!(https_url(value).is_none(), "{value}");
        }
    }

    #[test]
    fn empty_and_placeholder_keys_disable_native_updates() {
        assert!(!valid_updater_key(""));
        assert!(!valid_updater_key("YOUR_PUBLIC_KEY"));
        assert!(!valid_updater_key(
            &STANDARD.encode("not a Minisign public key")
        ));
        let mut packet = b"Ed".to_vec();
        packet.extend_from_slice(&[1; 40]);
        let public_file = format!(
            "untrusted comment: test public key\n{}",
            STANDARD.encode(packet)
        );
        assert!(valid_updater_key(&STANDARD.encode(public_file)));
    }
}
