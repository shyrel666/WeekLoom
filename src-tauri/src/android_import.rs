use axum::{
    body::Bytes,
    http::{header, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Serialize;
use std::{
    io::{Cursor, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, UdpSocket},
    sync::Mutex,
    time::Duration,
};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use url::Url;
use zip::{write::SimpleFileOptions, AesMode, CompressionMethod, ZipWriter};

const SHARE_LIFETIME: Duration = Duration::from_secs(5 * 60);

struct ActiveShare {
    id: String,
    cancel: CancellationToken,
}

#[derive(Default)]
pub struct AndroidImportState(Mutex<Option<ActiveShare>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidImportSession {
    id: String,
    import_url: String,
    passphrase: String,
    expires_at: i64,
    address: Ipv4Addr,
    addresses: Vec<Ipv4Addr>,
}

fn lan_addresses() -> Result<Vec<Ipv4Addr>, String> {
    // UDP connect selects a route without sending a packet.
    let preferred = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .and_then(|socket| {
            socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9))?;
            socket.local_addr()
        })
        .ok()
        .map(|addr| addr.ip());
    let mut addresses: Vec<_> = if_addrs::get_if_addrs()
        .map_err(|e| format!("无法读取电脑的网络地址：{e}"))?
        .into_iter()
        .filter(|iface| iface.is_oper_up())
        .filter_map(|iface| match iface.ip() {
            IpAddr::V4(ip) if ip.is_private() || ip.is_link_local() => Some(ip),
            _ => None,
        })
        .collect();
    addresses
        .sort_unstable_by_key(|ip| (preferred != Some(IpAddr::V4(*ip)), ip.is_link_local(), *ip));
    addresses.dedup();
    if addresses.is_empty() {
        return Err("未找到局域网 IPv4 地址。请连接和手机相同的局域网，再重新生成二维码。".into());
    }
    Ok(addresses)
}

fn encrypted_zip(json: &str, passphrase: &str) -> zip::result::ZipResult<Vec<u8>> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .with_aes_encryption(AesMode::Aes256, passphrase);
    writer.start_file("shortcuts.json", options)?;
    writer.write_all(json.as_bytes())?;
    Ok(writer.finish()?.into_inner())
}

fn bind_listener(address: Ipv4Addr) -> std::io::Result<(tokio::net::TcpListener, SocketAddr)> {
    let listener = TcpListener::bind((address, 0))?;
    let bound_address = listener.local_addr()?;
    listener.set_nonblocking(true)?;
    Ok((tokio::net::TcpListener::from_std(listener)?, bound_address))
}

impl AndroidImportState {
    fn start(
        &self,
        json: &str,
        address: Ipv4Addr,
        addresses: Vec<Ipv4Addr>,
        lifetime: Duration,
    ) -> Result<AndroidImportSession, String> {
        let mut random = [0; 28];
        getrandom::fill(&mut random).map_err(|e| format!("无法生成临时导入口令：{e}"))?;
        let id = URL_SAFE_NO_PAD.encode(&random[..16]);
        const ALPHABET: &[u8; 32] = b"23456789abcdefghjklmnpqrstuvwxyz";
        let passphrase: String = random[16..]
            .iter()
            .map(|byte| ALPHABET[usize::from(byte & 31)] as char)
            .collect();
        let archive = Bytes::from(
            encrypted_zip(json, &passphrase).map_err(|e| format!("配置包加密失败：{e}"))?,
        );
        let (listener, bound_address) =
            bind_listener(address).map_err(|e| format!("无法在 {address} 启动临时下载：{e}"))?;

        let path = format!("/{id}/weekloom.zip");
        let mut import_url = Url::parse("https://http-shortcuts.rmy.ch/import").unwrap();
        import_url
            .query_pairs_mut()
            .append_pair("url", &format!("http://{bound_address}{path}"));
        let deadline = Instant::now() + lifetime;
        let expires_at = chrono::Utc::now().timestamp_millis() + lifetime.as_millis() as i64;
        let cancel = CancellationToken::new();
        let serving = cancel.clone();
        let router = Router::new().route(
            &path,
            get(move || {
                let archive = archive.clone();
                let serving = serving.clone();
                async move {
                    if serving.is_cancelled() || chrono::Utc::now().timestamp_millis() >= expires_at
                    {
                        return StatusCode::GONE.into_response();
                    }
                    (
                        [
                            (header::CONTENT_TYPE, "application/zip"),
                            (
                                header::CONTENT_DISPOSITION,
                                "attachment; filename=\"weekloom.zip\"",
                            ),
                            (header::CACHE_CONTROL, "no-store"),
                        ],
                        archive,
                    )
                        .into_response()
                }
            }),
        );
        let share = ActiveShare {
            id: id.clone(),
            cancel: cancel.clone(),
        };
        if let Some(old) = self.0.lock().unwrap().replace(share) {
            old.cancel.cancel();
        }
        tokio::spawn(async move {
            let shutdown = async move {
                let _ = tokio::time::timeout_at(deadline, cancel.cancelled()).await;
                cancel.cancel();
            };
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(shutdown)
                .await;
        });
        Ok(AndroidImportSession {
            id,
            import_url: import_url.into(),
            passphrase,
            expires_at,
            address,
            addresses,
        })
    }

