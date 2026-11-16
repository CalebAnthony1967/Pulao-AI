/**
 * Pulao AI — Model Context Protocol (MCP) Client Bridge
 * Delegates all tool calls to the Express backend stdio MCP Bridge Manager (/api/mcp/call)
 * and hydrates isolated, tender-scoped tool execution traces from /api/observability/traces.
 */

import { recordAudit } from "./audit.js";

let toolCallHistory = [];
const runMetadataMap = new Map();
const toolCallListeners = new Set();

function notifyListeners(newCall = null) {
  const snapshot = [...toolCallHistory];
  const runsSnapshot = Object.fromEntries(runMetadataMap.entries());
  toolCallListeners.forEach((fn) => {
    try {
      fn(newCall, snapshot, runsSnapshot);
    } catch {}
  });
}

export function subscribeToToolCalls(listener) {
  toolCallListeners.add(listener);
  return () => toolCallListeners.delete(listener);
}

export function upsertRunMetadata(runMeta) {
  if (!runMeta?.run_id) return;
  const existing = runMetadataMap.get(runMeta.run_id) || {};
  runMetadataMap.set(runMeta.run_id, { ...existing, ...runMeta });
  notifyListeners(null);
}

export function getRunMetadataMap() {
  return Object.fromEntries(runMetadataMap.entries());
}

export function pushToolTrace(logEntry) {
  if (!logEntry) return;
  const idx = toolCallHistory.findIndex((t) => t.id === logEntry.id);
  if (idx >= 0) {
    toolCallHistory[idx] = logEntry;
  } else {
    toolCallHistory.unshift(logEntry);
    if (toolCallHistory.length > 200) toolCallHistory.pop();
  }
  notifyListeners(logEntry);
}

export function getToolCallHistory() {
  return [...toolCallHistory];
}

export async function hydrateToolTraces({ source = "live_ui", tenderId = "" } = {}) {
  try {
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (tenderId) params.set("tender_id", tenderId);

    const res = await fetch(`/api/observability/traces?${params.toString()}`);
    if (!res.ok) return getToolCallHistory();
    const data = await res.json();
    const serverTraces = Array.isArray(data?.traces) ? data.traces : [];
    const serverRuns = Array.isArray(data?.runs) ? data.runs : [];

    toolCallHistory = serverTraces.slice(0, 200);
    for (const r of serverRuns) {
      if (r?.run_id) {
        const prev = runMetadataMap.get(r.run_id) || {};
        runMetadataMap.set(r.run_id, { ...prev, ...r });
      }
    }

    notifyListeners(null);
  } catch {}
  return getToolCallHistory();
}

export const MCP_SERVERS = {
  CUSTOM: {
    id: "pulao-procurement-mcp",
    name: "Custom Procurement Intelligence MCP Server",
    type: "custom",
    version: "2.0.0",
    description:
      "Built using @modelcontextprotocol/sdk over stdio. Statutory register lookups, PPRA price benchmarking, bilingual rulebook queries, citation-guarded flags, and dossier drafting.",
    tools: [
      "verify_statutory_registers",
      "benchmark_market_pricing",
      "query_compliance_rulebook",
      "flag_procurement_disqualification",
      "draft_evaluation_report",
    ],
  },
  BORROWED: {
    id: "official-filesystem-mcp",
    name: "Official Model Context Protocol Filesystem Server",
    type: "borrowed",
    package: "@modelcontextprotocol/server-filesystem",
    version: "1.0.0",
    justification:
      "Official @modelcontextprotocol/server-filesystem enforces sandboxed directory normalization, symlink escape protection, and read-only vault isolation.",
    tools: ["read_tender_dossier", "list_procurement_vault", "verify_document_checksum"],
  },
};

export async function executeMcpTool(toolName, inputArgs = {}, context = {}, runId = null) {
  const res = await fetch("/api/mcp/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolName,
      inputArgs,
      context: { source: "live_ui", ...context },
      runId,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "MCP server call failed");
    throw new Error(errText);
  }

  const { result, trace } = await res.json();
  if (trace) {
    pushToolTrace(trace);
  }

  recordAudit({
    action: `MCP Tool Call: ${toolName}`,
    tool: toolName,
    input: inputArgs,
    output: result,
  }).catch(() => {});

  return result;
}
