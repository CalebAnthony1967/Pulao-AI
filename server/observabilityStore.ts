import fs from "fs/promises";
import path from "path";

const STORE_PATH = process.env.VERCEL
  ? path.resolve("/tmp", "observability_store.json")
  : path.resolve(process.cwd(), "server/data/observability_store.json");

export interface AgentRunRecord {
  run_id: string;
  source?: "live_ui" | "eval";
  tender_id: string;
  tender_number: string;
  sector_mode: "public_ppada" | "corporate_rfp";
  model_id: string;
  execution_backend: string;
  supervisor_rationale?: string;
  language_requested: string;
  language_detected: string;
  language_resolved: string;
  status: string;
  nodes_executed: string[];
  retry_count: number;
  human_escalations: number;
  unverified_claims_suppressed: number;
  interrupt_count?: number;
  human_decision?: string;
  human_wait_ms?: number;
  approved_actions?: number;
  rejected_actions?: number;
  prompt_tokens: number;
  completion_tokens: number;
  thinking_tokens: number;
  estimated_cost_usd: number;
  estimated_cost_kes: number;
  latency_ms: number;
  created_at: string;
}

export interface McpTraceRecord {
  id: string;
  run_id: string | null;
  source?: "live_ui" | "eval";
  tender_id?: string | null;
  tender_number?: string | null;
  timestamp: string;
  tool: string;
  server_id: string;
  server_type: "custom" | "borrowed";
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  status: "success" | "error" | "awaiting_approval" | "rejected_by_human";
  error?: string | null;
  duration_ms: number;
  human_approval_ms?: number;
  sha256: string;
  context?: {
    agent?: string;
    agent_label?: string;
    step_order?: number;
    bid_id?: string;
    bidder_name?: string;
    reason?: string;
    source?: "live_ui" | "eval";
    tender_id?: string;
    tender_number?: string;
    human_gate_required?: boolean;
    [key: string]: unknown;
  };
}

export interface RulebookConfig {
  sector_mode: "public_ppada" | "corporate_rfp";
  allowed_price_variance_pct: number;
  require_agpo_check: boolean;
  require_kyb_insurance: boolean;
  updated_at: string;
}

interface StoreShape {
  rulebook: RulebookConfig;
  runs: AgentRunRecord[];
  traces: McpTraceRecord[];
  lastEvalReport: Record<string, unknown> | null;
}

const DEFAULT_STORE: StoreShape = {
  rulebook: {
    sector_mode: "public_ppada",
    allowed_price_variance_pct: 15,
    require_agpo_check: true,
    require_kyb_insurance: false,
    updated_at: new Date().toISOString(),
  },
  runs: [],
  traces: [],
  lastEvalReport: null,
};

let memoryStore: StoreShape = { ...DEFAULT_STORE };
let writeQueue: Promise<void> = Promise.resolve();

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      rulebook: { ...DEFAULT_STORE.rulebook, ...(parsed.rulebook || {}) },
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      traces: Array.isArray(parsed.traces) ? parsed.traces : [],
      lastEvalReport: parsed.lastEvalReport || null,
    };
  } catch {
    return memoryStore;
  }
}

async function writeStore(next: StoreShape): Promise<void> {
  memoryStore = next;
  writeQueue = writeQueue.then(async () => {
    try {
      await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
      await fs.writeFile(STORE_PATH, JSON.stringify(next, null, 2), "utf8");
    } catch {
      // Ignore filesystem write errors in serverless read-only mode
    }
  });
  await writeQueue;
}

export async function getRulebook(): Promise<RulebookConfig> {
  const store = await readStore();
  return store.rulebook;
}

export async function updateRulebook(patch: Partial<RulebookConfig>): Promise<RulebookConfig> {
  const store = await readStore();
  const nextMode =
    patch.sector_mode === "corporate_rfp"
      ? "corporate_rfp"
      : patch.sector_mode === "public_ppada"
        ? "public_ppada"
        : store.rulebook.sector_mode;
  store.rulebook = {
    ...store.rulebook,
    ...patch,
    sector_mode: nextMode,
    allowed_price_variance_pct:
      Number(patch.allowed_price_variance_pct) > 0
        ? Number(patch.allowed_price_variance_pct)
        : nextMode === "corporate_rfp"
          ? 12
          : 15,
    require_agpo_check: nextMode === "public_ppada",
    require_kyb_insurance: nextMode === "corporate_rfp",
    updated_at: new Date().toISOString(),
  };
  await writeStore(store);
  return store.rulebook;
}

export async function appendAgentRun(run: AgentRunRecord): Promise<void> {
  const store = await readStore();
  const normalized: AgentRunRecord = {
    ...run,
    source: run.source || "live_ui",
  };
  const idx = store.runs.findIndex((r) => r.run_id === normalized.run_id);
  if (idx >= 0) {
    store.runs[idx] = { ...store.runs[idx], ...normalized };
  } else {
    store.runs.unshift(normalized);
  }

  const liveRuns = store.runs.filter((r) => (r.source || "eval") === "live_ui").slice(0, 60);
  const evalRuns = store.runs.filter((r) => r.source === "eval").slice(0, 60);
  store.runs = [...liveRuns, ...evalRuns].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  await writeStore(store);
}

export async function listAgentRuns(
  limit = 30,
  opts: { source?: "live_ui" | "eval" | "all"; tenderId?: string } = {},
): Promise<AgentRunRecord[]> {
  const store = await readStore();
  let rows = store.runs;
  if (opts.source && opts.source !== "all") {
    rows = rows.filter((r) => r.source === opts.source);
  }
  if (opts.tenderId) {
    rows = rows.filter((r) => r.tender_id === opts.tenderId);
  }
  return rows.slice(0, limit);
}

export async function appendMcpTrace(trace: McpTraceRecord): Promise<void> {
  const store = await readStore();
  const source: "live_ui" | "eval" =
    trace.source || (trace.context?.source as "live_ui" | "eval") || "live_ui";
  const normalized: McpTraceRecord = {
    ...trace,
    source,
    tender_id: trace.tender_id ?? (trace.context?.tender_id as string) ?? null,
    tender_number: trace.tender_number ?? (trace.context?.tender_number as string) ?? null,
  };

  const idx = store.traces.findIndex((t) => t.id === normalized.id);
  if (idx >= 0) {
    store.traces[idx] = normalized;
  } else {
    store.traces.unshift(normalized);
  }

  const liveTraces = store.traces.filter((t) => t.source === "live_ui").slice(0, 200);
  const evalTraces = store.traces.filter((t) => t.source === "eval").slice(0, 150);
  store.traces = [...liveTraces, ...evalTraces].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  await writeStore(store);
}

export async function listMcpTraces(
  limit = 100,
  opts: { source?: "live_ui" | "eval" | "all"; tenderId?: string } = {},
): Promise<McpTraceRecord[]> {
  const store = await readStore();
  let rows = store.traces;
  if (opts.source && opts.source !== "all") {
    rows = rows.filter((t) => t.source === opts.source);
  }
  if (opts.tenderId) {
    rows = rows.filter((t) => !t.tender_id || t.tender_id === opts.tenderId);
  }
  return rows.slice(0, limit);
}

export async function saveLastEvalReport(report: Record<string, unknown>): Promise<void> {
  const store = await readStore();
  store.lastEvalReport = report;
  await writeStore(store);
}

export async function getLastEvalReport(): Promise<Record<string, unknown> | null> {
  const store = await readStore();
  return store.lastEvalReport;
}
