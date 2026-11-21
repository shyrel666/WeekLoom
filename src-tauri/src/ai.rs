use crate::db::{
    normalize_report_format, normalize_report_style, role_display_name, WorkLog,
};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

const DEEPSEEK_API_URL: &str = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODELS_URL: &str = "https://api.deepseek.com/models";

pub struct ReportGenerateOptions<'a> {
    pub role: &'a str,
    pub style: &'a str,
    pub format: &'a str,
    pub custom_instructions: &'a str,
    pub last_week_plan: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeepSeekModelInfo {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelsListResponse {
    data: Vec<RawModelItem>,
}

#[derive(Debug, Deserialize)]
struct RawModelItem {
    id: String,
    name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedReport {
    pub summary: String,
    pub next_plan: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

fn build_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("初始化网络请求客户端失败: {}", e))
}

fn map_reqwest_error(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "请求超时：DeepSeek 接口响应较慢或网络不稳定，请稍后重试".to_string()
    } else if err.is_connect() {
        "网络连接异常：无法连接到 DeepSeek 服务器，请检查网络连接或代理设置".to_string()
    } else {
        format!("网络请求失败：{}", err)
    }
}

fn map_http_status_error(status: StatusCode, body: &str) -> String {
    let lower = body.to_lowercase();
    match status.as_u16() {
        400 => "请求参数异常（400），请检查模型配置或输入内容".to_string(),
        401 => "API Key 无效或已过期（401），请前往「设置」检查 DeepSeek API Key".to_string(),
        402 => "DeepSeek 账户余额不足（402），请前往 DeepSeek 开放平台充值后重试".to_string(),
        403 => "API 访问被拒绝（403），请确认当前 Key 具备对应模型权限".to_string(),
        404 => "模型或接口地址不可用（404），请检查模型名称是否为 deepseek-flash 或 deepseek-v4-pro".to_string(),
        429 => "请求过于频繁或触发限流（429），请稍等片刻后重试".to_string(),
        500..=599 => format!(
            "DeepSeek 服务暂时不可用（{}），请稍后重试",
            status.as_u16()
        ),
        _ => {
            if lower.contains("insufficient balance") || lower.contains("balance") {
                "DeepSeek 账户余额不足，请前往开放平台充值后重试".to_string()
            } else {
                format!("DeepSeek 接口返回异常（HTTP {}）", status.as_u16())
            }
        }
    }
}

fn role_focus_hint(role: &str) -> String {
    match role.trim() {
        "general" | "通用职场" | "custom" | "" => {
            "注重工作闭环、清晰条理与关键产出，适用于各类通用职场汇报。".to_string()
        }
        "product_ops" | "产品 / 运营" => {
            "侧重核心业务指标、需求推进、活动/渠道落地、用户反馈收集及数据复盘沉淀。".to_string()
        }
        "sales_biz" | "销售 / 商务" => {
            "侧重重点客户跟进、商机推进、方案演示、签约转化、回款进度及业绩目标达成。".to_string()
        }
        "admin_hr_fin" | "行政 / 人事 / 财务" => {
            "侧重制度流程规范、合规风控、资源保障、人员招聘/核算效率及跨部门协同支持。".to_string()
        }
        "tech" | "研发 / 技术" => {
            "侧重需求高质量交付、技术方案设计与架构优化、系统稳定性保障、关键缺陷修复与研发效能提升。"
                .to_string()
        }
        "design" | "设计 / 创意" => {
            "侧重核心视觉/交互产出物、设计改版迭代、用户体验优化、规范沉淀与最终落地效果。"
                .to_string()
        }
        other => format!(
            "请立足「{}」岗位的核心职责与专业话语体系，突出该岗位最受管理者关注的工作成果与推进价值。",
            other
        ),
    }
}

fn style_focus_hint(style: &str) -> &'static str {
    match normalize_report_style(style) {
        "detailed" => {
            "详实专业：逻辑严谨、层次清晰，适度交代背景与关键执行动作，体现专业深度与项目掌控力。"
        }
        "impact" => {
            "突出成果：强结果导向，优先提炼关键成果、交付里程碑、效率/指标提升与业务价值。"
        }
        _ => "精简干练：高度凝练、直击重点，去除冗余修饰，每条控制在简洁有力的 1~2 句话内。",
    }
}

