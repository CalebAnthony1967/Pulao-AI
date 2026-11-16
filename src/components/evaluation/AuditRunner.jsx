import React, { useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Coins,
  FileText,
  Globe,
  Layers,
  Loader2,
  Lock,
  PauseCircle,
  Play,
  Shield,
  Sparkles,
} from "lucide-react";
import {
  resumeStreamingMultiAgentPipeline,
  runStreamingMultiAgentPipeline,
} from "@/lib/langgraphOrchestrator.js";
import { AVAILABLE_MODELS } from "@/lib/sovereignAgent.js";
import { upsertRunMetadata } from "@/lib/mcpClient.js";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const GRAPH_STAGES = [
  { id: "supervisor_planner", label: "Supervisor Plan", desc: "Rulebook & MCP" },
  { id: "intake_and_ocr", label: "Packet & OCR", desc: "PDF + Hygiene" },
  { id: "recovery_handler", label: "OCR Recovery", desc: "Fairness Branch", optional: true },
  { id: "specialist_audit", label: "Specialist Agents", desc: "Tax, Price, Ring" },
  { id: "citation_guard", label: "Citation Guard", desc: "Zero Unsourced" },
  { id: "bilingual_drafter_and_gate", label: "Committee Gate", desc: "Human Award Lock" },
];

