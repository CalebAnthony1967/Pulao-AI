import express from "express";
import fs from "fs/promises";
import path from "path";
import { createServer as createViteServer } from "vite";
import { streamSynthesis } from "./server/geminiClient";
import { resolveOutputLanguage, sanitizeUntrustedText } from "./server/language";
import { mcpManager, VAULT_SANDBOX_DIR } from "./server/mcpManager";
import { resumeMultiAgentAudit, runMultiAgentAudit } from "./server/multiAgentGraph";
import {
  getLastEvalReport,
  getRulebook,
  listAgentRuns,
  listMcpTraces,
  saveLastEvalReport,
  updateRulebook,
} from "./server/observabilityStore";
import { parsePacketBuffer } from "./server/pdfParser";

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  // Pre-connect stdio MCP servers silently on boot
  mcpManager.ensureConnected().catch((err) => {
    console.warn("[MCP] Deferred startup notice:", err?.message || err);
  });

  // 1. Health & MCP Transport Readiness
  app.get("/api/health", async (_req, res) => {
    const mcpHealth = await mcpManager.getHealth();
    const rulebook = await getRulebook();
    res.json({
      ok: true,
      service: "pulao-ai-server",
      port: PORT,
      gemini_configured: Boolean(process.env.GEMINI_API_KEY),
      ...mcpHealth,
      active_rulebook: rulebook.sector_mode,
    });
  });

  // 2. Upload & Real Page-by-Page PDF Extraction
  app.post("/api/packets/upload", async (req, res) => {
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
      await fs.writeFile(destPath, buffer);

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

  // 3. Real Stdio MCP Tool Execution Endpoint
  app.post("/api/mcp/call", async (req, res) => {
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

  // 4. Multi-Agent Streaming Evaluation Pipeline (SSE)
  app.post("/api/agent/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const writeEvent = (eventName: string, data: any) => {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
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
      res.end();
    }
  });

  // 4b. Resume Paused Multi-Agent Graph After Human Input / Approval (SSE)
  app.post("/api/agent/resume", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const writeEvent = (eventName: string, data: any) => {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { thread_id, run_id, decision = { action: "approve" } } = req.body || {};
      if (!thread_id) {
        writeEvent("error", { message: "thread_id is required to resume paused agent" });
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
      res.end();
    }
  });

  // 5. Bilingual Streaming Oversight Assistant (SSE, server-side @google/genai)
  app.post("/api/assistant/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const writeEvent = (eventName: string, data: any) => {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const {
        message = "",
        role = "officer",
        language = "auto",
        sectorMode = "public_ppada",
        context = {},
      } = req.body || {};

      const cleanUserMsg = sanitizeUntrustedText(String(message)).sanitized;
      const langInfo = resolveOutputLanguage(language, cleanUserMsg);
      const runs = await listAgentRuns(5);

      const fallbackReply =
        langInfo.resolved === "sw"
          ? `Muhtasari wa Pulao-AI (${sectorMode === "corporate_rfp" ? "Ununuzi wa Kampuni Binafsi" : "Sheria ya PPADA 2015"}):\n` +
            `• Kwa jukumu lako (${role}), kila bendera au onyo dhidi ya mzabuni lazima liwe na nambari halisi ya ukurasa na nukuu kutoka kwenye nyaraka.\n` +
            `• Sheria ya Afrika ya ununuzi inaweka uamuzi wa mwisho wa kutoa zabuni kwa Kamati ya Tathmini na Afisa Mhasibu — mfumo huu hauwezi kutoa zabuni kiotomatiki.\n` +
            `• Mbio za hivi karibuni zilizorekodiwa: ${runs.length}.`
          : `Pulao-AI Oversight Summary (${sectorMode === "corporate_rfp" ? "Corporate RFP / KYB Mode" : "Kenya PPADA 2015 Public Mode"}):\n` +
            `• Under your role (${role}), every compliance flag is gated behind verified document citations and verbatim quotes (Zero-Unsourced-Flag Rule).\n` +
            `• The agent prepares and verifies the evaluation dossier only — tender award and disqualification decisions remain strictly locked for the human Evaluation Committee.\n` +
            `• Observed recent verification runs: ${runs.length}.`;

      writeEvent("meta", {
        language_detected: langInfo.detected,
        language_resolved: langInfo.resolved,
        sector_mode: sectorMode,
      });

      const systemInstruction =
        langInfo.resolved === "sw"
          ? "Wewe ni Msaidizi wa Ukaguzi wa Zabuni wa Pulao-AI nchini Kenya. Jibu kwa Kiswahili fasaha na cha kitaalamu. Taja takwimu kutoka muktadha uliopewa pekee. Sisitiza kuwa kamati ya wanadamu pekee ndiyo hutoa zabuni."
          : "You are Pulao-AI, an authoritative Kenyan & enterprise procurement oversight assistant. Reply in crisp English citing ONLY verifiable facts from the provided context. Emphasize that the human committee prepares and signs off on awards.";

      const prompt = `Asker Role: ${role}
Governance Mode: ${sectorMode}
Recent Agent Runs: ${JSON.stringify(runs.slice(0, 3))}
Workspace Context Summary: ${JSON.stringify(context).slice(0, 5000)}

User Question: ${cleanUserMsg}`;

      const result = await streamSynthesis({
        modelId: "gemini-4-hydrogen",
        systemInstruction,
        prompt,
        fallbackText: fallbackReply,
        onThought: (text) => writeEvent("thinking_chunk", { text }),
        onToken: (text) => writeEvent("token_chunk", { text }),
      });

      // Detect action intent in user prompt so the assistant asks for approval before executing tools/rulebook mutations
      const lowerMsg = cleanUserMsg.toLowerCase();
      let actionProposal: Record<string, any> | null = null;
      const regMatch = cleanUserMsg.match(/\b((?:PVT|CPR|BN)-\d{4}-\d{4,7})\b/i);

      if (/corporate|rfp|private|binafsi|12%/i.test(lowerMsg) && /switch|change|set|use|badilisha|weka/i.test(lowerMsg)) {
        actionProposal = {
          action_id: `act_${Date.now()}`,
          tool_name: "update_compliance_rulebook",
          title_en: "Approve Switch to Corporate RFP Mode (+12% Ceiling & KYB)",
          title_sw: "Idhinisha Kuhamia Mfumo wa Kampuni Binafsi (+12% & KYB)",
          description_en: "Updates active organization rulebook to Corporate RFP with 12% max price variance and mandatory KYB/Insurance checks.",
          description_sw: "Inabadilisha kanuni za shirika kuwa Corporate RFP (kiwango cha 12% na ukaguzi wa KYB).",
          params: { sector_mode: "corporate_rfp", allowed_price_variance_pct: 12 },
        };
      } else if (/public|ppada|umma|15%/i.test(lowerMsg) && /switch|change|set|use|badilisha|weka/i.test(lowerMsg)) {
        actionProposal = {
          action_id: `act_${Date.now()}`,
          tool_name: "update_compliance_rulebook",
          title_en: "Approve Switch to Public Sector PPADA 2015 Mode (+15% Ceiling)",
          title_sw: "Idhinisha Kuhamia Sheria ya PPADA 2015 (+15% & AGPO)",
          description_en: "Updates active rulebook to Kenya Public Procurement (PPADA 2015 / OCDS) with 15% PPRA tolerance and AGPO verification.",
          description_sw: "Inabadilisha kanuni kuwa PPADA 2015 (kiwango cha 15% na ukaguzi wa AGPO).",
          params: { sector_mode: "public_ppada", allowed_price_variance_pct: 15 },
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
      res.end();
    }
  });

  // 5b. Execute Approved Assistant MCP / Rulebook Action
  app.post("/api/assistant/confirm-action", async (req, res) => {
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

  // 6. Observability, Rulebooks & Eval Endpoints
  app.get("/api/observability/runs", async (req, res) => {
    const rawSource = String(req.query?.source || "all");
    const source = rawSource === "live_ui" || rawSource === "eval" ? rawSource : "all";
    const tenderId = req.query?.tender_id ? String(req.query.tender_id) : undefined;
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));
    const runs = await listAgentRuns(limit, { source, tenderId });
    res.json({ runs });
  });

  app.get("/api/observability/traces", async (req, res) => {
    const rawSource = String(req.query?.source || "all");
    const source = rawSource === "live_ui" || rawSource === "eval" ? rawSource : "all";
    const tenderId = req.query?.tender_id ? String(req.query.tender_id) : undefined;
    const limit = Math.min(300, Math.max(1, Number(req.query?.limit) || 150));
    const [traces, runs] = await Promise.all([
      listMcpTraces(limit, { source, tenderId }),
      listAgentRuns(60, { source, tenderId }),
    ]);
    res.json({ traces, runs });
  });

  app.get("/api/rulebooks", async (_req, res) => {
    const rulebook = await getRulebook();
    res.json({ rulebook });
  });

  app.post("/api/rulebooks", async (req, res) => {
    const updated = await updateRulebook(req.body || {});
    res.json({ rulebook: updated });
  });

  app.get("/api/evals/latest", async (_req, res) => {
    try {
      const fileRaw = await fs.readFile(path.join(process.cwd(), "evals/results.json"), "utf8");
      return res.json(JSON.parse(fileRaw));
    } catch {
      const cached = await getLastEvalReport();
      return res.json(cached || { executed: false, summary: null, scenarios: [] });
    }
  });

  app.post("/api/evals/run", async (_req, res) => {
    try {
      const { runEvaluationSuite } = await import("./evals/run_evals.mjs");
      const report = await runEvaluationSuite({ trials: 3 });
      await saveLastEvalReport(report);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Eval suite failed" });
    }
  });

  // Frontend Serving (Vite Dev Middleware or Built Static Assets)
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: {
          ignored: ["**/vault_sandbox/**", "**/server/data/**", "**/evals/**", "**/mcp-server/**"],
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Pulao-AI server listening on http://localhost:${PORT} (mode: ${isProd ? "production" : "development"})`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
