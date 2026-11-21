import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}