    pub fn stop(&self, id: Option<&str>) -> bool {
        let mut current = self.0.lock().unwrap();
        if let Some(active) = current.take_if(|active| id.is_none_or(|id| id == active.id)) {
            active.cancel.cancel();
            return true;
        }
        false
    }
}

#[tauri::command]
pub fn start_android_import(
    state: tauri::State<'_, AndroidImportState>,
    url: String,
    username: String,
    password: String,
    address: Option<Ipv4Addr>,
) -> Result<AndroidImportSession, String> {
    let helper = crate::webdav::build_mobile_helper(&url, &username, &password)?;
    let addresses = lan_addresses()?;
    let address = address.unwrap_or(addresses[0]);
    if !addresses.contains(&address) {
        return Err("所选网络地址已断开，请重新生成二维码。".into());
    }
    let runtime = tauri::async_runtime::handle();
    let _enter = runtime.inner().enter();
    state.start(
        &helper.android_shortcuts_json,
        address,
        addresses,
        SHARE_LIFETIME,
    )
}

#[tauri::command]
pub fn stop_android_import(state: tauri::State<'_, AndroidImportState>, id: String) {
    state.stop(Some(&id));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use zip::ZipArchive;

    fn download_url(session: &AndroidImportSession) -> Url {
        let link = Url::parse(&session.import_url).unwrap();
        assert_eq!(
            link.origin().ascii_serialization(),
            "https://http-shortcuts.rmy.ch"
        );
        assert_eq!(link.path(), "/import");
        let (key, value) = link.query_pairs().next().unwrap();
        assert_eq!(key, "url");
        assert!(!link.as_str().contains(&session.passphrase));
        assert!(!link.as_str().contains("test-webdav"));
        Url::parse(&value).unwrap()
    }

    #[tokio::test]
    async fn serves_one_encrypted_shortcuts_file_for_password_retries() {
        let state = AndroidImportState::default();
        let helper = crate::webdav::build_mobile_helper(
            "https://example.test/dav/inbox/",
            "test-webdav-user",
            "test-webdav-password",
        )
        .unwrap();
        let local = Ipv4Addr::LOCALHOST;
        let session = state
            .start(
                &helper.android_shortcuts_json,
                local,
                vec![local],
                SHARE_LIFETIME,
            )
            .unwrap();
        let url = download_url(&session);
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = client.get(url.clone()).send().await.unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "application/zip");
        assert_eq!(response.headers()["cache-control"], "no-store");
        let bytes = response.bytes().await.unwrap();
        let again = client
            .get(url.clone())
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(bytes, again);
        let mut zip = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert_eq!(zip.len(), 1);
        assert!(zip.by_name("shortcuts.json").is_err());
        assert!(zip
            .by_name_decrypt("shortcuts.json", b"wrong-password")
            .and_then(|mut file| Ok(file.read_to_end(&mut Vec::new())?))
            .is_err());
        let mut json = String::new();
        let mut file = zip
            .by_name_decrypt("shortcuts.json", session.passphrase.as_bytes())
            .unwrap();
        assert!(file.encrypted());
        file.read_to_string(&mut json).unwrap();
        assert_eq!(json, helper.android_shortcuts_json);
        assert_eq!(client.post(url.clone()).send().await.unwrap().status(), 405);
        assert_eq!(
            client
                .get(url.join("/weekloom.zip").unwrap())
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
        assert!(state.stop(Some(&session.id)));
        assert_revoked(&client, url).await;
    }

    async fn assert_revoked(client: &reqwest::Client, url: Url) {
        if let Ok(response) = client.get(url).send().await {
            assert_eq!(response.status(), 410);
        }
    }

    #[tokio::test]
    async fn replacement_and_expiry_revoke_only_the_intended_link() {
        let state = AndroidImportState::default();
        let local = Ipv4Addr::LOCALHOST;
        let first = state
            .start("{}", local, vec![local], SHARE_LIFETIME)
            .unwrap();
        let second = state
            .start("{}", local, vec![local], SHARE_LIFETIME)
            .unwrap();
        assert_ne!(first.id, second.id);
        assert!(!state.stop(Some(&first.id)));
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        assert_revoked(&client, download_url(&first)).await;
        assert_eq!(
            client
                .get(download_url(&second))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        let expiring = state
            .start("{}", local, vec![local], Duration::from_millis(40))
            .unwrap();
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert_revoked(&client, download_url(&expiring)).await;
    }
}
