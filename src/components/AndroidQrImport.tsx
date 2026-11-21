import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2, QrCode, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface ImportSession {
  id: string;
  importUrl: string;
  passphrase: string;
  expiresAt: number;
  address: string;
  addresses: string[];
}

interface Props {
  url: string;
  username: string;
  password: string;
}

export function AndroidQrImport({ url, username, password }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const current = useRef<Promise<ImportSession> | null>(null);
  const [session, setSession] = useState<ImportSession | null>(null);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);

  const revoke = useCallback(() => {
    const request = current.current;
    current.current = null;
    // Closing while the native command is starting must also revoke its eventual link.
    void request?.then(({ id }) => invoke("stop_android_import", { id })).catch(() => {});
  }, []);

  const dismiss = useCallback(() => {
    revoke();
    dialog.current?.close();
    setSession(null);
    setError("");
  }, [revoke]);

  useEffect(() => {
    const unlisten = listen("android-import-dismissed", dismiss);
    return () => {
      revoke();
      void unlisten.then((off) => off());
    };
  }, [dismiss, revoke]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      const remaining = Math.ceil((session.expiresAt - Date.now()) / 1000);
      if (remaining <= 0) {
        revoke();
        setSession(null);
        setError("二维码已过期。重新生成即可继续导入。");
      } else {
        setSeconds(remaining);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [session, revoke]);

  async function start(address?: string) {
    revoke();
    setSession(null);
    setError("");
    if (!dialog.current?.open) dialog.current?.showModal();
    const request = invoke<ImportSession>("start_android_import", {
      url, username, password, address: address ?? null,
    });
    current.current = request;
    try {
      const result = await request;
      if (current.current === request) {
        setSeconds(Math.max(0, Math.ceil((result.expiresAt - Date.now()) / 1000)));
        setSession(result);
      }
    } catch (err) {
      if (current.current === request) setError(String(err));
    }
  }

  return (
    <>
      <button type="button" onClick={() => void start()} aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-hover">
        <QrCode className="h-4 w-4" />扫码导入
      </button>
      <dialog ref={dialog} aria-labelledby="android-import-title"
        onCancel={(event) => { event.preventDefault(); dismiss(); }}
        className="m-auto max-h-[90vh] w-[min(25rem,92vw)] overflow-y-auto rounded-2xl border border-border-subtle bg-surface-card p-5 text-ink-primary shadow-float backdrop:bg-black/40">
        <div className="flex items-center justify-between gap-2">
          <h2 id="android-import-title" className="text-base font-semibold">安卓扫码导入</h2>
          <button type="button" aria-label="关闭扫码导入" onClick={dismiss}
            className="rounded-md p-1.5 text-ink-muted hover:bg-surface-hover hover:text-ink-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
        {session ? (
          <>
            <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
              手机和电脑连入同一局域网，用手机相机扫码，并选择用 HTTP Shortcuts 打开。
            </p>
            <QRCodeSVG value={session.importUrl} size={228} marginSize={4} level="M"
              title="HTTP Shortcuts 导入二维码" className="mx-auto my-4 block h-auto max-w-full rounded-lg" />
            <div className="rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2.5 text-center">
              <p className="text-xs text-ink-secondary">在 HTTP Shortcuts 中输入导入口令</p>
              <code className="mt-1 block select-all font-mono text-xl font-semibold tracking-widest">{session.passphrase}</code>
            </div>
            {session.addresses.length > 1 && (
              <label className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-secondary">
                电脑局域网地址
                <select value={session.address} onChange={(e) => void start(e.target.value)}
                  className="rounded-md border border-border-subtle bg-surface-elevated px-2 py-1 text-ink-primary">
                  {session.addresses.map((ip) => <option key={ip}>{ip}</option>)}
                </select>
              </label>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-muted">
                <span className="font-mono tabular-nums">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
                {" 后失效 · 关闭即停止分享"}
              </p>
              <button type="button" onClick={dismiss}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">完成并关闭</button>
            </div>
          </>
        ) : error ? (
          <div className="mt-4 space-y-3">
            <p role="alert" className="text-sm text-ink-secondary">{error}</p>
            <button type="button" onClick={() => void start()}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">重新生成</button>
          </div>
        ) : (
          <p role="status" className="my-6 flex items-center justify-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" />正在生成二维码…
          </p>
        )}
      </dialog>
    </>
  );
}