fn style_temperature(style: &str) -> f64 {
    match normalize_report_style(style) {
        "detailed" => 0.3,
        "impact" => 0.45,
        _ => 0.35,
    }
}

fn format_guidance(format: &str) -> (&'static str, &'static str) {
    match normalize_report_format(format) {
        "markdown" => (
            "飞书、Notion、邮件或文档汇报",
            "输出标准 Markdown 排版，适合粘贴至飞书、Notion 或文档：可使用简洁的「### 分组标题」、有序/无序列表与适度 **加粗** 突出关键成果，避免过度嵌套；",
        ),
        _ => (
            "企业微信 / 钉钉「汇报」栏",
            "输出纯文本排版，适合直接粘贴到企业微信或钉钉：请使用「1. 」「2. 」等序号或「【模块】」分组，严禁使用 **加粗**、# 标题、- [ ] 等 Markdown 语法符号；",
        ),
    }
}

fn build_prompts(
    options: &ReportGenerateOptions<'_>,
    week_range: &str,
    logs_text: &str,
) -> (String, String) {
    let display_role = role_display_name(options.role);
    let role_hint = role_focus_hint(options.role);
    let style_hint = style_focus_hint(options.style);
    let (target_scene, format_rule) = format_guidance(options.format);

    let last_week_plan = options
        .last_week_plan
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let closure_rule = if last_week_plan.is_some() {
        "\n        6. 已附上周归档的「下周工作计划」作为只读对照：若本周工作记录明确体现了对应推进，请自然体现闭环结果；未完成的事项可合理延续至新的下周计划，但严禁将未在本周记录中提及的上周计划编造为已完成。"
    } else {
        ""
    };

    let custom_block = {
        let extra = options.custom_instructions.trim();
        if extra.is_empty() {
            String::new()
        } else {
            format!(
                "\n\n用户附加撰写要求（在不违背「严禁捏造数据」与「严格输出合法 JSON」前提下优先遵循）：\n{}",
                extra
            )
        }
    };

    let system_prompt = format!(
        "你是一位资深的职场汇报与周报撰写专家，正在协助「{}」岗位的职场人整理周报，用于直接粘贴至{}。\n\
        岗位侧重点：{}\n\
        汇报风格要求：{}\n\n\
        撰写规范：\n\
        1. 自动归类、合并同类项，避免流水账式按天罗列；\n\
        2. 将口语化碎片记录改写为「动作 + 结果/价值」的专业职场汇报表达，切勿凭空捏造不存在的数据；\n\
        3. 从本周记录中提取未完成、推进中或待跟进事项，整理出务实清晰的「下周工作计划」（若本周记录中无明确待办，可结合本周重点合理延展 2~3 条下一步动作）；\n\
        4. {}\n\
        5. 必须严格输出一个合法的 JSON 对象，仅包含 summary 和 next_plan 两个字符串字段，不要输出任何 Markdown 代码块标记或额外说明。{}\n\
        JSON 格式示例：\n\
        {{\"summary\": \"1. ...\\n2. ...\", \"next_plan\": \"1. ...\\n2. ...\"}}{}",
        display_role, target_scene, role_hint, style_hint, format_rule, closure_rule, custom_block
    );

    let mut user_prompt = format!(
        "请根据以下 {} 期间的工作碎片记录，生成「本周工作总结」和「下周工作计划」：\n\n{}",
        week_range, logs_text
    );

    if let Some(plan) = last_week_plan {
        user_prompt.push_str(&format!(
            "\n\n---\n参考上下文（上周周报中拟定的「下周工作计划」，仅作闭环对照参考，切勿编造未在上方本周记录中出现的完成项）：\n{}",
            plan
        ));
    }

    (system_prompt, user_prompt)
}

