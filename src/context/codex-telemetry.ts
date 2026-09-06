import { sha256Bytes } from "../contract/hash.js";

export interface CodexTelemetry {
  assessment: "clean" | "completed_with_warnings" | "needs_review" | "tool_activity" | "incomplete";
  completed: boolean;
  failed: boolean;
  tool_events: number;
  unknown_events: number;
  malformed_lines: number;
  diagnostic_count: number;
  warning_count: number;
  blocking_diagnostic_count: number;
  diagnostics: { category: string; summary: string; message_hash: string; disposition: "expected_policy_notice" | "requires_review" }[];
  usage: Record<string, number> | null;
}

/** Retain allowlisted metadata only: never messages, reasoning, command text or stderr. */
export function readCodexTelemetry(stdout: string, options: {
  onDiagnostic?: (message: string) => void;
  expectedPolicy?: "text_only_feature_overrides_v1";
} = {}): CodexTelemetry {
  const result: CodexTelemetry = { assessment: "incomplete", completed: false, failed: false,
    tool_events: 0, unknown_events: 0, malformed_lines: 0, diagnostic_count: 0, warning_count: 0, blocking_diagnostic_count: 0, diagnostics: [], usage: null };
  const diagnostic = (value: unknown, itemNotice = false) => {
    result.diagnostic_count++;
    const message = typeof value === "string" ? value : "";
    const hash = sha256Bytes(Buffer.from(message));
    // Exact messages reviewed locally on 2026-09-05; changed versions remain blocked.
    const notice = options.expectedPolicy === "text_only_feature_overrides_v1" && itemNotice
      ? hash === "37e8ba809a3c438c05629b22c74b62fb33f83149de21670a75f6813033f84488" ? "experimental_skill_discovery_policy"
        : hash === "098e801ebc95c9c7312a945849442846324dcf639365a297313248993822711b" ? "code_mode_host_intentionally_disabled" : null
      : null;
    if (notice) result.warning_count++; else result.blocking_diagnostic_count++;
    if (result.diagnostics.length >= 20) return;
    options.onDiagnostic?.(message);
    const category = /mcp.*(?:start|initializ|connect|fail)/i.test(message) ? "mcp_startup"
      : /unknown feature|unrecognized.*(?:argument|config)|invalid.*config/i.test(message) ? "configuration"
      : /unauthoriz|authentication|login required/i.test(message) ? "authentication"
      : /rate.limit|quota/i.test(message) ? "rate_limit"
      : /timeout|timed out/i.test(message) ? "timeout" : "unknown";
    const summaries: Record<string, string> = { mcp_startup: "MCP 初始化相关诊断", configuration: "配置相关诊断",
      authentication: "认证相关诊断", rate_limit: "额度或限流相关诊断", timeout: "超时相关诊断", unknown: "未分类诊断，原文未保留" };
    result.diagnostics.push({ category: notice ?? category,
      summary: notice === "experimental_skill_discovery_policy" ? "为限制上下文启用开发中的技能发现控制选项，保留警告"
        : notice === "code_mode_host_intentionally_disabled" ? "文本模式主动禁用执行宿主；Code Mode 不可用并拒绝执行" : summaries[category]!,
      message_hash: hash, disposition: notice ? "expected_policy_notice" : "requires_review" });
  };
  if (Buffer.byteLength(stdout) > 8 * 1024 * 1024) { result.malformed_lines++; return result; }
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { result.malformed_lines++; continue; }
    if (!event || typeof event !== "object" || Array.isArray(event)) { result.malformed_lines++; continue; }
    switch (event.type) {
      case "thread.started": case "turn.started": break;
      case "turn.completed":
        result.completed = true;
        result.usage = {};
        for (const key of ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens"]) {
          const value = event.usage?.[key];
          if (Number.isSafeInteger(value) && value >= 0) result.usage[key] = value;
        }
        break;
      case "turn.failed": result.failed = true; diagnostic(event.error?.message); break;
      case "error": diagnostic(event.message); break;
      case "item.started": case "item.updated": case "item.completed":
        switch (event.item?.type) {
          case "agent_message": case "reasoning": break;
          case "error": diagnostic(event.item.message, event.type === "item.completed"); break;
          case "command_execution": case "mcp_tool_call": case "web_search": case "file_change":
          case "tool_call": case "function_call": result.tool_events++; break;
          default: result.unknown_events++;
        }
        break;
      default: result.unknown_events++;
    }
  }
  result.assessment = result.tool_events ? "tool_activity"
    : !result.completed || result.failed ? "incomplete"
    : result.blocking_diagnostic_count || result.unknown_events || result.malformed_lines ? "needs_review"
    : result.warning_count ? "completed_with_warnings" : "clean";
  return result;
}
