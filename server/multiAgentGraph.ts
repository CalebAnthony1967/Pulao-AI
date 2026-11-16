import { Annotation, Command, END, MemorySaver, START, StateGraph, interrupt } from "@langchain/langgraph";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { generateSupervisorRationale, streamSynthesis } from "./geminiClient";
import { resolveOutputLanguage, sanitizeUntrustedText, type LanguageCode } from "./language";
import { mcpManager, VAULT_SANDBOX_DIR } from "./mcpManager";
import { appendAgentRun, appendMcpTrace, getRulebook, type McpTraceRecord } from "./observabilityStore";
import { parsePacketBuffer, type ParsedPacketResult } from "./pdfParser";

export interface StreamEmitter {
  (event: { type: string; data: any }): void;
}

export interface GroundedFinding {
  key: string;
  severity: "critical" | "warning" | "info";
  category: "statutory" | "pricing" | "collusion" | "ocr_review" | "security";
  title: string;
  detail: string;
  title_sw: string;
  detail_sw: string;
  citation: {
    document_name: string;
    page: number;
    section: string;
    verbatim_quote: string;
    confidence: number;
  };
  grounded: boolean;
}

export interface StagedDisqualification {
  traceId: string;
  stepOrder: number;
  bidId: string;
  bidderName: string;
  category: "statutory" | "pricing" | "collusion";
  key: string;
  title: string;
  detail: string;
  title_sw: string;
  detail_sw: string;
  citation: GroundedFinding["citation"];
  mcpArgs: Record<string, any>;
}

export interface HitlInterruptPayload {
  interrupt_id: string;
  thread_id: string;
  run_id: string;
  gate_type: "ocr_clarification" | "pricing_benchmark" | "pre_execution_approval" | "final_dossier_lock";
  title_en: string;
  title_sw: string;
  prompt_en: string;
  prompt_sw: string;
  pending_mcp_tool: string;
  proposed_args: Record<string, any>;
  evidence_citation: {
    document_name: string;
    page: number;
    section: string;
    verbatim_quote: string;
  } | null;
  requires_input?: {
    field: string;
    label_en: string;
    label_sw: string;
    placeholder: string;
    inputType: "text" | "number";
  } | null;
  options: Array<{
    id: string;
    action: string;
    label_en: string;
    label_sw: string;
    tone: "primary" | "caution" | "critical" | "outline";
  }>;
}

interface ActiveRunSession {
  startTime: number;
  source: "live_ui" | "eval";
  stepCounter: number;
  supervisorRationale: string;
  rationaleSource: "gemini" | "deterministic";
  interruptedAt: number | null;
  interruptCount: number;
  humanWaitMs: number;
  approvedActions: number;
  rejectedActions: number;
  lastDecision: string;
  tender: any;
  bids: any[];
  modelEngine: string;
  sectorMode: "public_ppada" | "corporate_rfp";
  languageRequested: string;
  languageDetected: LanguageCode;
  languageResolved: LanguageCode;
}

const sharedCheckpointer = new MemorySaver();
const activeEmitters = new Map<string, StreamEmitter>();
const activeSessions = new Map<string, ActiveRunSession>();

function nextStep(threadId: string): number {
  const sess = activeSessions.get(threadId);
  if (!sess) return 1;
  sess.stepCounter += 1;
  return sess.stepCounter;
}

function emitRunEvent(runId: string, type: string, data: any) {
  try {
    activeEmitters.get(runId)?.({ type, data });
  } catch {}
}

const AgentState = Annotation.Root({
  runId: Annotation<string>(),
  threadId: Annotation<string>(),
  source: Annotation<"live_ui" | "eval">(),
  tender: Annotation<any>(),
  bids: Annotation<any[]>(),
  priceIndex: Annotation<any[]>(),
  modelEngine: Annotation<string>(),
  languageRequested: Annotation<string>(),
  languageDetected: Annotation<LanguageCode>(),
  languageResolved: Annotation<LanguageCode>(),
  sectorMode: Annotation<"public_ppada" | "corporate_rfp">(),
  allowedVariancePct: Annotation<number>(),
  supervisorRationale: Annotation<string>(),
  rationaleSource: Annotation<string>(),
  plan: Annotation<string[]>(),
  packets: Annotation<Record<string, ParsedPacketResult>>(),
  lowOcrBids: Annotation<string[]>(),
  missingRegBids: Annotation<string[]>(),
  manualRegOverrides: Annotation<Record<string, string>>(),
  clarificationIssuedBids: Annotation<string[]>(),
  recoveryAttempts: Annotation<number>(),
  statutoryVerdicts: Annotation<Record<string, any>>(),
  pricingVerdicts: Annotation<Record<string, any>>(),
  collusionSignals: Annotation<any[]>(),
  unbenchmarkedItems: Annotation<Array<{ bidId: string; bidderName: string; description: string; unitPrice: number; documentName: string; page: number }>>(),
  stagedDisqualifications: Annotation<StagedDisqualification[]>(),
  rawFindingsByBid: Annotation<Record<string, GroundedFinding[]>>(),
  verifiedFindingsByBid: Annotation<Record<string, GroundedFinding[]>>(),
  unverifiedSuppressedCount: Annotation<number>(),
  evaluations: Annotation<any[]>(),
  bilingualBrief: Annotation<string>(),
  thoughts: Annotation<string>(),
  telemetry: Annotation<any>(),
  nodesExecuted: Annotation<string[]>(),
});

async function resolvePacketForBid(bid: any): Promise<ParsedPacketResult> {
  if (bid?.inline_packet_text) {
    return parsePacketBuffer(
      Buffer.from(String(bid.inline_packet_text), "utf8"),
      bid.inline_packet_name || `${bid.bidder_name || "bid"}_dossier.txt`,
    );
  }

  const urls: string[] = Array.isArray(bid?.document_urls) ? bid.document_urls : [];
  for (const uri of urls) {
    const clean = String(uri || "");
    const candidatePaths = [
      path.join(VAULT_SANDBOX_DIR, "uploads", path.basename(clean)),
      path.join(VAULT_SANDBOX_DIR, path.basename(clean)),
      path.join(process.cwd(), "public", clean.replace(/^\/+/, "")),
    ];
    for (const cand of candidatePaths) {
      try {
        const buf = await fs.readFile(cand);
        return await parsePacketBuffer(buf, path.basename(cand));
      } catch {}
    }
  }

  const itemsText = (Array.isArray(bid?.line_items) ? bid.line_items : [])
    .map(
      (it: any, idx: number) =>
        `${idx + 1}. ${it.description} | Qty: ${it.quantity || 1} | Unit Price: KES ${Number(it.unit_price || 0).toLocaleString()}`,
    )
    .join("\n");

  const fallbackDossier = [
    `BID SUBMISSION FORM & COVER DECLARATION`,
    `Tender Reference: ${bid?.tender_number || "N/A"}`,
    `Bidding Entity: ${bid?.bidder_name || "Unnamed Bidder"}`,
    `Registration Number: ${bid?.registration_number || "UNSPECIFIED"}`,
    `Total Quoted Amount: KES ${Number(bid?.quoted_amount || 0).toLocaleString()}`,
    `---PAGE BREAK---`,
    `SCHEDULE OF PRICES & LINE ITEMS`,
    itemsText || "No itemized schedule provided.",
  ].join("\n");

  return parsePacketBuffer(Buffer.from(fallbackDossier, "utf8"), `${bid?.bidder_name || "bid"}_declared_schedule.txt`);
}

function quoteExistsInEvidence(quote: string, packetText: string, evidenceTexts: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const q = norm(quote);
  if (!q || q.length < 4) return false;
  if (norm(packetText).includes(q)) return true;
  return evidenceTexts.some((e) => norm(e).includes(q));
}