fn strip_code_fences(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        // Drop optional language tag like `json` on the first line
        let after_first_line = match rest.find('\n') {
            Some(idx) => &rest[idx + 1..],
            None => rest,
        };
        let without_end = after_first_line
            .trim_end()
            .strip_suffix("```")
            .unwrap_or(after_first_line);
        without_end.trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn escape_raw_newlines_in_json_strings(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 32);
    let mut in_string = false;
    let mut escaped = false;

    for ch in input.chars() {
        if in_string {
            if escaped {
                out.push(ch);
                escaped = false;
            } else if ch == '\\' {
                out.push(ch);
                escaped = true;
            } else if ch == '"' {
                out.push(ch);
                in_string = false;
            } else if ch == '\n' {
                out.push_str("\\n");
            } else if ch == '\r' {
                // Skip raw CR inside strings
            } else {
                out.push(ch);
            }
        } else {
            if ch == '"' {
                in_string = true;
            }
            out.push(ch);
        }
    }
    out
}

fn parse_generated_report(raw: &str) -> Result<GeneratedReport, String> {
    let cleaned = strip_code_fences(raw);

    // Attempt 1: direct parse
    if let Ok(parsed) = serde_json::from_str::<GeneratedReport>(&cleaned) {
        return Ok(parsed);
    }

    // Attempt 2: extract outermost `{ ... }`
    if let (Some(start), Some(end)) = (cleaned.find('{'), cleaned.rfind('}')) {
        if start < end {
            let slice = &cleaned[start..=end];
            if let Ok(parsed) = serde_json::from_str::<GeneratedReport>(slice) {
                return Ok(parsed);
            }

            // Attempt 3: sanitize raw newlines inside JSON string literals
            let sanitized = escape_raw_newlines_in_json_strings(slice);
            if let Ok(parsed) = serde_json::from_str::<GeneratedReport>(&sanitized) {
                return Ok(parsed);
            }

            // Attempt 4: parse as generic serde_json::Value in case keys contain arrays/extra fields
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&sanitized) {
                let summary = value_to_text(val.get("summary"));
                let next_plan = value_to_text(val.get("next_plan"));
                if !summary.is_empty() || !next_plan.is_empty() {
                    return Ok(GeneratedReport { summary, next_plan });
                }
            }
        }
    }

    Err("AI 返回内容格式未能解析为标准 JSON，请点击重新生成".to_string())
}

fn value_to_text(val: Option<&serde_json::Value>) -> String {
    match val {
        Some(serde_json::Value::String(s)) => s.trim().to_string(),
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

pub async fn fetch_deepseek_models(api_key: &str) -> Result<Vec<DeepSeekModelInfo>, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("请先填写 DeepSeek API Key，再获取官网模型列表".to_string());
    }

    let client = build_client(15)?;
    let response = client
        .get(DEEPSEEK_MODELS_URL)
        .bearer_auth(key)
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取模型列表响应失败: {}", e))?;

    if !status.is_success() {
        return Err(map_http_status_error(status, &body));
    }

    let parsed: ModelsListResponse = serde_json::from_str(&body)
        .map_err(|_| "解析 DeepSeek 模型列表失败，请稍后重试".to_string())?;

    let mut seen = std::collections::HashSet::new();
    let mut models: Vec<DeepSeekModelInfo> = Vec::new();
    for item in parsed.data {
        let id = item.id.trim().to_string();
        if !id.is_empty() && seen.insert(id.clone()) {
            let clean_name = item
                .name
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty() && n != &id);
            models.push(DeepSeekModelInfo {
                id,
                name: clean_name,
            });
        }
    }

    if models.is_empty() {
        return Err("DeepSeek 接口未返回可用模型，请稍后重试".to_string());
    }

    Ok(models)
}

