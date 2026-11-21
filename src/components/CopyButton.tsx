import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyTextToClipboard } from "../utils/clipboard";

interface CopyButtonProps {
  text: string;
  label?: string;
  disabled?: boolean;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  text,
  label = "一键复制",
  disabled = false,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!text.trim() || disabled) return;
    await copyTextToClipboard(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled || !text.trim()}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
        copied
          ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border border-emerald-600/30"
          : "bg-surface-elevated hover:bg-brand-subtle text-ink-secondary hover:text-brand border border-border-subtle hover:border-brand/40 disabled:opacity-40 disabled:cursor-not-allowed"
      }`}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5" />
          <span>已复制</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
};