function buildWorkflow() {
  const workflow = new StateGraph(AgentState)
    /* 1. SUPERVISOR PLANNER */
    .addNode("supervisor_planner", async (state) => {
      const sess = activeSessions.get(state.threadId);
      const startTime = sess?.startTime || Date.now();
      const tenderId = state.tender?.id || "tnd_01";
      const tenderNumber = state.tender?.tender_number || "TNT-2026";
      const runSource = state.source || "live_ui";

      emitRunEvent(state.runId, "node_event", {
        node: "supervisor_planner",
        status: "running",
        label: "Supervisor planning verification graph, rulebook & HITL approval gates",
      });

      const rationalePromise = generateSupervisorRationale({
        modelId: state.modelEngine,
        tenderTitle: state.tender?.title || "Procurement Evaluation",
        tenderNumber,
        sectorMode: state.sectorMode,
        bidsCount: state.bids.length,
        languageResolved: state.languageResolved,
        isEval: runSource === "eval",
      });

      const { result: rulebookDoc, trace } = await mcpManager.callTool(
        "query_compliance_rulebook",
        { sector_mode: state.sectorMode, language: state.languageResolved },
        {
          agent: "supervisor_planner",
          agent_label: "Supervisor Planner",
          step_order: nextStep(state.threadId),
          reason: `Load active ${state.sectorMode === "corporate_rfp" ? "Corporate RFP (+12%)" : "Kenya PPADA 2015 (+15%)"} rulebook thresholds before scanning bids`,
          source: runSource,
          tender_id: tenderId,
          tender_number: tenderNumber,
        },
        state.runId,
      );
      emitRunEvent(state.runId, "mcp_call", trace);

      const { trace: fsTrace } = await mcpManager.callTool(
        "list_procurement_vault",
        { directory: "/" },
        {
          agent: "supervisor_planner",
          agent_label: "Supervisor Planner",
          step_order: nextStep(state.threadId),
          reason: "Inspect sandboxed procurement dossier directory & vault isolation boundaries",
          source: runSource,
          tender_id: tenderId,
          tender_number: tenderNumber,
        },
        state.runId,
      );
      emitRunEvent(state.runId, "mcp_call", fsTrace);

      const rationaleResult = await rationalePromise;
      if (sess) {
        sess.supervisorRationale = rationaleResult.rationale;
        sess.rationaleSource = rationaleResult.source;
      }

      const plan = [
        `Rulebook: ${rulebookDoc?.title_en || state.sectorMode}`,
        `Step 1: Parse ${state.bids.length} bid dossier(s) page-by-page & verify OCR quality / prompt-injection hygiene`,
        `Step 2: Pause for human clarification if OCR confidence < 55% or Registration Number is missing (Gate 1)`,
        `Step 3: Execute statutory/KYB register lookups & PPRA Q2 2026 price benchmarking via stdio MCP`,
        `Step 4: Pause for market quote or survey approval on unbenchmarked items (Gate 2)`,
        `Step 5: Pause before executing flag_procurement_disqualification on critical findings (Gate 3 — Human Approval)`,
        `Step 6: Enforce Citation Guard & confirm bilingual (${state.languageResolved.toUpperCase()}) dossier lock (Gate 4)`,
      ];

      emitRunEvent(state.runId, "plan", {
        run_id: state.runId,
        thread_id: state.threadId,
        tender_id: tenderId,
        tender_number: tenderNumber,
        sector_mode: state.sectorMode,
        language_detected: state.languageDetected,
        language_resolved: state.languageResolved,
        supervisor_rationale: rationaleResult.rationale,
        rationale_source: rationaleResult.source,
        steps: plan,
      });
      emitRunEvent(state.runId, "node_event", {
        node: "supervisor_planner",
        status: "completed",
        elapsed_ms: Date.now() - startTime,
      });

      return {
        plan,
        supervisorRationale: rationaleResult.rationale,
        rationaleSource: rationaleResult.source,
        nodesExecuted: [...(state.nodesExecuted || []), "supervisor_planner"],
      };
    })

    /* 2. INTAKE & OCR NODE */
    .addNode("intake_and_ocr", async (state) => {
      const sess = activeSessions.get(state.threadId);
      const startTime = sess?.startTime || Date.now();
      emitRunEvent(state.runId, "node_event", {
        node: "intake_and_ocr",
        status: "running",
        label: "Extracting PDF pages, OCR confidence & sanitizing untrusted inputs",
      });

      const packets: Record<string, ParsedPacketResult> = {};
      const lowOcrBids: string[] = [];
      const missingRegBids: string[] = [];

      for (const bid of state.bids) {
        const parsed = await resolvePacketForBid(bid);
        packets[bid.id] = parsed;
        if (parsed.lowOcrDetected) {
          lowOcrBids.push(bid.id);
        }
        const extractedReg =
          (bid.registration_number && bid.registration_number !== "UNSPECIFIED" ? bid.registration_number : "") ||
          parsed?.extractedSignals?.registrationNumbers?.[0] ||
          "";
        if (!extractedReg) {
          missingRegBids.push(bid.id);
        }
      }

      emitRunEvent(state.runId, "node_event", {
        node: "intake_and_ocr",
        status: "completed",
        low_ocr_count: lowOcrBids.length,
        missing_reg_count: missingRegBids.length,
        elapsed_ms: Date.now() - startTime,
      });

      return {
        packets,
        lowOcrBids,
        missingRegBids,
        nodesExecuted: [...(state.nodesExecuted || []), "intake_and_ocr"],
      };
    })

    /* 3. RECOVERY HANDLER (LOW-OCR / DAMAGED SCAN VERIFICATION) */
    .addNode("recovery_handler", async (state) => {
      const sess = activeSessions.get(state.threadId);
      const startTime = sess?.startTime || Date.now();
      const tenderId = state.tender?.id || "tnd_01";
      const tenderNumber = state.tender?.tender_number || "TNT-2026";
      const runSource = state.source || "live_ui";

      emitRunEvent(state.runId, "node_event", {
        node: "recovery_handler",
        status: "recovering",
        label: `Low-OCR confidence detected on ${state.lowOcrBids.length} packet(s) — verifying file checksum & staging fairness gate`,
      });

      const affectedNames = state.bids
        .filter((b) => state.lowOcrBids.includes(b.id))
        .map((b) => b.bidder_name)
        .join(", ");

      const { trace } = await mcpManager.callTool(
        "verify_document_checksum",
        { path: "ocds_register_manifest.json" },
        {
          agent: "recovery_handler",
          agent_label: "OCR Recovery Agent",
          step_order: nextStep(state.threadId),
          bidder_name: affectedNames || "Low-OCR Packet",
          reason: `Verify sandbox manifest integrity after low-OCR detection (<55%) on ${affectedNames || "uploaded scan"}`,
          source: runSource,
          tender_id: tenderId,
          tender_number: tenderNumber,
          low_ocr_bids: state.lowOcrBids,
        },
        state.runId,
      );
      emitRunEvent(state.runId, "mcp_call", trace);

      emitRunEvent(state.runId, "node_event", {
        node: "recovery_handler",
        status: "completed",
        elapsed_ms: Date.now() - startTime,
      });

      return {
        recoveryAttempts: (state.recoveryAttempts || 0) + 1,
        nodesExecuted: [...(state.nodesExecuted || []), "recovery_handler"],
      };
    })

    /* 3b. GATE 1 — INTERACTIVE LOW-OCR / MISSING REGISTRATION CLARIFICATION */
    .addNode("gate_ocr_clarification", async (state) => {
      const targetBidId = state.lowOcrBids[0] || state.missingRegBids[0];
      const targetBid = state.bids.find((b) => b.id === targetBidId) || state.bids[0];
      const packet = state.packets[targetBid?.id];
      const ocrPct = Math.round((packet?.averageOcrConfidence ?? 0.4) * 100);
      const isLowOcr = state.lowOcrBids.includes(targetBid?.id);

      emitRunEvent(state.runId, "node_event", {
        node: "gate_ocr_clarification",
        status: "awaiting_approval",
        label: `Paused at Gate 1: Awaiting officer visual check or Registration No. for ${targetBid?.bidder_name}`,
      });

      const payload: HitlInterruptPayload = {
        interrupt_id: `int_ocr_${Date.now()}`,
        thread_id: state.threadId,
        run_id: state.runId,
        gate_type: "ocr_clarification",
        title_en: isLowOcr
          ? `Low Scan Legibility (${ocrPct}% OCR) — Visual Verification Required`
          : "Missing Company Registration Number — Clarification Required",
        title_sw: isLowOcr
          ? `Ubora Mdogo wa Skani (${ocrPct}% OCR) — Uhakiki wa Afisa Unahitajika`
          : "Nambari ya Usajili Haikupatikana — Maelezo Yanahitajika",
        prompt_en: isLowOcr
          ? `Page 1 of ${targetBid?.bidder_name}'s packet ("${packet?.documentName}") has only ${ocrPct}% extractable text. To protect SMEs from automated false-positives, enter the Registration / KRA TCC number from visual inspection or issue a formal PPADA s.81 clarification notice.`
          : `No Business Registration Service (BRS) number was found in ${targetBid?.bidder_name}'s uploaded packet. Enter the verified Registration Number below or route to formal supplier clarification.`,
        prompt_sw: isLowOcr
          ? `Ukurasa wa 1 wa nyaraka ya ${targetBid?.bidder_name} ("${packet?.documentName}") una kiwango cha ${ocrPct}% tu cha maandishi yanayosomeka. Ingiza nambari ya usajili baada ya kukagua nakala halisi au tuma ombi la ufafanuzi (PPADA s.81).`
          : `Nambari ya usajili wa kampuni (BRS) haikupatikana kwa ${targetBid?.bidder_name}. Ingiza nambari sahihi hapa chini au omba ufafanuzi.`,
        pending_mcp_tool: "verify_statutory_registers",
        proposed_args: {
          bidder_name: targetBid?.bidder_name,
          detected_reg: targetBid?.registration_number || "UNSPECIFIED",
          ocr_confidence: packet?.averageOcrConfidence,
        },
        evidence_citation: {
          document_name: packet?.documentName || "Uploaded Packet",
          page: 1,
          section: "OCR Intake Confidence Gate",
          verbatim_quote: packet?.pages?.[0]?.text?.slice(0, 90) || "Low extractable text density",
        },
        requires_input: {
          field: "registration_number",
          label_en: "Verified BRS Registration No. (Optional override)",
          label_sw: "Nambari ya Usajili ya BRS (Hiari)",
          placeholder: "e.g. PVT-2024-889911 or CPR-2019-441022",
          inputType: "text",
        },
        options: [
          {
            id: "provide_reg",
            action: "provide_reg",
            label_en: "Submit Reg No. & Continue Audit",
            label_sw: "Wasilisha Nambari & Endelea",
            tone: "primary",
          },
          {
            id: "clarify",
            action: "clarify",
            label_en: "Issue Clarification & Hold Auto-Flag",
            label_sw: "Omba Ufafanuzi & Zuia Kufuta",
            tone: "caution",
          },
        ],
      };

      // Native LangGraph pause — waits for Command({ resume })
      const decision: any = interrupt(payload);

      const manualRegOverrides = { ...(state.manualRegOverrides || {}) };
      const clarificationIssuedBids = [...(state.clarificationIssuedBids || [])];

      if (decision?.registration_number && String(decision.registration_number).trim()) {
        manualRegOverrides[targetBid.id] = String(decision.registration_number).trim();
      } else {
        clarificationIssuedBids.push(targetBid.id);
      }

      emitRunEvent(state.runId, "node_event", {
        node: "gate_ocr_clarification",
        status: "completed",
        decision: decision?.action || "clarify",
      });

      return {
        manualRegOverrides,
        clarificationIssuedBids,
        nodesExecuted: [...(state.nodesExecuted || []), "gate_ocr_clarification"],
      };
    })

    /* 4. SPECIALIST AUDIT AGENTS (STATUTORY LOOKUPS, PRICING, COLLUSION — STAGES DISQUALIFICATIONS) */
    .addNode("specialist_audit", async (state) => {
      const sess = activeSessions.get(state.threadId);
      const startTime = sess?.startTime || Date.now();
      emitRunEvent(state.runId, "node_event", {
        node: "specialist_audit",
        status: "running",
        label: "Running Statutory/KYB, PPRA Market Benchmarking & Collusion Graph via MCP",
      });

      const statutoryVerdicts: Record<string, any> = {};
      const pricingVerdicts: Record<string, any> = {};
      const collusionSignals: any[] = [];
      const rawFindingsByBid: Record<string, GroundedFinding[]> = {};
      const stagedDisqualifications: StagedDisqualification[] = [];
      const unbenchmarkedItems: Array<{
        bidId: string;
        bidderName: string;
        description: string;
        unitPrice: number;
        documentName: string;
        page: number;
      }> = [];

      for (const bid of state.bids) {
        const packet = state.packets[bid.id];
        const isLowOcr = state.lowOcrBids.includes(bid.id);
        const clarificationHeld = (state.clarificationIssuedBids || []).includes(bid.id);
        const findings: GroundedFinding[] = [];

        if (packet?.injectionAudit?.injectionDetected) {
          const quote = "[REDACTED_PROMPT_INJECTION_ATTEMPT]";
          findings.push({
            key: `security_prompt_injection_${bid.id}`,
            severity: "warning",
            category: "security",
            title: "Prompt-injection instruction stripped from uploaded bid text",
            detail: `Detected and neutralized ${packet.injectionAudit.patternsMatched.length} embedded override directive(s) inside document text before model analysis.`,
            title_sw: "Maelekezo hatari ya kubadilisha mfumo yamezuiliwa kwenye nyaraka",
            detail_sw: `Mfumo umegundua na kuzuia maelekezo ${packet.injectionAudit.patternsMatched.length} yaliyojaribu kushawishi tathmini ya zabuni.`,
            citation: {
              document_name: packet.documentName,
              page: 1,
              section: "Untrusted PDF Text Sanitizer",
              verbatim_quote: quote,
              confidence: 1,
            },
            grounded: true,
          });
        }

        if (isLowOcr) {
          const firstSnippet = packet.pages[0]?.text?.slice(0, 60) || "Low extractable text density";
          findings.push({
            key: `ocr_manual_review_${bid.id}`,
            severity: "warning",
            category: "ocr_review",
            title: "Low scan legibility — routed to human visual verification (No auto-disqualification)",
            detail: `Document "${packet.documentName}" averaged ${(packet.averageOcrConfidence * 100).toFixed(0)}% OCR extractable character confidence.${clarificationHeld ? " Officer issued PPADA s.81 visual clarification hold." : ""} Automated disqualification is blocked pending visual inspection.`,
            title_sw: "Ubora mdogo wa skani — imepelekwa kwa ukaguzi wa kamati (Hakuna kufutwa kiotomatiki)",
            detail_sw: `Nyaraka "${packet.documentName}" ina kiwango cha chini cha maandishi yanayosomeka (${(packet.averageOcrConfidence * 100).toFixed(0)}%). Afisa wa kamati atakagua nakala halisi.`,
            citation: {
              document_name: packet.documentName,
              page: 1,
              section: "OCR Intake Confidence Gate",
              verbatim_quote: firstSnippet,
              confidence: packet.averageOcrConfidence,
            },
            grounded: true,
          });
        }

        const tenderId = state.tender?.id || "tnd_01";
        const tenderNumber = state.tender?.tender_number || "TNT-2026";
        const runSource = state.source || "live_ui";

        const regNumber =
          state.manualRegOverrides?.[bid.id] ||
          bid.registration_number ||
          packet?.extractedSignals?.registrationNumbers?.[0] ||
          "UNSPECIFIED";

        const { result: statRes, trace: statTrace } = await mcpManager.callTool(
          "verify_statutory_registers",
          {
            company_registration_no: regNumber,
            company_name: bid.bidder_name,
            tender_number: tenderNumber,
            sector_mode: state.sectorMode,
          },
          {
            agent: "statutory_auditor",
            agent_label: "Statutory Auditor",
            step_order: nextStep(state.threadId),
            bid_id: bid.id,
            bidder_name: bid.bidder_name,
            reason: `Verify KRA TCC, BRS status, NSSF, SHA/SHIF & PPRA debarment for ${bid.bidder_name} (${regNumber})`,
            source: runSource,
            tender_id: tenderId,
            tender_number: tenderNumber,
          },
          state.runId,
        );
        emitRunEvent(state.runId, "mcp_call", statTrace);
        statutoryVerdicts[bid.id] = statRes;

        if (!isLowOcr) {
          if (statRes?.requires_manual_verification) {
            findings.push({
              key: `manual_reg_check_${bid.id}`,
              severity: "warning",
              category: "statutory",
              title: "Registration not present in sandboxed snapshot — manual e-Citizen verification required",
              detail: `Entity "${bid.bidder_name}" (${regNumber}) is not indexed in the test register snapshot. Escalated for live officer check on e-Citizen / KRA iTax.`,
              title_sw: "Usajili haupatikani kwenye hifadhi ya majaribio — ukaguzi wa moja kwa moja unahitajika",
              detail_sw: `Kampuni "${bid.bidder_name}" (${regNumber}) haijathibitishwa kiotomatiki. Afisa wa tathmini ahakiki kupitia e-Citizen / iTax.`,
              citation: {
                document_name: "Statutory Register Adapter",
                page: 1,
                section: "BRS / iTax Lookup",
                verbatim_quote: statRes.recommendation || "Not found in sandboxed register snapshot",
                confidence: 0.9,
              },
              grounded: true,
            });
          } else {
            for (const v of statRes?.verdicts || []) {
              if (v.valid === false) {
                const stagedTraceId = `mcp_staged_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                const stagedStepOrder = nextStep(state.threadId);
                const mcpArgs = {
                  tender_number: tenderNumber,
                  bidder_name: bid.bidder_name,
                  bid_id: bid.id,
                  statutory_ground: v.status,
                  legal_citation: v.legal_basis || "PPADA 2015 s.79(1)",
                  evidence_summary: `${v.portal} check returned ${v.status} (${v.certificate_no}).`,
                  document_name: "Statutory Register Snapshot",
                  source_page: 1,
                  evidence_quote: v.citation_ref,
                  sector_mode: state.sectorMode,
                };

                const pausedTrace: McpTraceRecord = {
                  id: stagedTraceId,
                  run_id: state.runId,
                  source: runSource,
                  tender_id: tenderId,
                  tender_number: tenderNumber,
                  timestamp: new Date().toISOString(),
                  tool: "flag_procurement_disqualification",
                  server_id: "pulao-procurement-mcp",
                  server_type: "custom",
                  inputs: mcpArgs,
                  outputs: {
                    status: "PAUSED_AT_HUMAN_APPROVAL_GATE",
                    message: `Staged for ${bid.bidder_name} (${v.portal}: ${v.status}). Waiting for Procurement Officer to tap Approve.`,
                  },
                  status: "awaiting_approval",
                  duration_ms: 0,
                  sha256: crypto.createHash("sha256").update(JSON.stringify(mcpArgs)).digest("hex"),
                  context: {
                    agent: "approval_gate",
                    agent_label: "Human Approval Gate",
                    step_order: stagedStepOrder,
                    bid_id: bid.id,
                    bidder_name: bid.bidder_name,
                    reason: `Stage statutory disqualification flag for ${bid.bidder_name} (${v.portal}: ${v.status}) — awaiting officer approval`,
                    source: runSource,
                    tender_id: tenderId,
                    tender_number: tenderNumber,
                    human_gate_required: true,
                  },
                };
                await appendMcpTrace(pausedTrace);
                emitRunEvent(state.runId, "mcp_call", pausedTrace);

                stagedDisqualifications.push({
                  traceId: stagedTraceId,
                  stepOrder: stagedStepOrder,
                  bidId: bid.id,
                  bidderName: bid.bidder_name,
                  category: "statutory",
                  key: `${v.key}_${bid.id}`,
                  title: `${v.portal}: ${v.status.replace(/_/g, " ")}`,
                  detail: `${v.citation_ref}. Legal basis: ${v.legal_basis}.`,
                  title_sw: `${v.portal}: Tatizo la kisheria (${v.status.replace(/_/g, " ")})`,
                  detail_sw: `Ushahidi: ${v.citation_ref}. Msingi wa sheria: ${v.legal_basis}.`,
                  citation: {
                    document_name: "Statutory Register Snapshot",
                    page: 1,
                    section: v.portal,
                    verbatim_quote: v.citation_ref,
                    confidence: 0.99,
                  },
                  mcpArgs,
                });
              }
            }
          }
        }

        const lineItems =
          Array.isArray(bid.line_items) && bid.line_items.length > 0
            ? bid.line_items
            : packet?.extractedSignals?.lineItems || [];

        const { result: priceRes, trace: priceTrace } = await mcpManager.callTool(
          "benchmark_market_pricing",
          {
            line_items: lineItems,
            price_index: state.priceIndex,
            tender_budget: state.tender?.budget_allocation,
            allowed_variance_pct: state.allowedVariancePct,
          },
          {
            agent: "pricing_analyst",
            agent_label: "Pricing Analyst",
            step_order: nextStep(state.threadId),
            bid_id: bid.id,
            bidder_name: bid.bidder_name,
            reason: `Benchmark ${lineItems.length} line item(s) for ${bid.bidder_name} against PPRA Q2 2026 index (+${state.allowedVariancePct}% ceiling)`,
            source: runSource,
            tender_id: tenderId,
            tender_number: tenderNumber,
          },
          state.runId,
        );
        emitRunEvent(state.runId, "mcp_call", priceTrace);
        pricingVerdicts[bid.id] = priceRes;

        const schedulePage = packet.totalPages >= 2 ? 2 : 1;
        for (const item of priceRes?.items || []) {
          if (item.risk_flag === "PRICE_GOUGING") {
            const sev = item.variance_percentage > 25 ? "critical" : "warning";
            if (sev === "critical") {
              const stagedTraceId = `mcp_staged_price_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              const stagedStepOrder = nextStep(state.threadId);
              const mcpArgs = {
                tender_number: tenderNumber,
                bidder_name: bid.bidder_name,
                bid_id: bid.id,
                statutory_ground: `EXCESSIVE_PRICE_VARIANCE_+${item.variance_percentage}%`,
                legal_citation: state.sectorMode === "corporate_rfp" ? "Corporate RFP Cost Policy s.4" : "PPADA 2015 s.131 / s.79",
                evidence_summary: `Quoted KES ${Number(item.declared_unit_price).toLocaleString()} vs PPRA median KES ${Number(item.ppra_market_median).toLocaleString()}.`,
                document_name: packet.documentName,
                source_page: schedulePage,
                evidence_quote: item.description.slice(0, 65),
                sector_mode: state.sectorMode,
              };
              const pausedTrace: McpTraceRecord = {
                id: stagedTraceId,
                run_id: state.runId,
                source: runSource,
                tender_id: tenderId,
                tender_number: tenderNumber,
                timestamp: new Date().toISOString(),
                tool: "flag_procurement_disqualification",
                server_id: "pulao-procurement-mcp",
                server_type: "custom",
                inputs: mcpArgs,
                outputs: {
                  status: "PAUSED_AT_HUMAN_APPROVAL_GATE",
                  message: `Excessive price variance (+${item.variance_percentage}%) staged for human approval before flagging.`,
                },
                status: "awaiting_approval",
                duration_ms: 0,
                sha256: crypto.createHash("sha256").update(JSON.stringify(mcpArgs)).digest("hex"),
                context: {
                  agent: "approval_gate",
                  agent_label: "Human Approval Gate",
                  step_order: stagedStepOrder,
                  bid_id: bid.id,
                  bidder_name: bid.bidder_name,
                  reason: `Stage excessive price gouging flag (+${item.variance_percentage}% on ${item.description.slice(0, 36)}) for ${bid.bidder_name}`,
                  source: runSource,
                  tender_id: tenderId,
                  tender_number: tenderNumber,
                  human_gate_required: true,
                },
              };
              await appendMcpTrace(pausedTrace);
              emitRunEvent(state.runId, "mcp_call", pausedTrace);

              stagedDisqualifications.push({
                traceId: stagedTraceId,
                stepOrder: stagedStepOrder,
                bidId: bid.id,
                bidderName: bid.bidder_name,
                category: "pricing",
                key: `price_gouging_${bid.id}_${item.item_index}`,
                title: `Above-ceiling pricing (+${item.variance_percentage}%): ${item.description}`,
                detail: `Quoted KES ${Number(item.declared_unit_price).toLocaleString()} vs PPRA median KES ${Number(item.ppra_market_median).toLocaleString()} (allowed ceiling KES ${Number(item.ppra_ceiling_allowed).toLocaleString()}).`,
                title_sw: `Bei imezidi kiwango cha soko (+${item.variance_percentage}%): ${item.description}`,
                detail_sw: `Bei iliyowasilishwa ni KES ${Number(item.declared_unit_price).toLocaleString()} dhidi ya bei elekezi ya PPRA KES ${Number(item.ppra_market_median).toLocaleString()}.`,
                citation: {
                  document_name: packet.documentName,
                  page: schedulePage,
                  section: `Pricing Schedule Item #${item.item_index}`,
                  verbatim_quote: item.description.slice(0, 65),
                  confidence: 0.95,
                },
                mcpArgs,
              });
            } else {
              findings.push({
                key: `price_gouging_${bid.id}_${item.item_index}`,
                severity: "warning",
                category: "pricing",
                title: `Above-ceiling pricing (+${item.variance_percentage}%): ${item.description}`,
                detail: `Quoted KES ${Number(item.declared_unit_price).toLocaleString()} vs PPRA median KES ${Number(item.ppra_market_median).toLocaleString()} (allowed ceiling KES ${Number(item.ppra_ceiling_allowed).toLocaleString()}).`,
                title_sw: `Bei imezidi kiwango cha soko (+${item.variance_percentage}%): ${item.description}`,
                detail_sw: `Bei iliyowasilishwa ni KES ${Number(item.declared_unit_price).toLocaleString()} dhidi ya bei elekezi ya PPRA KES ${Number(item.ppra_market_median).toLocaleString()}.`,
                citation: {
                  document_name: packet.documentName,
                  page: schedulePage,
                  section: `Pricing Schedule Item #${item.item_index}`,
                  verbatim_quote: item.description.slice(0, 65),
                  confidence: 0.95,
                },
                grounded: true,
              });
            }
          } else if (item.risk_flag === "PREDATORY_UNDERCUTTING") {
            findings.push({
              key: `price_undercut_${bid.id}_${item.item_index}`,
              severity: "warning",
              category: "pricing",
              title: `Abnormally low bid (${item.variance_percentage}%): ${item.description}`,
              detail: `Quoted KES ${Number(item.declared_unit_price).toLocaleString()} sits below 70% PPRA floor (KES ${Number(item.ppra_floor_safe).toLocaleString()}), risking delivery failure or post-award variations.`,
              title_sw: `Bei ya chini kupita kiasi (${item.variance_percentage}%): ${item.description}`,
              detail_sw: `Bei KES ${Number(item.declared_unit_price).toLocaleString()} iko chini ya asilimia 70 ya bei ya PPRA (KES ${Number(item.ppra_floor_safe).toLocaleString()}).`,
              citation: {
                document_name: packet.documentName,
                page: schedulePage,
                section: `Pricing Schedule Item #${item.item_index}`,
                verbatim_quote: item.description.slice(0, 65),
                confidence: 0.94,
              },
              grounded: true,
            });
          } else if (item.risk_flag === "UNBENCHMARKED_MANUAL_REVIEW") {
            unbenchmarkedItems.push({
              bidId: bid.id,
              bidderName: bid.bidder_name,
              description: item.description,
              unitPrice: Number(item.declared_unit_price || 0),
              documentName: packet.documentName,
              page: schedulePage,
            });
            findings.push({
              key: `price_unbenchmarked_${bid.id}_${item.item_index}`,
              severity: "info",
              category: "pricing",
              title: `Unbenchmarked specialized item requires market quote check: ${item.description}`,
              detail: `No matching baseline item in PPRA Q2 2026 index. Committee must verify against independent market quotes.`,
              title_sw: `Kipengee hakina bei elekezi kwenye orodha ya PPRA: ${item.description}`,
              detail_sw: `Hakuna bei ya kulinganisha kwenye faharasa ya PPRA Q2 2026. Kamati ifanye uhakiki wa soko.`,
              citation: {
                document_name: packet.documentName,
                page: schedulePage,
                section: `Pricing Schedule Item #${item.item_index}`,
                verbatim_quote: item.description.slice(0, 65),
                confidence: 0.88,
              },
              grounded: true,
            });
          }
        }

        if (priceRes?.over_allocated_budget) {
          findings.push({
            key: `over_budget_${bid.id}`,
            severity: "critical",
            category: "pricing",
            title: "Total tender quotation exceeds approved budget ceiling",
            detail: `Quoted KES ${Number(priceRes.total_quoted_kes).toLocaleString()} vs approved budget KES ${Number(state.tender?.budget_allocation).toLocaleString()}.`,
            title_sw: "Jumla ya bei ya zabuni imezidi bajeti iliyoidhinishwa",
            detail_sw: `Jumla KES ${Number(priceRes.total_quoted_kes).toLocaleString()} inazidi bajeti ya KES ${Number(state.tender?.budget_allocation).toLocaleString()}.`,
            citation: {
              document_name: packet.documentName,
              page: 1,
              section: "Form of Tender Summary",
              verbatim_quote: `KES ${Number(bid.quoted_amount || priceRes.total_quoted_kes).toLocaleString()}`,
              confidence: 0.96,
            },
            grounded: true,
          });
        }

        rawFindingsByBid[bid.id] = findings;
      }

      // Cross-Bidder Collusion Check
      for (let i = 0; i < state.bids.length; i += 1) {
        for (let j = i + 1; j < state.bids.length; j += 1) {
          const bA = state.bids[i];
          const bB = state.bids[j];
          const pA = state.packets[bA.id];
          const pB = state.packets[bB.id];
          const ownersA: string[] = statutoryVerdicts[bA.id]?.beneficial_owners || [];
          const ownersB: string[] = statutoryVerdicts[bB.id]?.beneficial_owners || [];

          const sharedOwners = ownersA.filter((o) => ownersB.includes(o));
          const sameAuthor =
            pA?.metadata?.author &&
            pB?.metadata?.author &&
            pA.metadata.author !== "Unspecified Author" &&
            pA.metadata.author === pB.metadata.author;
          const sameFingerprint = pA?.metadata?.fingerprint && pA.metadata.fingerprint === pB?.metadata?.fingerprint;

          if (sharedOwners.length > 0 || sameAuthor || sameFingerprint) {
            const reasons: string[] = [];
            if (sharedOwners.length > 0) reasons.push(`Shared beneficial owner(s): ${sharedOwners.join(", ")}`);
            if (sameAuthor) reasons.push(`Identical PDF author metadata: ${pA.metadata.author}`);
            if (sameFingerprint) reasons.push(`Identical SHA-256 packet digest`);

            collusionSignals.push({
              bid_a: bA.id,
              bid_b: bB.id,
              bidder_a: bA.bidder_name,
              bidder_b: bB.bidder_name,
              score: sameFingerprint || sharedOwners.length > 0 ? 0.92 : 0.78,
              reasons,
            });

            for (const targetBid of [bA, bB]) {
              const otherName = targetBid.id === bA.id ? bB.bidder_name : bA.bidder_name;
              const targetPacket = state.packets[targetBid.id];
              const evidenceQuote = sharedOwners[0] || pA?.metadata?.author || "Matched packet signature";
              rawFindingsByBid[targetBid.id].push({
                key: `collusion_${targetBid.id}_${otherName.replace(/\W+/g, "_")}`,
                severity: "critical",
                category: "collusion",
                title: `Cross-bid coordination risk with ${otherName}`,
                detail: `${reasons.join("; ")}. Requires committee investigation under PPADA 2015 s.42 / Competition Act s.21.`,
                title_sw: `Hatari ya ushirikiano haramu wa zabuni na ${otherName}`,
                detail_sw: `Sababu: ${reasons.join("; ")}. Inahitaji uchunguzi wa kamati chini ya PPADA s.42.`,
                citation: {
                  document_name: targetPacket.documentName,
                  page: 1,
                  section: "Beneficial Ownership & Packet Metadata",
                  verbatim_quote: evidenceQuote,
                  confidence: 0.95,
                },
                grounded: true,
              });
            }
          }
        }
      }

      emitRunEvent(state.runId, "node_event", {
        node: "specialist_audit",
        status: "completed",
        collusion_count: collusionSignals.length,
        staged_disqualifications: stagedDisqualifications.length,
        unbenchmarked_items: unbenchmarkedItems.length,
        elapsed_ms: Date.now() - startTime,
      });

      return {
        statutoryVerdicts,
        pricingVerdicts,
        collusionSignals,
        unbenchmarkedItems,
        stagedDisqualifications,
        rawFindingsByBid,
        nodesExecuted: [...(state.nodesExecuted || []), "specialist_audit"],
      };
    })

    /* 4b. GATE 2 — UNBENCHMARKED ITEM / CUSTOM BENCHMARK INPUT */
    .addNode("gate_pricing_benchmark", async (state) => {
      const firstItem = state.unbenchmarkedItems[0];
      emitRunEvent(state.runId, "node_event", {
        node: "gate_pricing_benchmark",
        status: "awaiting_approval",
        label: `Paused at Gate 2: No PPRA baseline for "${firstItem?.description}"`,
      });

      const payload: HitlInterruptPayload = {
        interrupt_id: `int_price_${Date.now()}`,
        thread_id: state.threadId,
        run_id: state.runId,
        gate_type: "pricing_benchmark",
        title_en: `Unbenchmarked Item — Market Quote Needed (${firstItem?.bidderName})`,
        title_sw: `Kipengee Hakina Bei Elekezi ya PPRA (${firstItem?.bidderName})`,
        prompt_en: `No PPRA Q2 2026 baseline exists for "${firstItem?.description}" (quoted KES ${Number(firstItem?.unitPrice || 0).toLocaleString()}). Enter a verified reference market quote / ERP PO benchmark (KES), or tap 'Approve Manual Market Survey' to continue.`,
        prompt_sw: `Hakuna bei ya msingi ya PPRA Q2 2026 kwa "${firstItem?.description}" (KES ${Number(firstItem?.unitPrice || 0).toLocaleString()}). Ingiza bei ya marejeleo ya soko (KES) au chagua Uhakiki wa Soko la Kamati.`,
        pending_mcp_tool: "benchmark_market_pricing",
        proposed_args: {
          item_description: firstItem?.description,
          quoted_unit_price_kes: firstItem?.unitPrice,
          allowed_variance_pct: state.allowedVariancePct,
        },
        evidence_citation: {
          document_name: firstItem?.documentName || "Pricing Schedule",
          page: firstItem?.page || 1,
          section: "Pricing Schedule",
          verbatim_quote: firstItem?.description?.slice(0, 75) || "Specialized Item",
        },
        requires_input: {
          field: "custom_benchmark_kes",
          label_en: "Verified Market / ERP Reference Price (KES, Optional)",
          label_sw: "Bei Elekezi ya Marejeleo (KES, Hiari)",
          placeholder: `e.g. ${Math.round((firstItem?.unitPrice || 100000) * 0.95)}`,
          inputType: "number",
        },
        options: [
          {
            id: "provide_benchmark",
            action: "provide_benchmark",
            label_en: "Apply Custom Benchmark & Re-Run MCP",
            label_sw: "Tumia Bei Hii & Kagua Tena",
            tone: "primary",
          },
          {
            id: "manual_survey",
            action: "manual_survey",
            label_en: "Approve Manual Market Survey",
            label_sw: "Idhinisha Uhakiki wa Soko",
            tone: "caution",
          },
        ],
      };

      const decision: any = interrupt(payload);
      const customPrice = Number(decision?.custom_benchmark_kes || 0);
      const updatedFindings = { ...(state.rawFindingsByBid || {}) };
      const updatedPricing = { ...(state.pricingVerdicts || {}) };

      if (decision?.action === "provide_benchmark" && customPrice > 0 && firstItem) {
        const adHocCatalog = [
          ...(state.priceIndex || []),
          {
            id: `officer_quote_${Date.now()}`,
            item_category: "Officer Reference Benchmark",
            item_description: firstItem.description,
            benchmark_price: customPrice,
            allowed_deviation_margin: state.allowedVariancePct / 100,
          },
        ];
        const bidObj = state.bids.find((b) => b.id === firstItem.bidId);
        const tenderId = state.tender?.id || "tnd_01";
        const tenderNumber = state.tender?.tender_number || "TNT-2026";
        const runSource = state.source || "live_ui";
        const { result: rePrice, trace: reTrace } = await mcpManager.callTool(
          "benchmark_market_pricing",
          {
            line_items: bidObj?.line_items || [{ description: firstItem.description, quantity: 1, unit_price: firstItem.unitPrice }],
            price_index: adHocCatalog,
            tender_budget: state.tender?.budget_allocation,
            allowed_variance_pct: state.allowedVariancePct,
          },
          {
            agent: "pricing_analyst",
            agent_label: "Pricing Analyst",
            step_order: nextStep(state.threadId),
            bid_id: firstItem.bidId,
            bidder_name: firstItem.bidderName,
            reason: `Re-benchmark "${firstItem.description}" for ${firstItem.bidderName} using officer reference KES ${customPrice.toLocaleString()}`,
            source: runSource,
            tender_id: tenderId,
            tender_number: tenderNumber,
            human_benchmark_kes: customPrice,
          },
          state.runId,
        );
        emitRunEvent(state.runId, "mcp_call", reTrace);
        updatedPricing[firstItem.bidId] = rePrice;

        const existingList = (updatedFindings[firstItem.bidId] || []).filter(
          (f) => !f.key.startsWith(`price_unbenchmarked_${firstItem.bidId}`),
        );
        for (const it of rePrice?.items || []) {
          existingList.push({
            key: `officer_benchmarked_${firstItem.bidId}_${it.item_index}`,
            severity: it.risk_flag === "PRICE_GOUGING" ? "warning" : "info",
            category: "pricing",
            title: `Officer benchmark applied (${it.variance_percentage >= 0 ? "+" : ""}${it.variance_percentage}%): ${it.description}`,
            detail: `Benchmarked against officer-supplied reference KES ${customPrice.toLocaleString()} (quoted KES ${Number(it.declared_unit_price).toLocaleString()}).`,
            title_sw: `Bei ya marejeleo ya afisa imetumika (${it.variance_percentage}%): ${it.description}`,
            detail_sw: `Imelinganishwa na bei ya marejeleo KES ${customPrice.toLocaleString()}.`,
            citation: {
              document_name: firstItem.documentName,
              page: firstItem.page,
              section: "Officer-Supplied Market Benchmark",
              verbatim_quote: firstItem.description.slice(0, 65),
              confidence: 0.95,
            },
            grounded: true,
          });
        }
        updatedFindings[firstItem.bidId] = existingList;
      }

      emitRunEvent(state.runId, "node_event", {
        node: "gate_pricing_benchmark",
        status: "completed",
        decision: decision?.action || "manual_survey",
      });

      return {
        rawFindingsByBid: updatedFindings,
        pricingVerdicts: updatedPricing,
        nodesExecuted: [...(state.nodesExecuted || []), "gate_pricing_benchmark"],
      };
    })

    /* 4c. GATE 3 — PRE-EXECUTION APPROVAL GATE FOR flag_procurement_disqualification */
    .addNode("gate_approval_disqualification", async (state) => {
      const firstStaged = state.stagedDisqualifications[0];
      emitRunEvent(state.runId, "node_event", {
        node: "gate_approval_disqualification",
        status: "awaiting_approval",
        label: `Paused at Gate 3: Awaiting approval before calling flag_procurement_disqualification (${state.stagedDisqualifications.length} item(s))`,
      });

      const payload: HitlInterruptPayload = {
        interrupt_id: `int_disq_${Date.now()}`,
        thread_id: state.threadId,
        run_id: state.runId,
        gate_type: "pre_execution_approval",
        title_en: `Approve MCP Disqualification Flag (${state.stagedDisqualifications.length} staged)`,
        title_sw: `Idhinisha Zana ya MCP ya Kuweka Dosari (${state.stagedDisqualifications.length})`,
        prompt_en: `MCP tool \`flag_procurement_disqualification\` is staged for ${firstStaged.bidderName} under ${firstStaged.mcpArgs.legal_citation} based on Page ${firstStaged.citation.page} evidence: "${firstStaged.citation.verbatim_quote}". Tap 'Approve Flag Execution' to execute the MCP tool, 'Downgrade to Clarification', or 'Dismiss with Reason'.`,
        prompt_sw: `Zana ya MCP \`flag_procurement_disqualification\` iko tayari kwa ${firstStaged.bidderName} chini ya ${firstStaged.mcpArgs.legal_citation} kwa ushahidi wa Ukurasa ${firstStaged.citation.page}: "${firstStaged.citation.verbatim_quote}". Bofya 'Idhinisha' kutekeleza zana ya MCP, 'Shusha hadi Ufafanuzi', au 'Kataa kwa Sababu'.`,
        pending_mcp_tool: "flag_procurement_disqualification",
        proposed_args: firstStaged.mcpArgs,
        evidence_citation: {
          document_name: firstStaged.citation.document_name,
          page: firstStaged.citation.page,
          section: firstStaged.citation.section,
          verbatim_quote: firstStaged.citation.verbatim_quote,
        },
        requires_input: {
          field: "reason",
          label_en: "Officer Note / Override Reason (Optional for Approve, helpful for Dismiss)",
          label_sw: "Maelezo ya Afisa / Sababu (Hiari)",
          placeholder: "e.g. Verified KRA expiry on physical annexure / Hold pending clarification",
          inputType: "text",
        },
        options: [
          {
            id: "approve",
            action: "approve",
            label_en: "Approve Flag Execution",
            label_sw: "Idhinisha Zana ya MCP",
            tone: "critical",
          },
          {
            id: "downgrade",
            action: "downgrade",
            label_en: "Downgrade to Clarification",
            label_sw: "Shusha hadi Ufafanuzi",
            tone: "caution",
          },
          {
            id: "reject",
            action: "reject",
            label_en: "Reject / Block Flag",
            label_sw: "Kataa / Zuia Bendera",
            tone: "outline",
          },
        ],
      };

      const interruptStart = Date.now();
      const decision: any = interrupt(payload);
      const action = decision?.action || "approve";
      const reason = String(decision?.reason || "").trim();
      const sess = activeSessions.get(state.threadId);
      const approvalDuration = sess?.interruptedAt ? Date.now() - sess.interruptedAt : Date.now() - interruptStart;

      const updatedRaw: Record<string, GroundedFinding[]> = {};
      for (const [k, v] of Object.entries(state.rawFindingsByBid || {})) {
        updatedRaw[k] = [...v];
      }

      const tenderId = state.tender?.id || "tnd_01";
      const tenderNumber = state.tender?.tender_number || "TNT-2026";
      const runSource = state.source || "live_ui";

      if (action === "approve") {
        if (sess) sess.approvedActions += state.stagedDisqualifications.length;
        for (const item of state.stagedDisqualifications) {
          const { result: disqRes, trace: disqTrace } = await mcpManager.callTool(
            "flag_procurement_disqualification",
            item.mcpArgs,
            {
              agent: "approval_gate",
              agent_label: "Human Approval Gate",
              step_order: item.stepOrder,
              bid_id: item.bidId,
              bidder_name: item.bidderName,
              reason: `Execute officer-approved disqualification flag (${item.title}) for ${item.bidderName}`,
              source: runSource,
              tender_id: tenderId,
              tender_number: tenderNumber,
              human_approved: true,
              human_gate_required: true,
            },
            state.runId,
          );
          const mergedTrace: McpTraceRecord = {
            ...disqTrace,
            id: item.traceId,
            source: runSource,
            tender_id: tenderId,
            tender_number: tenderNumber,
            human_approval_ms: approvalDuration,
            context: {
              ...(disqTrace.context || {}),
              step_order: item.stepOrder,
              human_approved: true,
              human_gate_required: true,
            },
          };
          await appendMcpTrace(mergedTrace);
          emitRunEvent(state.runId, "mcp_call", mergedTrace);

          if (!updatedRaw[item.bidId]) updatedRaw[item.bidId] = [];
          updatedRaw[item.bidId].push({
            key: item.key,
            severity: "critical",
            category: item.category,
            title: item.title,
            detail: `${item.detail} Flag status: ${disqRes?.gate_status || "LOCKED_UNTIL_COMMITTEE_SIGNOFF"}. Approved by officer for committee dossier.`,
            title_sw: item.title_sw,
            detail_sw: `${item.detail_sw} Imeidhinishwa na afisa kuwasilishwa kwa kamati.`,
            citation: item.citation,
            grounded: true,
          });
        }
      } else if (action === "downgrade") {
        if (sess) sess.rejectedActions += state.stagedDisqualifications.length;
        for (const item of state.stagedDisqualifications) {
          const rejectedTrace: McpTraceRecord = {
            id: item.traceId,
            run_id: state.runId,
            source: runSource,
            tender_id: tenderId,
            tender_number: tenderNumber,
            timestamp: new Date().toISOString(),
            tool: "flag_procurement_disqualification",
            server_id: "pulao-procurement-mcp",
            server_type: "custom",
            inputs: item.mcpArgs,
            outputs: {
              blocked_by_human: true,
              action: "downgraded_to_clarification",
              officer_note: reason || "Downgraded to supplier clarification request",
            },
            status: "rejected_by_human",
            duration_ms: 0,
            human_approval_ms: approvalDuration,
            sha256: crypto.createHash("sha256").update(`downgraded:${item.traceId}`).digest("hex"),
            context: {
              agent: "approval_gate",
              agent_label: "Human Approval Gate",
              step_order: item.stepOrder,
              bid_id: item.bidId,
              bidder_name: item.bidderName,
              reason: `Officer downgraded disqualification flag for ${item.bidderName} to clarification`,
              source: runSource,
              tender_id: tenderId,
              tender_number: tenderNumber,
              human_gate_required: true,
            },
          };
          await appendMcpTrace(rejectedTrace);
          emitRunEvent(state.runId, "mcp_call", rejectedTrace);

          if (!updatedRaw[item.bidId]) updatedRaw[item.bidId] = [];
          updatedRaw[item.bidId].push({
            key: `${item.key}_clarification`,
            severity: "warning",
            category: item.category,
            title: `Clarification requested (Officer downgraded): ${item.title}`,
            detail: `${item.detail} Officer note: ${reason || "Downgraded from disqualification to supplier clarification."}`,
            title_sw: `Ufafanuzi umeombwa (Imeshushwa na afisa): ${item.title_sw}`,
            detail_sw: `${item.detail_sw} Maelezo ya afisa: ${reason || "Imeombwa ufafanuzi badala ya kufuta."}`,
            citation: item.citation,
            grounded: true,
          });
        }
      } else {
        // Reject / Block Flag
        if (sess) sess.rejectedActions += state.stagedDisqualifications.length;
        for (const item of state.stagedDisqualifications) {
          const rejectedTrace: McpTraceRecord = {
            id: item.traceId,
            run_id: state.runId,
            source: runSource,
            tender_id: tenderId,
            tender_number: tenderNumber,
            timestamp: new Date().toISOString(),
            tool: "flag_procurement_disqualification",
            server_id: "pulao-procurement-mcp",
            server_type: "custom",
            inputs: item.mcpArgs,
            outputs: {
              blocked_by_human: true,
              action: "rejected_by_human",
              officer_note: reason || "Disqualification tool execution blocked by supervising officer",
            },
            status: "rejected_by_human",
            duration_ms: 0,
            human_approval_ms: approvalDuration,
            sha256: crypto.createHash("sha256").update(`rejected:${item.traceId}`).digest("hex"),
            context: {
              agent: "approval_gate",
              agent_label: "Human Approval Gate",
              step_order: item.stepOrder,
              bid_id: item.bidId,
              bidder_name: item.bidderName,
              reason: `Officer blocked disqualification tool execution for ${item.bidderName}`,
              source: runSource,
              tender_id: tenderId,
              tender_number: tenderNumber,
              human_gate_required: true,
            },
          };
          await appendMcpTrace(rejectedTrace);
          emitRunEvent(state.runId, "mcp_call", rejectedTrace);

          if (!updatedRaw[item.bidId]) updatedRaw[item.bidId] = [];
          updatedRaw[item.bidId].push({
            key: `${item.key}_human_blocked`,
            severity: "info",
            category: item.category,
            title: `Disqualification flag blocked by human officer: ${item.title}`,
            detail: `Supervising officer blocked MCP tool flag_procurement_disqualification. Rationale: ${reason || "Held pending live documentary verification."}`,
            title_sw: `Bendera ya kufuta imezuiwa na afisa: ${item.title_sw}`,
            detail_sw: `Afisa msimamizi amezuia zana ya MCP. Sababu: ${reason || "Inasubiri uhakiki wa ziada."}`,
            citation: item.citation,
            grounded: true,
          });
        }
      }

      emitRunEvent(state.runId, "node_event", {
        node: "gate_approval_disqualification",
        status: "completed",
        decision: action,
      });

      return {
        rawFindingsByBid: updatedRaw,
        nodesExecuted: [...(state.nodesExecuted || []), "gate_approval_disqualification"],
      };
    })

    /* 5. ZERO-UNSOURCED-FLAG CITATION GUARD */
    .addNode("citation_guard", async (state) => {
      const sess = activeSessions.get(state.threadId);
      const startTime = sess?.startTime || Date.now();
      emitRunEvent(state.runId, "node_event", {
        node: "citation_guard",
        status: "running",
        label: "Verifying page numbers & verbatim citations (Zero-Unsourced-Flag Guard)",
      });

      const verifiedFindingsByBid: Record<string, GroundedFinding[]> = {};
      let suppressed = 0;

      for (const bid of state.bids) {
        const packet = state.packets[bid.id];
        const stat = state.statutoryVerdicts[bid.id];
        const rawList = state.rawFindingsByBid[bid.id] || [];
        const evidencePool = [
          packet?.combinedText || "",
          JSON.stringify(packet?.metadata || {}),
          JSON.stringify(stat || {}),
          JSON.stringify(bid.line_items || []),
          String(bid.quoted_amount || ""),
          Number(bid.quoted_amount || 0).toLocaleString(),
          "[REDACTED_PROMPT_INJECTION_ATTEMPT]",
        ];

        const kept: GroundedFinding[] = [];
        for (const f of rawList) {
          const validPage =
            Number.isFinite(f.citation?.page) &&
            f.citation.page >= 1 &&
            f.citation.page <= Math.max(packet?.totalPages || 1, 1);
          const validQuote = quoteExistsInEvidence(
            f.citation?.verbatim_quote || "",
            packet?.combinedText || "",
            evidencePool,
          );

          if (validPage && validQuote) {
            kept.push({ ...f, grounded: true });
          } else {
            suppressed += 1;
          }
        }

        if (kept.length === 0) {
          kept.push({
            key: `clean_${bid.id}`,
            severity: "info",
            category: "statutory",
            title: "No adverse findings — statutory & price checks verified",
            detail: "Every statutory register check passed and benchmarked line items sit within permitted market tolerances.",
            title_sw: "Hakuna dosari — ukaguzi wa kisheria na bei umethibitishwa",
            detail_sw: "Cheti vyote vimekaguliwa na bei ziko ndani ya viwango vya soko vilivyoidhinishwa.",
            citation: {
              document_name: packet?.documentName || "Bid Dossier",
              page: 1,
              section: "Preliminary Responsiveness Summary",
              verbatim_quote: bid.bidder_name || "Bid Submission",
              confidence: 0.99,
            },
            grounded: true,
          });
        }

        verifiedFindingsByBid[bid.id] = kept;
      }

      emitRunEvent(state.runId, "node_event", {
        node: "citation_guard",
        status: "completed",
        suppressed_count: suppressed,
        elapsed_ms: Date.now() - startTime,
      });

      return {
        verifiedFindingsByBid,
        unverifiedSuppressedCount: suppressed,
        nodesExecuted: [...(state.nodesExecuted || []), "citation_guard"],
      };
    })

    /* 5b. GATE 4 — CONFIRM BILINGUAL DOSSIER LANGUAGE & COMMITTEE GATE LOCK */
    .addNode("gate_final_dossier", async (state) => {
      emitRunEvent(state.runId, "node_event", {
        node: "gate_final_dossier",
        status: "awaiting_approval",
        label: "Paused at Gate 4: Confirm dossier language & lock Human Committee Sign-Off Gate",
      });

      const allFindingsCount = Object.values(state.verifiedFindingsByBid || {}).reduce((s, arr) => s + arr.length, 0);
      const payload: HitlInterruptPayload = {
        interrupt_id: `int_final_${Date.now()}`,
        thread_id: state.threadId,
        run_id: state.runId,
        gate_type: "final_dossier_lock",
        title_en: "Confirm Briefing Language & Draft Committee Dossier",
        title_sw: "Thibitisha Lugha & Andaa Faili ya Kamati",
        prompt_en: `Citation Guard verified ${allFindingsCount} grounded finding(s) (${state.unverifiedSuppressedCount} unsourced claim(s) suppressed). Confirm output language and authorize MCP tool \`draft_evaluation_report\` (Human Committee Gate remains locked — never auto-awarded).`,
        prompt_sw: `Ulinzi wa Ushahidi umethibitisha hoja ${allFindingsCount}. Thibitisha lugha ya muhtasari na uruhusu zana ya MCP \`draft_evaluation_report\` kuandaa faili ya Kamati.`,
        pending_mcp_tool: "draft_evaluation_report",
        proposed_args: {
          tender_number: state.tender?.tender_number || "TNT-2026",
          verified_findings: allFindingsCount,
          language: state.languageResolved,
          never_auto_awarded: true,
        },
        evidence_citation: null,
        requires_input: null,
        options: [
          {
            id: "approve_en",
            action: "approve",
            label_en: "Draft Dossier (English)",
            label_sw: "Andaa Faili (Kiingereza)",
            tone: state.languageResolved === "en" ? "primary" : "outline",
          },
          {
            id: "approve_sw",
            action: "approve_sw",
            label_en: "Draft Dossier (Kiswahili)",
            label_sw: "Andaa Faili (Kiswahili)",
            tone: state.languageResolved === "sw" ? "primary" : "outline",
          },
        ],
      };

      const decision: any = interrupt(payload);
      let nextLang = state.languageResolved;
      if (decision?.action === "approve_sw" || decision?.language === "sw") {
        nextLang = "sw";
      } else if (decision?.language === "en") {
        nextLang = "en";
      }
      const sess = activeSessions.get(state.threadId);
      if (sess) {
        sess.languageResolved = nextLang;
        sess.approvedActions += 1;
      }

      emitRunEvent(state.runId, "node_event", {
        node: "gate_final_dossier",
        status: "completed",
        language_resolved: nextLang,
      });

      return {
        languageResolved: nextLang,
        nodesExecuted: [...(state.nodesExecuted || []), "gate_final_dossier"],
      };
    })

    /* 6. BILINGUAL DRAFTER & HUMAN-IN-THE-LOOP GATE */
    .addNode("bilingual_drafter_and_gate", async (state) => {
      const sess = activeSessions.get(state.threadId);
      const startTime = sess?.startTime || Date.now();
      emitRunEvent(state.runId, "node_event", {
        node: "bilingual_drafter_and_gate",
        status: "running",
        label: `Streaming ${state.languageResolved === "sw" ? "Kiswahili" : "English"} committee brief & locking Human Gate`,
      });

      const evaluations: any[] = [];
      const flaggedBidders: string[] = [];

      for (const bid of state.bids) {
        const stat = state.statutoryVerdicts[bid.id];
        const pricing = state.pricingVerdicts[bid.id];
        const packet = state.packets[bid.id];
        const findings = state.verifiedFindingsByBid[bid.id] || [];

        const criticalCount = findings.filter((f) => f.severity === "critical").length;
        const warningCount = findings.filter((f) => f.severity === "warning").length;
        const overallStatus = criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "compliant";
        if (criticalCount > 0) flaggedBidders.push(bid.bidder_name);

        const verdictByKey = (k: string) => (stat?.verdicts || []).find((v: any) => v.key === k)?.status;

        evaluations.push({
          id: `eval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          bid_id: bid.id,
          tender_id: state.tender?.id || "tnd_01",
          bid_submissions: bid,
          kra_tax_status: verdictByKey("kra_tax_status") || "UNVERIFIED_MANUAL_CHECK",
          brs_status: verdictByKey("brs_status") || "UNVERIFIED_MANUAL_CHECK",
          nssf_status: verdictByKey("nssf_status") || "UNVERIFIED_MANUAL_CHECK",
          sha_shif_status: verdictByKey("sha_shif_status") || "UNVERIFIED_MANUAL_CHECK",
          agpo_status: verdictByKey("agpo_status") || "NOT_AGPO_REGISTERED",
          price_variance_score: (() => {
            const bench = (pricing?.items || []).filter((i: any) => typeof i.variance_percentage === "number");
            if (!bench.length) return 0;
            return Number((bench.reduce((s: number, i: any) => s + Math.max(0, i.variance_percentage), 0) / bench.length).toFixed(1));
          })(),
          collusion_risk_score: state.collusionSignals.some((c) => c.bid_a === bid.id || c.bid_b === bid.id) ? 90 : 0,
          verified_citations: findings.map((f) => f.citation),
          findings,
          parsed_pages: packet?.pages || [],
          run_id: state.runId,
          summary:
            state.languageResolved === "sw"
              ? criticalCount > 0
                ? `Dosari kuu ${criticalCount} na tahadhari ${warningCount} zimebainishwa kwa uamuzi wa Kamati.`
                : warningCount > 0
                  ? `Tahadhari ${warningCount} zinahitaji uhakiki wa Kamati.`
                  : "Ukaguzi wote wa kisheria na bei umethibitishwa."
              : criticalCount > 0
                ? `${criticalCount} critical flag(s) and ${warningCount} review item(s) compiled for Committee Gate.`
                : warningCount > 0
                  ? `${warningCount} review item(s) flagged for committee attention.`
                  : "All statutory checks passed and benchmarked pricing sits inside market tolerance.",
          overall_status: overallStatus,
          evaluated_at: new Date().toISOString(),
        });
      }

      const responsiveBids = evaluations.filter((e) => e.overall_status !== "critical");
      const lowestCandidate = responsiveBids[0]?.bid_submissions;
      const tenderId = state.tender?.id || "tnd_01";
      const tenderNumber = state.tender?.tender_number || "TNT-2026";
      const runSource = state.source || "live_ui";

      const { result: reportResult, trace: reportTrace } = await mcpManager.callTool(
        "draft_evaluation_report",
        {
          tender_id: tenderId,
          tender_number: tenderNumber,
          lowest_responsive_candidate: lowestCandidate?.bidder_name || "No cleared candidate — committee review required",
          quoted_amount: Number(lowestCandidate?.quoted_amount || 0),
          flagged_bidders: flaggedBidders,
          compliance_summary: `${evaluations.length} bid(s) audited; ${flaggedBidders.length} flagged; 0 autonomous awards issued.`,
          sector_mode: state.sectorMode,
        },
        {
          agent: "bilingual_drafter_and_gate",
          agent_label: "Bilingual Drafter",
          step_order: nextStep(state.threadId),
          bidder_name: lowestCandidate?.bidder_name || "All Bidders",
          reason: `Seal bilingual (${state.languageResolved.toUpperCase()}) Committee Evaluation Dossier & SHA-256 chain (${evaluations.length} bids; never auto-awarded)`,
          source: runSource,
          tender_id: tenderId,
          tender_number: tenderNumber,
          human_gate_required: true,
        },
        state.runId,
      );
      emitRunEvent(state.runId, "mcp_call", reportTrace);

      const fallbackBrief =
        state.languageResolved === "sw"
          ? `MUHTASARI WA KAMATI YA TATHMINI (${state.tender?.tender_number || "ZABUNI"})\n` +
            `• Hali ya Mfumo: ${state.sectorMode === "corporate_rfp" ? "Ununuzi wa Kampuni Binafsi (KYB)" : "Sheria ya PPADA 2015 (Umma)"}\n` +
            `• Zabuni Zilizokaguliwa: ${evaluations.length} | Zenye Dosari Kuu: ${flaggedBidders.length}\n` +
            `• Ulinzi wa Ushahidi: Hoja zote zina nambari ya ukurasa na nukuu halisi (hoja zisizo na ushahidi zilizuiwa: ${state.unverifiedSuppressedCount}).\n` +
            `• MUHIMU: Wakala huu huandaa faili ya tathmini pekee na kamwe hautoi zabuni. Uamuzi wa mwisho ni wa Kamati ya Tathmini na Afisa Mhasibu.\n` +
            (reportResult?.audit_seal ? `• Muhuri wa SHA-256: ${reportResult.audit_seal.slice(0, 16)}...` : "")
          : `PRE-COMMITTEE EVALUATION BRIEF (${state.tender?.tender_number || "TENDER"})\n` +
            `• Governance Mode: ${state.sectorMode === "corporate_rfp" ? "Private Corporate RFP & KYB" : "Kenya PPADA 2015 / OCDS Public Procurement"}\n` +
            `• Bids Audited: ${evaluations.length} | Critical Exceptions: ${flaggedBidders.length}\n` +
            `• Evidentiary Guard: Every flag carries a verified document, page, and verbatim quote (${state.unverifiedSuppressedCount} unverified claim(s) suppressed).\n` +
            `• NON-NEGOTIABLE INVARIANT: This dossier prepares the evaluation record only and never awards the tender. Named Evaluation Committee & Accounting Officer sign-off is locked and mandatory.`;

      const cleanEvidenceSummary = evaluations.map((ev) => ({
        bidder: ev.bid_submissions?.bidder_name,
        overall_status: ev.overall_status,
        findings: ev.findings.map((f: GroundedFinding) => ({
          severity: f.severity,
          title: state.languageResolved === "sw" ? f.title_sw : f.title,
          citation: `${f.citation.document_name} p.${f.citation.page}: "${f.citation.verbatim_quote}"`,
        })),
      }));

      const synthesis = await streamSynthesis({
        modelId: state.modelEngine,
        systemInstruction:
          state.languageResolved === "sw"
            ? "Wewe ni msaidizi wa ukaguzi wa zabuni wa Pulao-AI. Jibu kwa Kiswahili sanifu cha kitaalamu. Taja ushahidi na nambari za kurasa tu kutoka kwenye data iliyotolewa. Kamwe usiseme kuwa wakala ametoa zabuni."
            : "You are Pulao-AI, an authoritative procurement oversight synthesizer. Cite ONLY facts, page numbers, and verbatim evidence present in the verified JSON below. Always state clearly that the human Evaluation Committee holds sole authority to decide or award.",
        prompt: sanitizeUntrustedText(
          `Tender: ${state.tender?.tender_number} (${state.tender?.title})\nSector Mode: ${state.sectorMode}\nVerified Findings:\n${JSON.stringify(cleanEvidenceSummary, null, 2)}`,
        ).sanitized,
        fallbackText: fallbackBrief,
        onThought: (thought) => emitRunEvent(state.runId, "thinking_chunk", { text: thought }),
        onToken: (token) => emitRunEvent(state.runId, "token_chunk", { text: token }),
      });

      emitRunEvent(state.runId, "cost_update", synthesis.telemetry);
      emitRunEvent(state.runId, "node_event", {
        node: "bilingual_drafter_and_gate",
        status: "gated",
        human_gate_armed: true,
        elapsed_ms: Date.now() - startTime,
      });

      return {
        evaluations,
        bilingualBrief: synthesis.text,
        thoughts: synthesis.thoughts,
        telemetry: synthesis.telemetry,
        nodesExecuted: [...(state.nodesExecuted || []), "bilingual_drafter_and_gate"],
      };
    })

    /* CONDITIONAL ROUTING WITH INTERACTIVE HITL GATES */
    .addEdge(START, "supervisor_planner")
    .addEdge("supervisor_planner", "intake_and_ocr")
    .addConditionalEdges("intake_and_ocr", (state) => {
      if (state.lowOcrBids && state.lowOcrBids.length > 0) return "recovery_handler";
      if (state.missingRegBids && state.missingRegBids.length > 0) return "gate_ocr_clarification";
      return "specialist_audit";
    })
    .addEdge("recovery_handler", "gate_ocr_clarification")
    .addEdge("gate_ocr_clarification", "specialist_audit")
    .addConditionalEdges("specialist_audit", (state) => {
      if (state.unbenchmarkedItems && state.unbenchmarkedItems.length > 0) return "gate_pricing_benchmark";
      if (state.stagedDisqualifications && state.stagedDisqualifications.length > 0) return "gate_approval_disqualification";
      return "citation_guard";
    })
    .addConditionalEdges("gate_pricing_benchmark", (state) => {
      if (state.stagedDisqualifications && state.stagedDisqualifications.length > 0) return "gate_approval_disqualification";
      return "citation_guard";
    })
    .addEdge("gate_approval_disqualification", "citation_guard")
    .addEdge("citation_guard", "gate_final_dossier")
    .addEdge("gate_final_dossier", "bilingual_drafter_and_gate")
    .addEdge("bilingual_drafter_and_gate", END);

  return workflow.compile({ checkpointer: sharedCheckpointer });
}

const compiledWorkflow = buildWorkflow();

async function finalizeOrPauseResult(result: any, runId: string, threadId: string) {
  const sess = activeSessions.get(threadId);
  const interrupts = result?.__interrupt__;
  const runSource = sess?.source || "live_ui";
  const supervisorRationale = sess?.supervisorRationale || result?.supervisorRationale || "";

  if (Array.isArray(interrupts) && interrupts.length > 0) {
    const firstInt = interrupts[0]?.value as HitlInterruptPayload;
    if (sess) {
      sess.interruptedAt = Date.now();
      sess.interruptCount += 1;
    }

    await appendAgentRun({
      run_id: runId,
      source: runSource,
      tender_id: sess?.tender?.id || "tnd_01",
      tender_number: sess?.tender?.tender_number || "TNT-2026",
      sector_mode: sess?.sectorMode || "public_ppada",
      model_id: sess?.modelEngine || "gemini-4-hydrogen",
      execution_backend: "LangGraph Checkpointer (Paused)",
      supervisor_rationale: supervisorRationale,
      language_requested: sess?.languageRequested || "auto",
      language_detected: sess?.languageDetected || "en",
      language_resolved: sess?.languageResolved || "en",
      status: "awaiting_user_input",
      nodes_executed: result.nodesExecuted || [],
      retry_count: result.recoveryAttempts || 0,
      human_escalations: (result.lowOcrBids || []).length,
      unverified_claims_suppressed: result.unverifiedSuppressedCount || 0,
      interrupt_count: sess?.interruptCount || 1,
      human_decision: sess?.lastDecision || "pending",
      human_wait_ms: sess?.humanWaitMs || 0,
      approved_actions: sess?.approvedActions || 0,
      rejected_actions: sess?.rejectedActions || 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      thinking_tokens: 0,
      estimated_cost_usd: 0,
      estimated_cost_kes: 0,
      latency_ms: Date.now() - (sess?.startTime || Date.now()),
      created_at: new Date().toISOString(),
    });

    emitRunEvent(runId, "human_interrupt", firstInt);
    activeEmitters.delete(runId);

    return {
      interrupted: true,
      status: "awaiting_user_input",
      thread_id: threadId,
      run_id: runId,
      interrupt: firstInt,
      nodes_executed: result.nodesExecuted || [],
      interrupt_count: sess?.interruptCount || 1,
      evaluations: [],
    };
  }

  const latencyMs = Date.now() - (sess?.startTime || Date.now());
  const telemetry = result.telemetry || {
    promptTokens: 0,
    completionTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    estimatedCostKes: 0,
    backend: "Deterministic Verified Fallback",
  };

  await appendAgentRun({
    run_id: runId,
    source: runSource,
    tender_id: sess?.tender?.id || "tnd_01",
    tender_number: sess?.tender?.tender_number || "TNT-2026",
    sector_mode: sess?.sectorMode || "public_ppada",
    model_id: sess?.modelEngine || "gemini-4-hydrogen",
    execution_backend: telemetry.backend,
    supervisor_rationale: supervisorRationale,
    language_requested: sess?.languageRequested || "auto",
    language_detected: sess?.languageDetected || "en",
    language_resolved: result.languageResolved || sess?.languageResolved || "en",
    status: "awaiting_human_gate",
    nodes_executed: result.nodesExecuted || [],
    retry_count: result.recoveryAttempts || 0,
    human_escalations: (result.lowOcrBids || []).length,
    unverified_claims_suppressed: result.unverifiedSuppressedCount || 0,
    interrupt_count: sess?.interruptCount || 0,
    human_decision: sess?.lastDecision || "none",
    human_wait_ms: sess?.humanWaitMs || 0,
    approved_actions: sess?.approvedActions || 0,
    rejected_actions: sess?.rejectedActions || 0,
    prompt_tokens: telemetry.promptTokens || 0,
    completion_tokens: telemetry.completionTokens || 0,
    thinking_tokens: telemetry.thinkingTokens || 0,
    estimated_cost_usd: telemetry.estimatedCostUsd || 0,
    estimated_cost_kes: telemetry.estimatedCostKes || 0,
    latency_ms: latencyMs,
    created_at: new Date().toISOString(),
  });

  const payload = {
    interrupted: false,
    run_id: runId,
    thread_id: threadId,
    source: runSource,
    sector_mode: sess?.sectorMode || result.sectorMode,
    language_detected: sess?.languageDetected || result.languageDetected,
    language_resolved: result.languageResolved || sess?.languageResolved,
    supervisor_rationale: supervisorRationale,
    rationale_source: sess?.rationaleSource || "deterministic",
    never_auto_awarded: true,
    human_gate_armed: true,
    nodes_executed: result.nodesExecuted,
    recovery_attempts: result.recoveryAttempts,
    low_ocr_bids: result.lowOcrBids,
    unverified_claims_suppressed: result.unverifiedSuppressedCount,
    interrupt_count: sess?.interruptCount || 0,
    human_decision: sess?.lastDecision || "none",
    human_wait_ms: sess?.humanWaitMs || 0,
    approved_actions: sess?.approvedActions || 0,
    rejected_actions: sess?.rejectedActions || 0,
    evaluations: result.evaluations,
    collusion_signals: result.collusionSignals,
    bilingual_brief: result.bilingualBrief,
    telemetry,
    latency_ms: latencyMs,
  };

  emitRunEvent(runId, "complete", payload);
  activeEmitters.delete(runId);
  activeSessions.delete(threadId);
  return payload;
}

export async function runMultiAgentAudit({
  tender,
  bids = [],
  priceIndex = [],
  modelEngine = "gemini-4-hydrogen",
  languageRequested = "auto",
  sectorModeOverride,
  source = "live_ui",
  emitter,
}: {
  tender: any;
  bids: any[];
  priceIndex?: any[];
  modelEngine?: string;
  languageRequested?: string;
  sectorModeOverride?: "public_ppada" | "corporate_rfp";
  source?: "live_ui" | "eval";
  emitter?: StreamEmitter;
}) {
  const startTime = Date.now();
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const threadId = runId;
  const activeRulebook = await getRulebook();
  const sectorMode = sectorModeOverride || activeRulebook.sector_mode || "public_ppada";
  const allowedVariancePct = sectorMode === "corporate_rfp" ? 12 : activeRulebook.allowed_price_variance_pct || 15;

  const sampleText = [
    tender?.title,
    ...bids.map((b) => `${b.bidder_name} ${b.inline_packet_text || ""} ${(b.line_items || []).map((i: any) => i.description).join(" ")}`),
  ].join(" ");
  const langInfo = resolveOutputLanguage(languageRequested, sampleText);

  if (emitter) activeEmitters.set(runId, emitter);
  activeSessions.set(threadId, {
    startTime,
    source,
    stepCounter: 0,
    supervisorRationale: "",
    rationaleSource: "deterministic",
    interruptedAt: null,
    interruptCount: 0,
    humanWaitMs: 0,
    approvedActions: 0,
    rejectedActions: 0,
    lastDecision: "none",
    tender,
    bids,
    modelEngine,
    sectorMode,
    languageRequested,
    languageDetected: langInfo.detected,
    languageResolved: langInfo.resolved,
  });

  const result = await compiledWorkflow.invoke(
    {
      runId,
      threadId,
      source,
      tender,
      bids,
      priceIndex,
      modelEngine,
      languageRequested,
      languageDetected: langInfo.detected,
      languageResolved: langInfo.resolved,
      sectorMode,
      allowedVariancePct,
      supervisorRationale: "",
      rationaleSource: "deterministic",
      plan: [],
      packets: {},
      lowOcrBids: [],
      missingRegBids: [],
      manualRegOverrides: {},
      clarificationIssuedBids: [],
      recoveryAttempts: 0,
      statutoryVerdicts: {},
      pricingVerdicts: {},
      collusionSignals: [],
      unbenchmarkedItems: [],
      stagedDisqualifications: [],
      rawFindingsByBid: {},
      verifiedFindingsByBid: {},
      unverifiedSuppressedCount: 0,
      evaluations: [],
      bilingualBrief: "",
      thoughts: "",
      telemetry: null,
      nodesExecuted: [],
    },
    { configurable: { thread_id: threadId } },
  );

  return finalizeOrPauseResult(result, runId, threadId);
}

export async function resumeMultiAgentAudit({
  threadId,
  runId,
  decision,
  emitter,
}: {
  threadId: string;
  runId?: string;
  decision: Record<string, any>;
  emitter?: StreamEmitter;
}) {
  const effectiveRunId = runId || threadId;
  if (emitter) activeEmitters.set(effectiveRunId, emitter);

  const sess = activeSessions.get(threadId);
  if (sess) {
    if (sess.interruptedAt) {
      sess.humanWaitMs += Date.now() - sess.interruptedAt;
      sess.interruptedAt = null;
    }
    sess.lastDecision = String(decision?.action || "approve");
  }

  const result = await compiledWorkflow.invoke(new Command({ resume: decision || { action: "approve" } }), {
    configurable: { thread_id: threadId },
  });

  return finalizeOrPauseResult(result, effectiveRunId, threadId);
}