pub async fn test_deepseek_connection(api_key: &str, model: &str) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("请先填写 DeepSeek API Key".to_string());
    }
    let model_name = if model.trim().is_empty() {
        "deepseek-flash"
    } else {
        model.trim()
    };

    let client = build_client(15)?;
    let payload = json!({
        "model": model_name,
        "messages": [
            { "role": "user", "content": "请回复 OK" }
        ],
        "thinking": { "type": "disabled" },
        "max_tokens": 16,
        "temperature": 0.0
    });

    let response = client
        .post(DEEPSEEK_API_URL)
        .bearer_auth(key)
        .json(&payload)
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| String::new());

    if !status.is_success() {
        return Err(map_http_status_error(status, &body));
    }

    Ok(format!("连接成功！DeepSeek 接口正常可用（模型：{}）", model_name))
}

pub async fn generate_weekly_report(
    api_key: &str,
    model: &str,
    options: &ReportGenerateOptions<'_>,
    week_range: &str,
    logs: &[WorkLog],
) -> Result<GeneratedReport, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("请先在「设置」页面配置 DeepSeek API Key".to_string());
    }
    if logs.is_empty() {
        return Err("当前周暂无工作记录，请先在「工作记录」中添加几条记录后再生成周报".to_string());
    }

    let model_name = if model.trim().is_empty() {
        "deepseek-flash"
    } else {
        model.trim()
    };

    // Sort logs chronologically (oldest to newest) for clear narrative synthesis
    let mut ordered: Vec<&WorkLog> = logs.iter().collect();
    ordered.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

    let logs_text = ordered
        .iter()
        .map(|item| format!("- [{} {}] {}", item.log_date, item.log_time, item.content))
        .collect::<Vec<_>>()
        .join("\n");

    let (system_prompt, user_prompt) = build_prompts(options, week_range, &logs_text);
    let temperature = style_temperature(options.style);

    let client = build_client(90)?;
    let payload = json!({
        "model": model_name,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ],
        "thinking": { "type": "disabled" },
        "response_format": { "type": "json_object" },
        "temperature": temperature
    });

    let response = client
        .post(DEEPSEEK_API_URL)
        .bearer_auth(key)
        .json(&payload)
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取 DeepSeek 响应内容失败: {}", e))?;

    if !status.is_success() {
        return Err(map_http_status_error(status, &body));
    }

    let completion: ChatCompletionResponse = serde_json::from_str(&body)
        .map_err(|_| "解析 DeepSeek 响应结构失败，请稍后重试".to_string())?;

    let content = completion
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .unwrap_or_default();

    if content.trim().is_empty() {
        return Err("DeepSeek 返回了空内容，请重试".to_string());
    }

    parse_generated_report(&content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_prompts_plain_with_preset_id() {
        let opts = ReportGenerateOptions {
            role: "tech",
            style: "detailed",
            format: "plain",
            custom_instructions: "",
            last_week_plan: None,
        };
        let (sys, usr) = build_prompts(&opts, "2026-11-16 ~ 2026-11-22", "- [2026-11-16 10:00] 修复登录超时");

        assert!(sys.contains("「研发 / 技术」岗位"));
        assert!(sys.contains("详实专业"));
        assert!(sys.contains("严禁使用 **加粗**"));
        assert!(!sys.contains("用户附加撰写要求"));
        assert!(!usr.contains("上周周报"));
        assert_eq!(style_temperature("detailed"), 0.3);
    }

    #[test]
    fn test_build_prompts_markdown_custom_role_extra_and_last_week_plan() {
        let opts = ReportGenerateOptions {
            role: "跨境电商运营",
            style: "impact",
            format: "markdown",
            custom_instructions: "总字数控制在 300 字内；突出 ROI",
            last_week_plan: Some("1. 上线黑五大促落地页"),
        };
        let (sys, usr) = build_prompts(&opts, "2026-11-16 ~ 2026-11-22", "- [2026-11-18 15:00] 黑五页面上线");

        assert!(sys.contains("「跨境电商运营」岗位"));
        assert!(sys.contains("突出成果"));
        assert!(sys.contains("标准 Markdown 排版"));
        assert!(sys.contains("用户附加撰写要求"));
        assert!(sys.contains("总字数控制在 300 字内；突出 ROI"));
        assert!(sys.contains("上周归档的「下周工作计划」"));
        assert!(usr.contains("上线黑五大促落地页"));
        assert_eq!(style_temperature("impact"), 0.45);
    }
}
