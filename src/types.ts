export type Platform = "macos" | "windows" | "linux";

export type NavTab = "logs" | "generate" | "history" | "settings" | "about";

export interface AppInfo {
  name: string;
  version: string;
  platform: Platform;
  arch: string;
  tauri_version: string;
  app_data_dir: string;
  db_path: string;
  repo_url: string;
  updater_configured: boolean;
}

export interface ReleaseInfo {
  version: string;
  published_at: string | null;
  body: string;
  release_url: string;
  download_url: string | null;
}

export type RolePresetId =
  | "general"
  | "product_ops"
  | "sales_biz"
  | "admin_hr_fin"
  | "tech"
  | "design"
  | "custom";

export type ReportStyleId = "concise" | "detailed" | "impact";

export type ReportFormatId = "plain" | "markdown";

export const DEFAULT_ROLE_PRESET: RolePresetId = "general";
export const DEFAULT_REPORT_STYLE: ReportStyleId = "concise";
export const DEFAULT_REPORT_FORMAT: ReportFormatId = "plain";
export const MAX_CUSTOM_INSTRUCTIONS_CHARS = 500;

export interface WorkLog {
  id: number;
  content: string;
  created_at: string;
  log_date: string;
  log_time: string;
  is_remote?: boolean;
}

export interface WeeklyReport {
  id: number;
  week_start: string;
  week_end: string;
  role: string;
  style: string;
  summary: string;
  next_plan: string;
  created_at: string;
  updated_at: string;
}

export interface AppSettings {
  api_key: string;
  model: string;
  default_role: RolePresetId | string;
  custom_role: string;
  default_style: ReportStyleId | string;
  report_format: ReportFormatId | string;
  report_custom_instructions: string;
  include_last_week_plan: boolean;
  reminder_enabled: boolean;
  reminder_time: string;
  shortcut: string;
  theme: "light" | "dark";
  webdav_enabled: boolean;
  webdav_url: string;
  webdav_username: string;
  webdav_password: string;
  webdav_sync_interval_mins: number;
  auto_check_update: boolean;
  skipped_version: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  api_key: "",
  model: "deepseek-flash",
  default_role: DEFAULT_ROLE_PRESET,
  custom_role: "",
  default_style: DEFAULT_REPORT_STYLE,
  report_format: DEFAULT_REPORT_FORMAT,
  report_custom_instructions: "",
  include_last_week_plan: true,
  reminder_enabled: true,
  reminder_time: "17:30",
  shortcut: "Alt+W",
  theme: "light",
  webdav_enabled: false,
  webdav_url: "https://dav.jianguoyun.com/dav/WeekLoom/inbox/",
  webdav_username: "",
  webdav_password: "",
  webdav_sync_interval_mins: 5,
  auto_check_update: true,
  skipped_version: "",
};

export interface WebDavSyncStatus {
  syncing: boolean;
  last_sync_at: string | null;
  last_imported_count: number;
  last_error: string | null;
}

export interface WebDavSyncResult {
  imported_count: number;
  skipped_duplicates: number;
  skipped_invalid: number;
  failed_deletes: number;
  synced_at: string;
  message: string;
}

export interface MobileHelperInfo {
  inbox_url: string;
  auth_header: string;
  sample_json_body: string;
  curl_command: string;
  android_shortcuts_json: string;
}

export interface DeepSeekModelInfo {
  id: string;
  name?: string | null;
}

export interface RoleOption {
  value: RolePresetId;
  label: string;
  hint: string;
}

export const ROLE_OPTIONS: RoleOption[] = [
  { value: "general", label: "通用职场", hint: "条理清晰、闭环推进，适合通用职场汇报" },
  { value: "product_ops", label: "产品 / 运营", hint: "侧重业务指标、需求推进、活动落地与复盘" },
  { value: "sales_biz", label: "销售 / 商务", hint: "侧重重点客户跟进、商机转化与业绩达成" },
  { value: "admin_hr_fin", label: "行政 / 人事 / 财务", hint: "侧重流程规范、合规风控、资源保障与协同" },
  { value: "tech", label: "研发 / 技术", hint: "侧重需求交付、架构优化、稳定性与缺陷修复" },
  { value: "design", label: "设计 / 创意", hint: "侧重视觉交互产出、改版迭代与体验落地" },
  { value: "custom", label: "自定义岗位", hint: "自由填写你的专属岗位，AI 按该岗位视角与话语体系提炼" },
];

export interface StyleOption {
  value: ReportStyleId;
  label: string;
  desc: string;
}

export const STYLE_OPTIONS: StyleOption[] = [
  { value: "concise", label: "精简干练", desc: "直击要点，去除冗余修饰，每条 1~2 句话" },
  { value: "detailed", label: "详实专业", desc: "背景完整、逻辑严谨，体现执行细节与掌控力" },
  { value: "impact", label: "突出成果", desc: "结果导向，优先提炼交付里程碑与业务价值" },
];

export interface ReportFormatOption {
  value: ReportFormatId;
  label: string;
  desc: string;
}

export const REPORT_FORMAT_OPTIONS: ReportFormatOption[] = [
  { value: "plain", label: "纯文本", desc: "禁用 Markdown 符号，适合直接粘贴至企业微信 / 钉钉汇报" },
  { value: "markdown", label: "Markdown", desc: "带清晰标题、列表与适度加粗，适合飞书 / Notion / 文档" },
];

export const CUSTOM_INSTRUCTION_PRESETS: string[] = [
  "总字数控制在 300 字以内",
  "按【核心项目】【日常支持】分组",
  "保留关键数据与推进进度",
  "使用英文撰写",
];

const LEGACY_ROLE_MAP: Record<string, RolePresetId> = {
  "通用职场": "general",
  "产品 / 运营": "product_ops",
  "销售 / 商务": "sales_biz",
  "行政 / 人事 / 财务": "admin_hr_fin",
  "研发 / 技术": "tech",
  "设计 / 创意": "design",
  "自定义岗位": "custom",
};

const LEGACY_STYLE_MAP: Record<string, ReportStyleId> = {
  "精简干练": "concise",
  "详实专业": "detailed",
  "突出成果": "impact",
};

export function normalizeRolePreset(raw?: string | null): RolePresetId {
  const val = (raw ?? "").trim();
  if (ROLE_OPTIONS.some((item) => item.value === val)) {
    return val as RolePresetId;
  }
  return LEGACY_ROLE_MAP[val] ?? DEFAULT_ROLE_PRESET;
}

export function normalizeReportStyle(raw?: string | null): ReportStyleId {
  const val = (raw ?? "").trim();
  if (STYLE_OPTIONS.some((item) => item.value === val)) {
    return val as ReportStyleId;
  }
  return LEGACY_STYLE_MAP[val] ?? DEFAULT_REPORT_STYLE;
}

export function normalizeReportFormat(raw?: string | null): ReportFormatId {
  const val = (raw ?? "").trim().toLowerCase();
  return val === "markdown" || val === "md" ? "markdown" : DEFAULT_REPORT_FORMAT;
}

export function getRoleLabel(role: string): string {
  const trimmed = role.trim();
  const matched = ROLE_OPTIONS.find((item) => item.value === trimmed);
  if (matched) {
    return matched.value === "custom" ? "通用职场" : matched.label;
  }
  return trimmed || "通用职场";
}

export function getStyleLabel(style: string): string {
  const id = normalizeReportStyle(style);
  return STYLE_OPTIONS.find((item) => item.value === id)?.label ?? "精简干练";
}
