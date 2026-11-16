import React, { useEffect, useMemo, useState } from "react";
import {
  Ban,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  FolderGit2,
  Key,
  Layers,
  Lock,
  PauseCircle,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserCheck,
} from "lucide-react";
import {
  getRunMetadataMap,
  getToolCallHistory,
  hydrateToolTraces,
  MCP_SERVERS,
  subscribeToToolCalls,
} from "@/lib/mcpClient.js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const AGENT_LABELS = {
  supervisor_planner: "Supervisor Planner",
  recovery_handler: "OCR Recovery Agent",
  statutory_auditor: "Statutory Auditor",
  pricing_analyst: "Pricing Analyst",
  approval_gate: "Human Approval Gate",
  bilingual_drafter_and_gate: "Bilingual Drafter",
  pulao_assistant: "Oversight Assistant",
};

function formatAgentLabel(trace) {
  if (trace?.context?.agent_label) return trace.context.agent_label;
  const raw = trace?.context?.agent || "";
  if (AGENT_LABELS[raw]) return AGENT_LABELS[raw];
  return raw ? raw.replace(/_/g, " ") : "Verification Agent";
}

function formatBidderName(trace) {
  return (
    trace?.context?.bidder_name ||
    trace?.inputs?.bidder_name ||
    trace?.inputs?.company_name ||
    null
  );
}

function formatReason(trace) {
  if (trace?.context?.reason) return trace.context.reason;
  const bidder = formatBidderName(trace);
  if (trace.tool === "query_compliance_rulebook") {
    return "Load sector governance thresholds before scanning submitted bids";
  }
  if (trace.tool === "list_procurement_vault") {
    return "Inspect sandboxed procurement dossier directory boundaries";
  }
  if (trace.tool === "verify_document_checksum") {
    return "Verify manifest integrity for low-OCR scan recovery";
  }
  if (trace.tool === "verify_statutory_registers") {
    return bidder ? `Check KRA TCC, BRS, NSSF, SHA/SHIF & PPRA status for ${bidder}` : "Check statutory compliance registers";
  }
  if (trace.tool === "benchmark_market_pricing") {
    return bidder ? `Compare ${bidder}'s quoted prices against PPRA Q2 2026 index` : "Benchmark unit prices against market baselines";
  }
  if (trace.tool === "flag_procurement_disqualification") {
    return bidder ? `Stage or record compliance exception flag for ${bidder}` : "Stage or record compliance exception flag";
  }
  if (trace.tool === "draft_evaluation_report") {
    return "Compile sealed Committee Evaluation Dossier & SHA-256 chain";
  }
  return "Stdio MCP tool invocation";
}

