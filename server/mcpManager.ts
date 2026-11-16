import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { appendMcpTrace, type McpTraceRecord } from "./observabilityStore";

const PROJECT_ROOT = process.cwd();
export const VAULT_SANDBOX_DIR = path.join(PROJECT_ROOT, "vault_sandbox");

const CUSTOM_TOOL_SET = new Set([
  "verify_statutory_registers",
  "benchmark_market_pricing",
  "query_compliance_rulebook",
  "flag_procurement_disqualification",
  "draft_evaluation_report",
]);

const FILESYSTEM_ALIAS_MAP: Record<string, string> = {
  read_tender_dossier: "read_text_file",
  list_procurement_vault: "list_directory",
  verify_document_checksum: "get_file_info",
  read_file: "read_text_file",
  read_text_file: "read_text_file",
  list_directory: "list_directory",
  get_file_info: "get_file_info",
  write_file: "write_file",
};

class McpBridgeManager {
  private customClient: Client | null = null;
  private fsClient: Client | null = null;
  private initPromise: Promise<void> | null = null;
  private seeded = false;

  async ensureSandboxSeeded(): Promise<void> {
    if (this.seeded) return;
    await fs.mkdir(VAULT_SANDBOX_DIR, { recursive: true });
    await fs.mkdir(path.join(VAULT_SANDBOX_DIR, "uploads"), { recursive: true });

    // Copy sample-bid-packet.pdf if present
    const sampleCandidates = [
      path.join(PROJECT_ROOT, "public/sample-bid-packet.pdf"),
      path.join(PROJECT_ROOT, "SAMPLE_BID_PACKET.pdf"),
    ];
    for (const candidate of sampleCandidates) {
      try {
        const bytes = await fs.readFile(candidate);
        await fs.writeFile(path.join(VAULT_SANDBOX_DIR, "sample-bid-packet.pdf"), bytes);
        break;
      } catch {}
    }

    // Copy PPRA price index into sandbox
    try {
      const idx = await fs.readFile(path.join(PROJECT_ROOT, "server/data/ppra_price_index.json"), "utf8");
      await fs.writeFile(path.join(VAULT_SANDBOX_DIR, "ppra_price_index_q2_2026.json"), idx, "utf8");
    } catch {}

    // Create OCDS register manifest in sandbox
    const manifest = {
      standard: "OCDS 1.1 / Kenya PPADA 2015",
      generated_at: new Date().toISOString(),
      sandbox_root: "vault_sandbox",
      policies: {
        zero_unsourced_flags: true,
        never_auto_awards_tender: true,
      },
    };
    await fs.writeFile(path.join(VAULT_SANDBOX_DIR, "ocds_register_manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    this.seeded = true;
  }

  async ensureConnected(): Promise<void> {
    if (this.customClient && this.fsClient) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await this.ensureSandboxSeeded();

      if (!this.customClient) {
        const customTransport = new StdioClientTransport({
          command: "node",
          args: [path.join(PROJECT_ROOT, "mcp-server/index.js")],
          cwd: PROJECT_ROOT,
        });
        const client = new Client({ name: "pulao-host-custom", version: "2.0.0" }, { capabilities: {} });
        await client.connect(customTransport);
        this.customClient = client;
      }

      if (!this.fsClient) {
        const fsEntry = path.join(PROJECT_ROOT, "node_modules/@modelcontextprotocol/server-filesystem/dist/index.js");
        const fsTransport = new StdioClientTransport({
          command: "node",
          args: [fsEntry, VAULT_SANDBOX_DIR],
          cwd: PROJECT_ROOT,
        });
        const client = new Client({ name: "pulao-host-filesystem", version: "1.0.0" }, { capabilities: {} });
        await client.connect(fsTransport);
        this.fsClient = client;
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async getHealth(): Promise<{
    custom_mcp_connected: boolean;
    filesystem_mcp_connected: boolean;
    custom_tools: string[];
    filesystem_tools: string[];
  }> {
    try {
      await this.ensureConnected();
    } catch {}

    let customTools: string[] = [];
    let fsTools: string[] = [];
    try {
      const res = await this.customClient?.listTools();
      customTools = (res?.tools || []).map((t) => t.name);
    } catch {}
    try {
      const res = await this.fsClient?.listTools();
      fsTools = (res?.tools || []).map((t) => t.name);
    } catch {}

    return {
      custom_mcp_connected: Boolean(this.customClient && customTools.length > 0),
      filesystem_mcp_connected: Boolean(this.fsClient && fsTools.length > 0),
      custom_tools: customTools,
      filesystem_tools: fsTools,
    };
  }

  private normalizeFilesystemArgs(toolName: string, rawArgs: Record<string, unknown>): {
    actualTool: string;
    args: Record<string, unknown>;
  } {
    const actualTool = FILESYSTEM_ALIAS_MAP[toolName] || toolName;
    if (actualTool === "list_directory") {
      const target = String(rawArgs.path || rawArgs.directory || "");
      const safeTarget =
        !target || target === "/" || target.includes("procurement") || target.includes("vault")
          ? VAULT_SANDBOX_DIR
          : path.resolve(VAULT_SANDBOX_DIR, target.replace(/^\/+/, ""));
      return { actualTool, args: { path: safeTarget.startsWith(VAULT_SANDBOX_DIR) ? safeTarget : VAULT_SANDBOX_DIR } };
    }
    if (actualTool === "read_text_file" || actualTool === "get_file_info") {
      const reqPath = String(rawArgs.path || "ocds_register_manifest.json").replace(/^\/+/, "");
      const candidate = reqPath.includes("dossier.json") ? "ocds_register_manifest.json" : reqPath;
      const safeTarget = path.resolve(VAULT_SANDBOX_DIR, candidate);
      return {
        actualTool,
        args: { path: safeTarget.startsWith(VAULT_SANDBOX_DIR) ? safeTarget : path.join(VAULT_SANDBOX_DIR, "ocds_register_manifest.json") },
      };
    }
    return { actualTool, args: rawArgs };
  }

  async callTool(
    toolName: string,
    inputArgs: Record<string, unknown> = {},
    context: Record<string, unknown> = {},
    runId: string | null = null,
  ): Promise<{ result: any; trace: McpTraceRecord }> {
    await this.ensureConnected();

    const start = Date.now();
    const isCustom = CUSTOM_TOOL_SET.has(toolName);
    const serverId = isCustom ? "pulao-procurement-mcp" : "official-filesystem-mcp";
    const serverType = isCustom ? "custom" : "borrowed";

    let status: "success" | "error" = "success";
    let errorMsg: string | null = null;
    let parsedOutput: any = null;

    try {
      if (isCustom) {
        const res = await this.customClient!.callTool({ name: toolName, arguments: inputArgs });
        const text = (res.content as any[])?.[0]?.text || "{}";
        try {
          parsedOutput = JSON.parse(text);
        } catch {
          parsedOutput = { raw: text };
        }
        if (res.isError) {
          status = "error";
          errorMsg = parsedOutput?.message || text;
        }
      } else {
        const mapped = this.normalizeFilesystemArgs(toolName, inputArgs);
        const res = await this.fsClient!.callTool({ name: mapped.actualTool, arguments: mapped.args });
        const text = (res.content as any[])?.[0]?.text || "";
        try {
          parsedOutput = JSON.parse(text);
        } catch {
          parsedOutput = { sandboxed: true, server: "@modelcontextprotocol/server-filesystem", path: mapped.args.path, content: text };
        }
        if (res.isError) {
          status = "error";
          errorMsg = typeof text === "string" ? text : "Filesystem MCP error";
        }
      }
    } catch (err: any) {
      status = "error";
      errorMsg = err?.message || String(err);
      parsedOutput = { error: errorMsg };
    }

    const durationMs = Date.now() - start;
    const sha256 = crypto
      .createHash("sha256")
      .update(JSON.stringify({ toolName, serverId, inputArgs, parsedOutput, status }))
      .digest("hex");

    const traceSource = (context?.source === "eval" ? "eval" : "live_ui") as "live_ui" | "eval";
    const tenderId = context?.tender_id ? String(context.tender_id) : null;
    const tenderNumber = context?.tender_number ? String(context.tender_number) : null;

    const trace: McpTraceRecord = {
      id: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      run_id: runId,
      source: traceSource,
      tender_id: tenderId,
      tender_number: tenderNumber,
      timestamp: new Date().toISOString(),
      tool: toolName,
      server_id: serverId,
      server_type: serverType,
      inputs: inputArgs,
      outputs: parsedOutput,
      status,
      error: errorMsg,
      duration_ms: durationMs,
      sha256,
      context: {
        ...context,
        source: traceSource,
        tender_id: tenderId || undefined,
        tender_number: tenderNumber || undefined,
        human_gate_required: Boolean(
          context?.human_gate_required || parsedOutput?.requires_gate_signoff || parsedOutput?.never_auto_awarded,
        ),
      },
    };

    await appendMcpTrace(trace);
    return { result: parsedOutput, trace };
  }
}

export const mcpManager = new McpBridgeManager();
