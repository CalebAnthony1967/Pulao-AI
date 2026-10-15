import React, { useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Play,
  Sparkles,
  Shield,
  Layers,
} from "lucide-react";
import { runLangGraphPipeline } from "@/lib/langgraphOrchestrator.js";
import { executeMcpTool } from "@/lib/mcpClient.js";
import { AVAILABLE_MODELS } from "@/lib/sovereignAgent.js";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const LANGGRAPH_NODES = [
  { id: "read_packets", label: "Read Packets", desc: "OCR Checksums" },
  { id: "statutory_auditor", label: "Statutory Auditor", desc: "Custom MCP" },
  { id: "pricing_benchmark", label: "Pricing Benchmark", desc: "Custom MCP" },
  { id: "collusion_detector", label: "Collusion Detector", desc: "Cross-Correlation" },
  { id: "disqualification_drafter", label: "Disqualifications", desc: "Mutating MCP" },
  { id: "human_gate_checkpoint", label: "Human Gate", desc: "Irreversible Gate" },
  { id: "report_compiler", label: "Report Compiler", desc: "Mutating MCP" },
  { id: "audit_vault_commit", label: "Vault Commit", desc: "SHA-256 Chaining" },
];

export default function AuditRunner({ tender, bids, priceIndex, onComplete }) {
  const [running, setRunning] = useState(false);
  const [selectedModel, setSelectedModel] = useState("sovereign-llama-3.3");
  const [activeNode, setActiveNode] = useState(null);
  const [completedNodes, setCompletedNodes] = useState([]);
  const [log, setLog] = useState([]);
  const [current, setCurrent] = useState("");
  const [error, setError] = useState(null);
  const [finished, setFinished] = useState(false);

  const activeModelMeta = AVAILABLE_MODELS.find((m) => m.id === selectedModel) || AVAILABLE_MODELS[0];

  const run = async () => {
    setRunning(true);
    setError(null);
    setFinished(false);
    setLog([]);
    setCompletedNodes([]);
    setActiveNode("read_packets");

    try {
      // First invoke Borrowed MCP server tool to verify sandboxed dossier
      await executeMcpTool("read_tender_dossier", { path: `/tenders/${tender.tender_number}/dossier.json` }, {
        reason: "Pre-audit sandboxed dossier integrity verification",
      });

      // Run full LangGraph State Graph
      const result = await runLangGraphPipeline({
        tender,
        bids,
        priceIndex,
        modelEngine: selectedModel,
        onProgress: (label) => {
          setCurrent(label);
          setLog((previous) => [...previous, label]);

          // Match node
          if (label.includes("packet")) {
            setActiveNode("read_packets");
            setCompletedNodes((prev) => Array.from(new Set([...prev])));
          } else if (label.includes("statutory") || label.includes("register")) {
            setActiveNode("statutory_auditor");
            setCompletedNodes((prev) => Array.from(new Set([...prev, "read_packets"])));
          } else if (label.includes("pricing") || label.includes("market")) {
            setActiveNode("pricing_benchmark");
            setCompletedNodes((prev) => Array.from(new Set([...prev, "read_packets", "statutory_auditor"])));
          } else if (label.includes("collusion")) {
            setActiveNode("collusion_detector");
            setCompletedNodes((prev) => Array.from(new Set([...prev, "read_packets", "statutory_auditor", "pricing_benchmark"])));
          } else if (label.includes("disqualification")) {
            setActiveNode("disqualification_drafter");
            setCompletedNodes((prev) => Array.from(new Set([...prev, "read_packets", "statutory_auditor", "pricing_benchmark", "collusion_detector"])));
          } else if (label.includes("gate") || label.includes("checkpoint")) {
            setActiveNode("human_gate_checkpoint");
            setCompletedNodes((prev) => Array.from(new Set([...prev, "read_packets", "statutory_auditor", "pricing_benchmark", "collusion_detector", "disqualification_drafter"])));
          } else if (label.includes("report")) {
            setActiveNode("report_compiler");
            setCompletedNodes((prev) => Array.from(new Set([...prev, "read_packets", "statutory_auditor", "pricing_benchmark", "collusion_detector", "disqualification_drafter", "human_gate_checkpoint"])));
          } else if (label.includes("vault") || label.includes("commit")) {
            setActiveNode("audit_vault_commit");
            setCompletedNodes((prev) => Array.from(new Set([...prev, "read_packets", "statutory_auditor", "pricing_benchmark", "collusion_detector", "disqualification_drafter", "human_gate_checkpoint", "report_compiler"])));
          }
        },
      });

      setCompletedNodes(LANGGRAPH_NODES.map((n) => n.id));
      setActiveNode(null);
      setFinished(true);
      setCurrent("");
      if (onComplete) onComplete(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
      {/* Top Bar: Title & Model Selector */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-navy" />
            <h3 className="font-semibold text-foreground">LangGraph Multi-Step Procurement Pipeline</h3>
            <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-semibold text-navy">
              Open-Source Orchestration
            </span>
          </div>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
            Directed StateGraph with 8 nodes, Custom & Borrowed MCP tools, sovereign open-weights execution, and human gate handoff.
          </p>
        </div>

        <div className="flex flex-col sm:items-end gap-2">
          {/* Model Toggle */}
          <div className="flex items-center rounded-lg border border-border bg-background p-1 text-xs">
            {AVAILABLE_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedModel(m.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium transition-all",
                  selectedModel === m.id
                    ? "bg-navy text-white shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m.name.split("(")[0]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
            <Shield className={cn("h-3.5 w-3.5", selectedModel === "sovereign-llama-3.3" ? "text-compliance" : "text-amber-500")} />
            <span>{activeModelMeta.residency}</span>
          </div>
        </div>
      </div>

      {/* LangGraph Node Visualizer DAG */}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
          <span>LangGraph State Machine (8 Nodes)</span>
          <span className="font-mono text-[10px] text-navy">@langchain/langgraph</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {LANGGRAPH_NODES.map((node, idx) => {
            const isCompleted = completedNodes.includes(node.id);
            const isActive = activeNode === node.id;

            return (
              <div
                key={node.id}
                className={cn(
                  "rounded-md border p-2 text-center transition-all",
                  isActive
                    ? "border-navy bg-navy/10 shadow-xs ring-1 ring-navy animate-pulse"
                    : isCompleted
                    ? "border-compliance/40 bg-compliance-soft/40"
                    : "border-border bg-background/60 opacity-70"
                )}
              >
                <div className="flex items-center justify-center gap-1 mb-1">
                  <span className="text-[10px] font-mono text-muted-foreground">{idx + 1}.</span>
                  {isCompleted ? (
                    <CheckCircle2 className="h-3 w-3 text-compliance" />
                  ) : isActive ? (
                    <Loader2 className="h-3 w-3 animate-spin text-navy" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-border" />
                  )}
                </div>
                <div className="text-[11px] font-semibold text-foreground leading-tight truncate">
                  {node.label}
                </div>
                <div className="text-[9px] text-muted-foreground truncate">{node.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Trigger */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-xs text-muted-foreground font-mono">
          Ready to audit {bids.length} bid(s) against statutory registers & market benchmarks.
        </p>

        <Button
          onClick={run}
          disabled={running || !bids.length}
          className="bg-navy text-white hover:bg-navy/90 text-xs py-2 px-4"
        >
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {running ? "Executing LangGraph DAG..." : "Execute LangGraph Multi-Step Audit"}
        </Button>
      </div>

      {/* Live Progress Logs */}
      {(running || log.length > 0) && (
        <div className="space-y-2 pt-2">
          <Progress value={Math.min(100, (completedNodes.length / LANGGRAPH_NODES.length) * 100)} className="h-1.5" />
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
            {log.map((line, index) => (
              <p
                key={index}
                className={cn(
                  "flex items-center gap-2",
                  index === log.length - 1 && running ? "text-navy font-semibold" : "text-muted-foreground"
                )}
              >
                {index === log.length - 1 && running ? (
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 text-compliance shrink-0" />
                )}
                <span>{line}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-critical/30 bg-critical-soft p-3 text-xs text-critical">
          {error}
        </div>
      )}

      {finished && !error && (
        <div className="flex items-center gap-2 rounded-lg border border-compliance/30 bg-compliance-soft p-3 text-xs text-compliance">
          <Sparkles className="h-4 w-4 shrink-0" />
          <span>
            LangGraph pipeline finished. All Custom & Borrowed MCP tool executions logged in the inspector below.
          </span>
        </div>
      )}
    </div>
  );
}