export default function McpToolCallLogger({
  tenderId = "",
  tenderNumber = "",
  currentRunId = null,
  sourceFilter = "live_ui",
  defaultOpen = false,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [history, setHistory] = useState(getToolCallHistory());
  const [runMetaMap, setRunMetaMap] = useState(getRunMetadataMap());
  const [activeFilter, setActiveFilter] = useState("all");
  const [expandedRuns, setExpandedRuns] = useState(() => (currentRunId ? { [currentRunId]: true } : {}));
  const [expandedTraceId, setExpandedTraceId] = useState(null);

  useEffect(() => {
    hydrateToolTraces({ source: sourceFilter, tenderId })
      .then((rows) => {
        setHistory(rows);
        setRunMetaMap(getRunMetadataMap());
      })
      .catch(() => {});

    return subscribeToToolCalls((_newCall, updatedHistory, updatedRuns) => {
      setHistory(updatedHistory);
      if (updatedRuns) setRunMetaMap(updatedRuns);
    });
  }, [sourceFilter, tenderId]);

  useEffect(() => {
    if (currentRunId) {
      setExpandedRuns((prev) => ({ ...prev, [currentRunId]: true }));
    }
  }, [currentRunId]);

  const effectiveRunId = useMemo(() => {
    if (currentRunId) return currentRunId;
    const latestWithRun = history.find((item) => item.run_id);
    return latestWithRun?.run_id || null;
  }, [currentRunId, history]);

  const currentRunTraces = useMemo(
    () => (effectiveRunId ? history.filter((item) => item.run_id === effectiveRunId) : []),
    [history, effectiveRunId],
  );

  const awaitingCount = useMemo(
    () => history.filter((item) => item.status === "awaiting_approval").length,
    [history],
  );
  const customCalls = useMemo(
    () => history.filter((item) => item.server_id === MCP_SERVERS.CUSTOM.id).length,
    [history],
  );
  const borrowedCalls = useMemo(
    () => history.filter((item) => item.server_id === MCP_SERVERS.BORROWED.id).length,
    [history],
  );
  const gatedCalls = useMemo(
    () =>
      history.filter(
        (item) =>
          item.context?.human_gate_required ||
          item.status === "awaiting_approval" ||
          item.status === "rejected_by_human",
      ).length,
    [history],
  );

  const filteredTraces = useMemo(() => {
    return history.filter((item) => {
      if (activeFilter === "current_run") {
        return effectiveRunId ? item.run_id === effectiveRunId : false;
      }
      if (activeFilter === "custom") return item.server_id === MCP_SERVERS.CUSTOM.id;
      if (activeFilter === "borrowed") return item.server_id === MCP_SERVERS.BORROWED.id;
      if (activeFilter === "gated") {
        return (
          item.context?.human_gate_required ||
          item.status === "awaiting_approval" ||
          item.status === "rejected_by_human"
        );
      }
      return true;
    });
  }, [history, activeFilter, effectiveRunId]);

  const groupedRuns = useMemo(() => {
    const groups = new Map();
    for (const item of filteredTraces) {
      const key = item.run_id || "assistant_direct";
      if (!groups.has(key)) {
        groups.set(key, {
          runId: key,
          traces: [],
          latestTs: new Date(item.timestamp).getTime(),
        });
      }
      const g = groups.get(key);
      g.traces.push(item);
      const ts = new Date(item.timestamp).getTime();
      if (ts > g.latestTs) g.latestTs = ts;
    }

    const result = Array.from(groups.values()).map((g) => {
      g.traces.sort((a, b) => {
        const sA = Number(a.context?.step_order ?? 9999);
        const sB = Number(b.context?.step_order ?? 9999);
        if (sA !== sB) return sA - sB;
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });
      const meta = runMetaMap[g.runId] || {};
      const firstTrace = g.traces[0];
      return {
        ...g,
        meta,
        tenderNumber: meta.tender_number || firstTrace?.tender_number || tenderNumber || "Tender Run",
        sectorMode: meta.sector_mode || firstTrace?.inputs?.sector_mode || null,
        rationale: meta.supervisor_rationale || "",
        hasPausedGate: g.traces.some((t) => t.status === "awaiting_approval"),
      };
    });

    result.sort((a, b) => {
      if (effectiveRunId && a.runId === effectiveRunId) return -1;
      if (effectiveRunId && b.runId === effectiveRunId) return 1;
      return b.latestTs - a.latestTs;
    });

    return result;
  }, [filteredTraces, runMetaMap, tenderNumber, effectiveRunId]);

  const toggleRun = (runId) => {
    setExpandedRuns((prev) => ({
      ...prev,
      [runId]: !prev[runId],
    }));
  };

  const displayCallCount = currentRunId
    ? currentRunTraces.length
    : currentRunTraces.length || history.length;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm transition-colors",
        awaitingCount > 0 ? "border-caution/60" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-muted/30 rounded-xl transition-colors"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <Terminal className="h-4 w-4 shrink-0 text-navy" />
          <span className="text-sm font-semibold text-foreground">Live Stdio MCP Tool Log</span>
          {tenderNumber && (
            <span className="hidden sm:inline font-mono text-xs text-muted-foreground">
              · {tenderNumber}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono text-muted-foreground tabular-nums">
          {awaitingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-caution-soft px-2 py-0.5 font-sans text-[11px] font-semibold text-caution">
              <PauseCircle className="h-3.5 w-3.5" />
              Awaiting Officer Approval ({awaitingCount})
            </span>
          )}
          <span>
            {displayCallCount === 0
              ? "Current Run: 0 calls (Click to inspect)"
              : `${currentRunId ? "Current Run" : "Latest Run"}: ${displayCallCount} call${displayCallCount === 1 ? "" : "s"}`}
          </span>
          {history.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="hidden md:inline">
                Total: {history.length} · Custom {customCalls} · Vault FS {borrowedCalls}
              </span>
            </>
          )}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-border p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={activeFilter === "all" ? "default" : "outline"}
                onClick={() => setActiveFilter("all")}
                className={cn("text-xs whitespace-nowrap", activeFilter === "all" && "bg-navy text-white")}
              >
                All Tender Runs ({history.length})
              </Button>
              {effectiveRunId && (
                <Button
                  type="button"
                  size="sm"
                  variant={activeFilter === "current_run" ? "default" : "outline"}
                  onClick={() => setActiveFilter("current_run")}
                  className={cn(
                    "text-xs whitespace-nowrap",
                    activeFilter === "current_run" && "bg-navy text-white",
                  )}
                >
                  Current Run ({currentRunTraces.length})
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={activeFilter === "custom" ? "default" : "outline"}
                onClick={() => setActiveFilter("custom")}
                className={cn(
                  "text-xs whitespace-nowrap",
                  activeFilter === "custom" && "bg-navy text-white",
                )}
              >
                Procurement MCP ({customCalls})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeFilter === "borrowed" ? "default" : "outline"}
                onClick={() => setActiveFilter("borrowed")}
                className={cn(
                  "text-xs whitespace-nowrap",
                  activeFilter === "borrowed" && "bg-purple-700 text-white",
                )}
              >
                Filesystem MCP ({borrowedCalls})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeFilter === "gated" ? "default" : "outline"}
                onClick={() => setActiveFilter("gated")}
                className={cn(
                  "text-xs whitespace-nowrap",
                  activeFilter === "gated" && "bg-caution text-white",
                )}
              >
                Approval Gates ({gatedCalls})
              </Button>
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground tabular-nums">
              <Cpu className="h-3.5 w-3.5 text-navy" />
              <span>Who · When · For Whom · Why</span>
            </div>
          </div>

          {groupedRuns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/50 p-6 text-center">
              <Terminal className="mx-auto h-7 w-7 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium text-foreground">
                No MCP tool executions recorded for this view yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click <span className="font-semibold text-foreground">Run Evaluation Workflow</span> above to watch the Supervisor plan tools and specialist agents execute stdio MCP calls step by step.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
              {groupedRuns.map((group, groupIdx) => {
                const isGroupExpanded =
                  expandedRuns[group.runId] !== undefined
                    ? expandedRuns[group.runId]
                    : groupIdx === 0;
                const isCurrentLive = effectiveRunId && group.runId === effectiveRunId;

                return (
                  <div
                    key={group.runId}
                    className={cn(
                      "rounded-lg border bg-background overflow-hidden",
                      group.hasPausedGate
                        ? "border-caution/60"
                        : isCurrentLive
                          ? "border-navy/30"
                          : "border-border",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleRun(group.runId)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 bg-muted/30 px-3.5 py-2.5 text-left hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {isGroupExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <Layers className="h-3.5 w-3.5 shrink-0 text-navy" />
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {group.runId === "assistant_direct" ? "Direct Assistant Call" : group.runId}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          · {group.tenderNumber}
                        </span>
                        {isCurrentLive && (
                          <span className="font-mono text-[10px] font-semibold text-navy">
                            · Latest Run
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground tabular-nums">
                        {group.sectorMode && (
                          <span>
                            {group.sectorMode === "corporate_rfp" ? "Corporate RFP" : "PPADA 2015"}
                          </span>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>
                          {group.traces.length} step{group.traces.length === 1 ? "" : "s"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{new Date(group.latestTs).toLocaleTimeString()}</span>
                      </div>
                    </button>

                    {isGroupExpanded && (
                      <div className="border-t border-border p-3 space-y-2.5">
                        {group.rationale && (
                          <div className="rounded-lg border border-navy/20 bg-navy-soft/30 px-3 py-2.5 text-xs">
                            <div className="flex items-center gap-1.5 font-semibold text-navy">
                              <Sparkles className="h-3.5 w-3.5 shrink-0" />
                              <span>Supervisor Dynamic Tool Rationale</span>
                            </div>
                            <p className="mt-1 leading-relaxed text-foreground/90">{group.rationale}</p>
                          </div>
                        )}

                        <div className="space-y-2">
                          {group.traces.map((item, traceIdx) => {
                            const isTraceExpanded = expandedTraceId === item.id;
                            const isCustom = item.server_id === MCP_SERVERS.CUSTOM.id;
                            const isPaused = item.status === "awaiting_approval";
                            const isRejected = item.status === "rejected_by_human";
                            const isGated =
                              item.context?.human_gate_required || isPaused || isRejected;
                            const stepNumber = String(item.context?.step_order || traceIdx + 1).padStart(2, "0");
                            const agentLabel = formatAgentLabel(item);
                            const bidderName = formatBidderName(item);
                            const reasonText = formatReason(item);

                            return (
                              <div
                                key={item.id}
                                className={cn(
                                  "rounded-lg border text-xs transition-colors",
                                  isPaused
                                    ? "border-caution bg-caution-soft/45"
                                    : isRejected
                                      ? "border-border bg-muted/40"
                                      : isGated
                                        ? "border-caution/40 bg-caution-soft/15"
                                        : "border-border bg-card",
                                )}
                              >
                                <div
                                  onClick={() =>
                                    setExpandedTraceId(isTraceExpanded ? null : item.id)
                                  }
                                  className="cursor-pointer p-3 hover:bg-muted/30 space-y-1.5"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                      {isTraceExpanded ? (
                                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                      ) : (
                                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                      )}
                                      <span className="font-mono text-[11px] font-semibold text-muted-foreground tabular-nums">
                                        Step {stepNumber}
                                      </span>
                                      <span aria-hidden="true" className="text-muted-foreground">·</span>
                                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                                        <UserCheck className="h-3 w-3 text-navy shrink-0" />
                                        {agentLabel}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-2.5 shrink-0 font-mono text-[11px] tabular-nums">
                                      <span className="hidden sm:inline-flex items-center gap-1 text-muted-foreground">
                                        <Clock className="h-3 w-3" />
                                        {new Date(item.timestamp).toLocaleTimeString()}
                                      </span>
                                      <span className="text-muted-foreground">
                                        {isPaused ? "paused" : `${item.duration_ms}ms`}
                                      </span>
                                      {isPaused ? (
                                        <span className="inline-flex items-center gap-1 rounded bg-caution px-1.5 py-0.5 text-[10px] font-bold text-white">
                                          <PauseCircle className="h-3 w-3" />
                                          AWAITING USER APPROVAL
                                        </span>
                                      ) : isRejected ? (
                                        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-foreground">
                                          <Ban className="h-3 w-3" />
                                          BLOCKED BY HUMAN
                                        </span>
                                      ) : (
                                        <span
                                          className={cn(
                                            "rounded px-1.5 py-0.5 text-[10px] font-bold",
                                            item.status === "success"
                                              ? "bg-compliance/15 text-compliance"
                                              : "bg-critical/15 text-critical",
                                          )}
                                        >
                                          {String(item.status || "success").toUpperCase()}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 font-mono text-[11px]">
                                    <span
                                      className={cn(
                                        "font-semibold",
                                        isPaused || isGated
                                          ? "text-caution"
                                          : isCustom
                                            ? "text-navy"
                                            : "text-purple-700",
                                      )}
                                    >
                                      {item.tool}
                                    </span>
                                    <span className="font-sans text-muted-foreground">
                                      · {isCustom ? "Custom Stdio MCP" : "Filesystem Stdio MCP"}
                                    </span>
                                    {bidderName && (
                                      <>
                                        <span aria-hidden="true" className="text-muted-foreground">·</span>
                                        <span className="font-sans font-medium text-foreground">
                                          Bidder: {bidderName}
                                        </span>
                                      </>
                                    )}
                                  </div>

                                  <p className="pl-5 text-xs leading-relaxed text-muted-foreground">
                                    {reasonText}
                                  </p>
                                </div>

                                {isTraceExpanded && (
                                  <div className="border-t border-border p-3 space-y-3 bg-muted/20 font-mono">
                                    {(isPaused || isGated) && (
                                      <div className="rounded border border-caution/40 bg-caution-soft p-2.5 text-xs text-caution">
                                        <div className="font-semibold flex items-center gap-1.5 font-sans">
                                          {isPaused ? (
                                            <PauseCircle className="h-3.5 w-3.5" />
                                          ) : (
                                            <Lock className="h-3.5 w-3.5" />
                                          )}
                                          {isPaused
                                            ? "PAUSED MID-EXECUTION — WAITING FOR OFFICER APPROVAL"
                                            : isRejected
                                              ? "EXECUTION BLOCKED BY SUPERVISING OFFICER"
                                              : "HUMAN-APPROVED GATED EXECUTION"}
                                        </div>
                                        <p className="mt-1 font-sans text-xs text-caution/90">
                                          {isPaused
                                            ? "Use the interactive prompt card in the Verification Console above to approve, downgrade, or block this MCP call."
                                            : item.human_approval_ms
                                              ? `Officer decision recorded after ${(item.human_approval_ms / 1000).toFixed(1)}s human review.`
                                              : "Consequential action verified under human oversight."}
                                        </p>
                                      </div>
                                    )}

                                    <div className="grid gap-3 md:grid-cols-2">
                                      <div>
                                        <div className="text-[11px] font-sans font-semibold text-muted-foreground mb-1">
                                          Inputs
                                        </div>
                                        <pre className="max-h-48 overflow-auto rounded bg-card p-2 text-[11px] border border-border">
                                          {JSON.stringify(item.inputs, null, 2)}
                                        </pre>
                                      </div>

                                      <div>
                                        <div className="text-[11px] font-sans font-semibold text-muted-foreground mb-1">
                                          Outputs
                                        </div>
                                        <pre className="max-h-48 overflow-auto rounded bg-card p-2 text-[11px] border border-border">
                                          {JSON.stringify(item.outputs, null, 2)}
                                        </pre>
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/50 text-[10px] text-muted-foreground">
                                      <div className="flex items-center gap-1.5">
                                        <Key className="h-3 w-3 text-navy" />
                                        <span>SHA-256:</span>
                                        <code className="bg-background px-1.5 py-0.5 rounded text-foreground font-mono">
                                          {item.sha256}
                                        </code>
                                      </div>
                                      <div className="flex items-center gap-1 font-sans">
                                        {isCustom ? (
                                          <ShieldCheck className="h-3 w-3 text-compliance" />
                                        ) : (
                                          <FolderGit2 className="h-3 w-3 text-purple-600" />
                                        )}
                                        <span>Stdio MCP Audit Logged</span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
