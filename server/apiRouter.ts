import express from "express";
import fs from "fs/promises";
import path from "path";
import { streamSynthesis } from "./geminiClient";
import { resolveOutputLanguage, sanitizeUntrustedText } from "./language";
import { mcpManager, VAULT_SANDBOX_DIR } from "./mcpManager";
import { resumeMultiAgentAudit, runMultiAgentAudit } from "./multiAgentGraph";
import {
  getLastEvalReport,
  getRulebook,
  listAgentRuns,
  listMcpTraces,
  saveLastEvalReport,
  updateRulebook,
} from "./observabilityStore";
import { parsePacketBuffer } from "./pdfParser";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://ohziashwykmpnjlnyaxt.supabase.co";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_6FVLfdZdJXv_ZqqsF5Ufpg_DsMae3qc";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function createApiRouter() {
  const router = express.Router();

  // Ensure MCP connected
  mcpManager.ensureConnected().catch(() => {});

  router.get("/health", async (_req, res) => {
    try {
      const mcpHealth = await mcpManager.getHealth();
      const rulebook = await getRulebook();
      res.json({
        ok: true,
        service: "pulao-ai-server",
        gemini_configured: Boolean(process.env.GEMINI_API_KEY),
        ...mcpHealth,
        active_rulebook: rulebook.sector_mode,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Health check failed" });
    }
  });

  router.post("/packets/upload", async (req, res) => {
    try {
      const { fileName = "bid-packet.pdf", base64Data = "" } = req.body || {};
      if (!base64Data) {
        return res.status(400).json({ error: "Missing base64Data payload" });
      }
      const cleanBase64 = String(base64Data).includes(",")
        ? String(base64Data).split(",")[1]
        : String(base64Data);
      const buffer = Buffer.from(cleanBase64, "base64");

      const safeFileName = `${Date.now()}_${path.basename(String(fileName)).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await mcpManager.ensureSandboxSeeded();
      const destPath = path.join(VAULT_SANDBOX_DIR, "uploads", safeFileName);
      await fs.writeFile(destPath, buffer).catch(() => {});

      const parsed = await parsePacketBuffer(buffer, safeFileName);
      res.json({
        uri: `/uploads/${safeFileName}`,
        fileName: parsed.documentName,
        size: buffer.length,
        totalPages: parsed.totalPages,
        averageOcrConfidence: parsed.averageOcrConfidence,
        lowOcrDetected: parsed.lowOcrDetected,
        sha256: parsed.metadata.fingerprint,
        metadata: parsed.metadata,
        extractedSignals: parsed.extractedSignals,
        pages: parsed.pages,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to parse uploaded packet" });
    }
  });

  router.post("/mcp/call", async (req, res) => {
    try {
      const { toolName, inputArgs = {}, context = {}, runId = null } = req.body || {};
      if (!toolName) {
        return res.status(400).json({ error: "toolName is required" });
      }
      const { result, trace } = await mcpManager.callTool(toolName, inputArgs, context, runId);
      res.json({ result, trace });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "MCP invocation failed" });
    }
  });

  router.post("/agent/stream", async (req, res) => {
    try {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    } catch {}

    const writeEvent = (eventName: string, data: any) => {
      try {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };

    try {
      const {
        tender,
        bids = [],
        priceIndex = [],
        modelEngine = "gemini-4-hydrogen",
        language = "auto",
        sectorMode,
      } = req.body || {};

      await runMultiAgentAudit({
        tender,
        bids,
        priceIndex,
        modelEngine,
        languageRequested: language,
        sectorModeOverride: sectorMode,
        source: "live_ui",
        emitter: ({ type, data }) => writeEvent(type, data),
      });
    } catch (err: any) {
      writeEvent("error", { message: err?.message || "Multi-agent execution failed" });
    } finally {
      try {
        res.end();
      } catch {}
    }
  });

  router.post("/agent/resume", async (req, res) => {
    try {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    } catch {}

    const writeEvent = (eventName: string, data: any) => {
      try {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };

    try {
      const { thread_id, run_id, decision = { action: "approve" } } = req.body || {};
      if (!thread_id) {
        writeEvent("error", { message: "thread_id is required to resume paused agent" });
        res.end();
        return;
      }

      await resumeMultiAgentAudit({
        threadId: String(thread_id),
        runId: run_id ? String(run_id) : String(thread_id),
        decision,
        emitter: ({ type, data }) => writeEvent(type, data),
      });
    } catch (err: any) {
      writeEvent("error", { message: err?.message || "Failed to resume paused agent" });
    } finally {
      try {
        res.end();
      } catch {}
    }
  });

  router.post("/assistant/stream", async (req, res) => {
    try {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
    } catch {}

    const writeEvent = (eventName: string, data: any) => {
      try {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };

    try {
      const { message = "", history = [], sectorMode = "public_ppada" } = req.body || {};
      const langInfo = resolveOutputLanguage(message);
      const cleanMsg = sanitizeUntrustedText(message);

      writeEvent("thought", { text: "Analyzing oversight query across compliance rulebooks and statutory registers..." });

      const systemPrompt = `You are Pulao-AI Sovereign Oversight Assistant for East African public and private procurement (Kenya PPADA 2015 / OCDS). Answer precisely with verified citations. User language resolved: ${langInfo.resolved}. Sector mode: ${sectorMode}.`;

      const contents = [
        ...history.slice(-6).map((h: any) => ({
          role: h.role === "user" ? "user" : "model",
          parts: [{ text: h.text }],
        })),
        { role: "user", parts: [{ text: cleanMsg }] },
      ];

      const result = await streamSynthesis({
        contents,
        systemInstruction: systemPrompt,
        temperature: 0.2,
        onChunk: (chunk) => {
          writeEvent("chunk", { text: chunk });
        },
      });

      let actionProposal = null;
      const lowerMsg = cleanMsg.toLowerCase();
      const regMatch = cleanMsg.match(/(?:CPR-\d{4}-\d+|PVT-\d{4}-\d+|REG-\d+)/i);

      if (/rulebook|variance|threshold|ceiling/i.test(lowerMsg)) {
        actionProposal = {
          action_id: `act_${Date.now()}`,
          tool_name: "update_compliance_rulebook",
          title_en: "Update Compliance Rulebook & Price Variance Threshold",
          title_sw: "Sasisha Mwongozo wa Sheria na Kikomo cha Bei",
          description_en: "Adjust active compliance tolerance and statutory validation checks for the current procurement session.",
          description_sw: "Rekebisha kiwango cha kufuata sheria na ukaguzi wa kisheria kwa kipindi hiki cha ununuzi.",
          params: { allowed_price_variance_pct: 12.5, sector_mode: sectorMode },
        };
      } else if (regMatch || (/check|verify|lookup|kagua|thibitisha/i.test(lowerMsg) && /register|kra|brs|cheti/i.test(lowerMsg))) {
        const reg = regMatch?.[1] || "PVT-2024-889911";
        actionProposal = {
          action_id: `act_${Date.now()}`,
          tool_name: "verify_statutory_registers",
          title_en: `Approve MCP Lookup: verify_statutory_registers (${reg})`,
          title_sw: `Idhinisha Zana ya MCP: verify_statutory_registers (${reg})`,
          description_en: `Staged stdio MCP query to inspect KRA Tax, BRS Company Status, NSSF, SHA/SHIF, and PPRA debarment for ${reg}.`,
          description_sw: `Zana ya MCP iko tayari kukagua KRA, BRS, NSSF, SHA/SHIF na PPRA kwa usajili ${reg}.`,
          params: { company_registration_no: reg, company_name: reg, sector_mode: sectorMode },
        };
      }

      if (actionProposal) {
        writeEvent("action_proposal", actionProposal);
      }

      writeEvent("complete", {
        text: result.text,
        telemetry: result.telemetry,
        language_detected: langInfo.detected,
        language_resolved: langInfo.resolved,
        action_proposal: actionProposal,
      });
    } catch (err: any) {
      writeEvent("error", { message: err?.message || "Assistant stream failed" });
    } finally {
      try {
        res.end();
      } catch {}
    }
  });

  router.post("/assistant/confirm-action", async (req, res) => {
    try {
      const { tool_name, params = {}, approved = true } = req.body || {};
      if (!approved) {
        return res.json({ status: "rejected_by_human", message: "Action blocked by user." });
      }
      if (tool_name === "update_compliance_rulebook") {
        const updated = await updateRulebook(params);
        return res.json({ status: "executed", rulebook: updated });
      }
      if (tool_name === "verify_statutory_registers") {
        const { result, trace } = await mcpManager.callTool(
          "verify_statutory_registers",
          params,
          {
            agent: "pulao_assistant",
            agent_label: "Oversight Assistant",
            step_order: 1,
            bidder_name: String(params?.company_name || params?.company_registration_no || "Supplier"),
            reason: `Officer-approved statutory register lookup for ${params?.company_registration_no || "requested supplier"}`,
            source: "live_ui",
            human_approved: true,
          },
          null,
        );
        return res.json({ status: "executed", result, trace });
      }
      return res.status(400).json({ error: `Unsupported action tool: ${tool_name}` });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to execute approved action" });
    }
  });

  router.get("/observability/runs", async (req, res) => {
    try {
      const rawSource = String(req.query?.source || "all");
      const source = rawSource === "live_ui" || rawSource === "eval" ? rawSource : "all";
      const tenderId = req.query?.tender_id ? String(req.query.tender_id) : undefined;
      const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));
      const runs = await listAgentRuns(limit, { source, tenderId });
      res.json({ runs });
    } catch (err: any) {
      res.json({ runs: [], error: err?.message });
    }
  });

  router.get("/observability/traces", async (req, res) => {
    try {
      const rawSource = String(req.query?.source || "all");
      const source = rawSource === "live_ui" || rawSource === "eval" ? rawSource : "all";
      const tenderId = req.query?.tender_id ? String(req.query.tender_id) : undefined;
      const limit = Math.min(300, Math.max(1, Number(req.query?.limit) || 150));
      const [traces, runs] = await Promise.all([
        listMcpTraces(limit, { source, tenderId }),
        listAgentRuns(60, { source, tenderId }),
      ]);
      res.json({ traces, runs });
    } catch (err: any) {
      res.json({ traces: [], runs: [], error: err?.message });
    }
  });

  router.get("/rulebooks", async (_req, res) => {
    try {
      const rulebook = await getRulebook();
      res.json({ rulebook });
    } catch (err: any) {
      res.json({ rulebook: { sector_mode: "public_ppada", allowed_price_variance_pct: 15, require_agpo_check: true } });
    }
  });

  router.post("/rulebooks", async (req, res) => {
    try {
      const updated = await updateRulebook(req.body || {});
      res.json({ rulebook: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to update rulebook" });
    }
  });

  router.get("/evals/latest", async (_req, res) => {
    try {
      const fileRaw = await fs.readFile(path.join(process.cwd(), "evals/results.json"), "utf8");
      return res.json(JSON.parse(fileRaw));
    } catch {
      const cached = await getLastEvalReport();
      return res.json(cached || { executed: false, summary: null, scenarios: [] });
    }
  });

  router.post("/evals/run", async (_req, res) => {
    try {
      const { runEvaluationSuite } = await import("../evals/run_evals.mjs");
      const report = await runEvaluationSuite({ trials: 3 });
      await saveLastEvalReport(report);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Eval suite failed" });
    }
  });

  router.get("/governance/overview", async (_req, res) => {
    try {
      const { data, error } = await supabase.rpc("get_system_governance_overview");
      if (error) throw error;
      res.json(data || {});
    } catch (err: any) {
      res.json({ tenders_count: 0, bids_count: 0, agent_runs_count: 0, audit_logs_count: 0, status: "fallback" });
    }
  });

  router.post("/control-params", async (req, res) => {
    try {
      const { key, value, admin = "Administrator", name = "Governance Parameter" } = req.body || {};
      if (!key) return res.status(400).json({ error: "key is required" });
      const { error } = await supabase.rpc("update_system_control_param", {
        p_key: key,
        p_value: value,
        p_admin: admin,
        p_name: name,
      });
      if (error) throw error;
      res.json({ status: "success", key, value });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to update control parameter" });
    }
  });

  return router;
}
