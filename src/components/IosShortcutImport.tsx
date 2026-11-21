import { QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import template from "../../assets/shortcuts/icloud.json";
import { CopyButton } from "./CopyButton";

const shareId = /^https:\/\/(?:www\.)?icloud\.com\/shortcuts\/([a-f0-9]{32})\/?$/i
  .exec(template.shareUrl.trim())?.[1];

export function IosShortcutImport() {
  if (!shareId) {
    return (
      <p className="flex items-center gap-2 text-xs text-ink-secondary">
        <QrCode className="h-4 w-4 shrink-0" aria-hidden="true" />
        此版本暂未提供 iCloud 模板链接，可使用下方手动配置。
      </p>
    );
  }

  const shareUrl = `https://www.icloud.com/shortcuts/${shareId}`;
  return (
    <details className="rounded-lg border border-border-subtle bg-surface-card p-3.5">
      <summary className="cursor-pointer text-xs font-semibold text-brand">
        <span className="inline-flex items-center gap-1.5 align-middle">
          <QrCode className="h-4 w-4" aria-hidden="true" />
          扫码添加快捷指令
        </span>
      </summary>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <QRCodeSVG value={shareUrl} size={192} level="M" marginSize={4}
          title="记一笔 WeekLoom 的 iCloud 模板二维码" className="h-auto max-w-full rounded-lg" />
        <div className="min-w-44 flex-1 space-y-2 text-xs leading-relaxed text-ink-secondary">
          <p>用 iPhone 相机扫码，轻点链接，在「快捷指令」中添加「记一笔 WeekLoom」。</p>
          <p>按提示填写 WebDAV 收件箱地址、账号和应用专用密码。配好后，运行快捷指令即可记一笔。</p>
          <CopyButton text={shareUrl} label="复制模板链接" />
        </div>
      </div>
    </details>
  );
}