export default function AuditRunner({ tender, bids, priceIndex, onComplete, onRunEvent }) {
  const { language, setLanguage, resolvedLanguage, sectorMode, setSectorMode, t } = useI18n();
  const [running, setRunning] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gemini-4-hydrogen");
  const [nodeStates, setNodeStates] = useState({});
  const [planSteps, setPlanSteps] = useState([]);
  const [thinkingText, setThinkingText] = useState("");
  const [briefText, setBriefText] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const [telemetry, setTelemetry] = useState(null);
  const [runMeta, setRunMeta] = useState(null);
  const [pendingInterrupt, setPendingInterrupt] = useState(null);
  const [interruptInput, setInterruptInput] = useState("");
  const [error, setError] = useState(null);
  const [finished, setFinished] = useState(false);

  const activeModelMeta = AVAILABLE_MODELS.find((m) => m.id === selectedModel) || AVAILABLE_MODELS[0];

  const completedCount = Object.values(nodeStates).filter(
    (s) => s === "completed" || s === "gated",
  ).length;

  const handleStreamEvent = (eventName, data) => {
    if (onRunEvent) {
      try {
        onRunEvent(eventName, data);
      } catch {}
    }

    if (eventName === "plan") {
      setPlanSteps(data.steps || []);
      const metaObj = {
        runId: data.run_id,
        threadId: data.thread_id || data.run_id,
        languageDetected: data.language_detected,
        languageResolved: data.language_resolved,
        sectorMode: data.sector_mode,
        supervisorRationale: data.supervisor_rationale || "",
        rationaleSource: data.rationale_source || "deterministic",
      };
      setRunMeta(metaObj);
      upsertRunMetadata({
        run_id: data.run_id,
        tender_id: data.tender_id || tender?.id,
        tender_number: data.tender_number || tender?.tender_number,
        sector_mode: data.sector_mode,
        supervisor_rationale: data.supervisor_rationale || "",
        rationale_source: data.rationale_source || "deterministic",
        created_at: new Date().toISOString(),
      });
    } else if (eventName === "node_event" && data?.node) {
      setNodeStates((prev) => ({ ...prev, [data.node]: data.status }));
    } else if (eventName === "human_interrupt" && data) {
      setPendingInterrupt(data);
      setInterruptInput("");
    } else if (eventName === "thinking_chunk" && data?.text) {
      setThinkingText((prev) => prev + data.text);
    } else if (eventName === "token_chunk" && data?.text) {
      setBriefText((prev) => prev + data.text);
    } else if (eventName === "cost_update") {
      setTelemetry(data);
    } else if (eventName === "complete") {
      setPendingInterrupt(null);
      setRunMeta((prev) => ({
        ...(prev || {}),
        runId: data.run_id,
        threadId: data.thread_id,
        languageDetected: data.language_detected,
        languageResolved: data.language_resolved,
        supervisorRationale: data.supervisor_rationale || prev?.supervisorRationale || "",
        rationaleSource: data.rationale_source || prev?.rationaleSource || "deterministic",
        suppressed: data.unverified_claims_suppressed,
        interruptCount: data.interrupt_count || 0,
        humanWaitMs: data.human_wait_ms || 0,
        lowOcrCount: (data.low_ocr_bids || []).length,
        latencyMs: data.latency_ms,
      }));
      upsertRunMetadata({
        run_id: data.run_id,
        tender_id: tender?.id,
        tender_number: tender?.tender_number,
        sector_mode: data.sector_mode,
        supervisor_rationale: data.supervisor_rationale || "",
        latency_ms: data.latency_ms,
      });
    }
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    setFinished(false);
    setPendingInterrupt(null);
    setInterruptInput("");
    setNodeStates({ supervisor_planner: "running" });
    setPlanSteps([]);
    setThinkingText("");
    setBriefText("");
    setTelemetry(null);
    setRunMeta(null);

    try {
      const result = await runStreamingMultiAgentPipeline({
        tender,
        bids,
        priceIndex,
        modelEngine: selectedModel,
        language,
        sectorMode,
        onEvent: handleStreamEvent,
      });

      if (result?.interrupted) {
        setPendingInterrupt(result.interrupt);
      } else {
        setFinished(true);
        if (onComplete) onComplete(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const handleResume = async (option) => {
    if (!pendingInterrupt || resuming) return;
    setResuming(true);
    setError(null);

    const decision = { action: option.action };
    if (pendingInterrupt.requires_input?.field && interruptInput.trim()) {
      decision[pendingInterrupt.requires_input.field] = interruptInput.trim();
    }
    if (option.action === "approve_sw") {
      decision.language = "sw";
    }

    const currentThread = pendingInterrupt.thread_id || runMeta?.threadId || runMeta?.runId;
    const currentRun = pendingInterrupt.run_id || runMeta?.runId;
    setPendingInterrupt(null);

    try {
      const result = await resumeStreamingMultiAgentPipeline({
        threadId: currentThread,
        runId: currentRun,
        decision,
        tender,
        bids,
        onEvent: handleStreamEvent,
      });

      if (result?.interrupted) {
        setPendingInterrupt(result.interrupt);
      } else {
        setFinished(true);
        if (onComplete) onComplete(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setResuming(false);
    }
  };

  const displaySw =
    resolvedLanguage === "sw" || runMeta?.languageResolved === "sw";

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
      {/* Top Bar: Title, Governance Mode, Language & Model Controls */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Layers className="h-5 w-5 text-navy" />
            <h3 className="font-semibold text-foreground">{t("workflowTitle")}</h3>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t("workflowSubtitle")}
          </p>
          <p className="mt-1 text-[11px] font-mono text-muted-foreground">
            LangGraph Checkpointer · Stdio MCP · Interactive HITL Gates
          </p>
        </div>

        <div className="flex flex-col sm:items-end gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-background p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setSectorMode("public_ppada")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 font-medium whitespace-nowrap transition-all",
                  sectorMode === "public_ppada" ? "bg-navy text-white" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Shield className="h-3 w-3" />
                {t("sectorPublic")}
              </button>
              <button
                type="button"
                onClick={() => setSectorMode("corporate_rfp")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 font-medium whitespace-nowrap transition-all",
                  sectorMode === "corporate_rfp" ? "bg-navy text-white" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Building2 className="h-3 w-3" />
                {t("sectorCorporate")}
              </button>
            </div>

            <div className="flex items-center rounded-lg border border-border bg-background p-0.5 text-xs">
              <Globe className="ml-2 mr-1 h-3.5 w-3.5 text-muted-foreground" />
              {[
                { id: "auto", label: "Auto" },
                { id: "en", label: "EN" },
                { id: "sw", label: "Kiswahili" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLanguage(opt.id)}
                  className={cn(
                    "rounded-md px-2 py-1 font-medium whitespace-nowrap transition-all",
                    language === opt.id ? "bg-compliance text-white" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-background p-0.5 text-xs">
              {AVAILABLE_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModel(m.id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium whitespace-nowrap transition-all",
                    selectedModel === m.id ? "bg-navy text-white shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m.name.split("(")[0].trim()}
                </button>
              ))}
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">{activeModelMeta.residency}</span>
          </div>
        </div>
      </div>

      {/* Non-Negotiable Human Award Gate Invariant */}
      <div className="flex items-center gap-2.5 rounded-lg border border-caution/30 bg-caution-soft/60 px-3.5 py-2.5 text-xs text-caution">
        <Lock className="h-4 w-4 shrink-0" />
        <span>{t("humanGateBanner")}</span>
      </div>

      {/* Multi-Agent Checkpointed Stage Rail */}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
          <span>Checkpointed Multi-Agent StateGraph (6 Stages · Interactive Interrupts)</span>
          {runMeta?.languageResolved && (
            <span className="font-mono text-navy">
              Lang: {runMeta.languageResolved.toUpperCase()} (detected: {runMeta.languageDetected?.toUpperCase()})
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {GRAPH_STAGES.map((stage, idx) => {
            const st = nodeStates[stage.id] || "idle";
            const isPausedHere =
              Boolean(pendingInterrupt) &&
              ((pendingInterrupt.gate_type === "ocr_clarification" && stage.id === "recovery_handler") ||
                ((pendingInterrupt.gate_type === "pricing_benchmark" ||
                  pendingInterrupt.gate_type === "pre_execution_approval") &&
                  stage.id === "specialist_audit") ||
                (pendingInterrupt.gate_type === "final_dossier_lock" &&
                  stage.id === "bilingual_drafter_and_gate"));
            const isActive = !isPausedHere && (st === "running" || st === "recovering");
            const isCompleted = !isPausedHere && (st === "completed" || st === "gated");
            const skippedOptional = stage.optional && finished && st === "idle";

            return (
              <div
                key={stage.id}
                className={cn(
                  "rounded-md border p-2 text-center transition-all",
                  isPausedHere
                    ? "border-caution bg-caution-soft/80 ring-1 ring-caution"
                    : st === "recovering"
                      ? "border-caution bg-caution-soft/60 ring-1 ring-caution"
                      : isActive
                        ? "border-navy bg-navy/10 ring-1 ring-navy"
                        : isCompleted
                          ? "border-compliance/40 bg-compliance-soft/40"
                          : skippedOptional
                            ? "border-border bg-background/40 opacity-50"
                            : "border-border bg-background/70 opacity-75",
                )}
              >
                <div className="mb-1 flex items-center justify-center gap-1">
                  <span className="font-mono text-[10px] text-muted-foreground">{idx + 1}.</span>
                  {isPausedHere ? (
                    <PauseCircle className="h-3.5 w-3.5 text-caution" />
                  ) : isCompleted ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-compliance" />
                  ) : isActive ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-navy" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-border" />
                  )}
                </div>
                <div className="truncate text-[11px] font-semibold text-foreground">{stage.label}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {isPausedHere ? "Paused · Approval" : skippedOptional ? "Skipped (OCR OK)" : stage.desc}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* INTERACTIVE HITL AGENT INTERRUPT CARD */}
      {pendingInterrupt && (
        <div className="rounded-xl border border-caution bg-caution-soft/50 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-caution/20 pb-2.5">
            <div className="flex items-start gap-2.5">
              <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-caution" />
              <div>
                <p className="text-[11px] font-semibold text-caution">{t("pausedGateLabel")}</p>
                <h4 className="text-sm font-semibold text-foreground">
                  {displaySw ? pendingInterrupt.title_sw : pendingInterrupt.title_en}
                </h4>
              </div>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              MCP staged: {pendingInterrupt.pending_mcp_tool}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-foreground">
            {displaySw ? pendingInterrupt.prompt_sw : pendingInterrupt.prompt_en}
          </p>

          {pendingInterrupt.evidence_citation && (
            <div className="rounded-md border border-border bg-card px-3 py-2 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <FileText className="h-3.5 w-3.5 text-navy" />
                <span>{pendingInterrupt.evidence_citation.document_name}</span>
                <span aria-hidden="true">·</span>
                <span>Page {pendingInterrupt.evidence_citation.page}</span>
                <span aria-hidden="true">·</span>
                <span>{pendingInterrupt.evidence_citation.section}</span>
              </div>
              <p className="font-mono text-[11px] text-foreground">
                &ldquo;{pendingInterrupt.evidence_citation.verbatim_quote}&rdquo;
              </p>
            </div>
          )}

          {pendingInterrupt.requires_input && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">
                {displaySw
                  ? pendingInterrupt.requires_input.label_sw
                  : pendingInterrupt.requires_input.label_en}
              </label>
              <Input
                type={pendingInterrupt.requires_input.inputType || "text"}
                value={interruptInput}
                onChange={(e) => setInterruptInput(e.target.value)}
                placeholder={pendingInterrupt.requires_input.placeholder}
                className="h-9 bg-background text-xs font-mono"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {(pendingInterrupt.options || []).map((opt) => (
              <Button
                key={opt.id}
                type="button"
                size="sm"
                disabled={resuming}
                onClick={() => handleResume(opt)}
                variant={opt.tone === "outline" ? "outline" : "default"}
                className={cn(
                  "text-xs py-2 px-4 whitespace-nowrap",
                  opt.tone === "primary" && "bg-navy text-white hover:bg-navy/90",
                  opt.tone === "critical" && "bg-critical text-white hover:bg-critical/90",
                  opt.tone === "caution" && "bg-caution text-white hover:bg-caution/90",
                )}
              >
                {resuming && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {displaySw ? opt.label_sw : opt.label_en}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {pendingInterrupt
            ? t("awaitingUserApproval")
            : `${bids.length} submitted bid(s) queued for statutory, pricing, collusion & citation verification.`}
        </p>

        <Button
          onClick={run}
          disabled={running || resuming || !bids.length}
          className="bg-navy text-white hover:bg-navy/90 text-xs py-2 px-4 whitespace-nowrap"
        >
          {running || resuming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {running ? t("runningWorkflow") : resuming ? "Resuming paused graph..." : t("runWorkflow")}
        </Button>
      </div>

      {(running || resuming || completedCount > 0) && (
        <Progress value={Math.min(100, (completedCount / 5) * 100)} className="h-1.5" />
      )}

      {/* Collapsible Thinking & Supervisor Plan Drawer */}
      {(planSteps.length > 0 || thinkingText) && (
        <div className="rounded-lg border border-border bg-background">
          <button
            type="button"
            onClick={() => setShowThinking((v) => !v)}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs font-semibold text-navy hover:bg-muted/40"
          >
            <span className="flex items-center gap-2">
              {showThinking ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Sparkles className="h-3.5 w-3.5 text-compliance" />
              {t("thinkingTrace")}
            </span>
            {runMeta?.runId && <span className="font-mono text-[10px] text-muted-foreground">{runMeta.runId}</span>}
          </button>

          {showThinking && (
            <div className="space-y-2 border-t border-border px-3.5 py-3 text-xs font-mono">
              {runMeta?.supervisorRationale && (
                <div className="rounded border border-navy/20 bg-navy-soft/30 px-3 py-2 font-sans text-xs text-foreground">
                  <span className="font-semibold text-navy">Supervisor Rationale: </span>
                  {runMeta.supervisorRationale}
                </div>
              )}
              {planSteps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-2 text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-compliance" />
                  <span>{step}</span>
                </div>
              ))}
              {thinkingText && (
                <div className="mt-2 rounded border border-border bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {thinkingText}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Live Streaming Bilingual Brief + Token/Cost Comparison Strip */}
      {briefText && (
        <div className="rounded-lg border border-navy/20 bg-navy-soft/40 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-navy">{t("streamingBrief")}</span>
            {telemetry && (
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground tabular-nums">
                <span>{telemetry.backend}</span>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1 text-foreground">
                  <Coins className="h-3 w-3 text-compliance" />
                  {telemetry.totalTokens} tokens · ${Number(telemetry.estimatedCostUsd || 0).toFixed(5)} (KES{" "}
                  {Number(telemetry.estimatedCostKes || 0).toFixed(2)})
                </span>
                <span aria-hidden="true">·</span>
                <span>{t("costComparison")}</span>
                {runMeta?.latencyMs && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{runMeta.latencyMs}ms</span>
                  </>
                )}
              </div>
            )}
          </div>
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">{briefText}</pre>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-critical/30 bg-critical-soft p-3 text-xs text-critical">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {finished && !error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-compliance/30 bg-compliance-soft p-3 text-xs text-compliance">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Dossier verified across {runMeta?.interruptCount ?? 0} human checkpoint(s). Suppressed unverified claims:{" "}
            {runMeta?.suppressed ?? 0}. Committee Sign-Off Gate remains armed.
          </span>
        </div>
      )}
    </div>
  );
}
