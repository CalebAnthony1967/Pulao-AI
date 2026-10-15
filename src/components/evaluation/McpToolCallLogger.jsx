import React, { useState, useEffect } from "react";
import {
  Terminal,
  ShieldCheck,
  Cpu,
  ChevronDown,
  ChevronRight,
  Clock,
  Key,
  FolderGit2,
  Lock,
} from "lucide-react";
import { getToolCallHistory, subscribeToToolCalls, MCP_SERVERS } from "@/lib/mcpClient.js";
import { Button } from "@/components/ui/button";

export default function McpToolCallLogger() {
  const [history, setHistory] = useState(getToolCallHistory());
  const [activeFilter, setActiveFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    return subscribeToToolCalls((_newCall, updatedHistory) => {
      setHistory(updatedHistory);
    });
  }, []);

  const filtered = history.filter((item) => {
    if (activeFilter === "custom") return item.server_id === MCP_SERVERS.CUSTOM.id;
    if (activeFilter === "borrowed") return item.server_id === MCP_SERVERS.BORROWED.id;
    if (activeFilter === "gated") return item.context?.human_gate_required;
    return true;
  });

  const customCalls = history.filter((i) => i.server_id === MCP_SERVERS.CUSTOM.id).length;
  const borrowedCalls = history.filter((i) => i.server_id === MCP_SERVERS.BORROWED.id).length;
  const gatedCalls = history.filter((i) => i.context?.human_gate_required).length;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-navy" />
            <h3 className="font-semibold text-foreground">Model Context Protocol (MCP) Tool Audit Log</h3>
            <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-semibold text-navy">
              Live Inspector
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Auditing all tool executions across Custom MCP (4 tools) and Borrowed MCP servers with cryptographic hashes.
          </p>
        </div>

        {/* Server Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-mono text-muted-foreground flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-navy" />
            <span>Custom: {customCalls} calls</span>
          </div>
          <div className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-mono text-muted-foreground flex items-center gap-1.5">
            <FolderGit2 className="h-3.5 w-3.5 text-purple-600" />
            <span>Borrowed: {borrowedCalls} calls</span>
          </div>
          <div className="rounded-md border border-caution/30 bg-caution-soft px-2.5 py-1 text-xs font-mono text-caution flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            <span>Gated: {gatedCalls}</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={activeFilter === "all" ? "default" : "outline"}
          onClick={() => setActiveFilter("all")}
          className={activeFilter === "all" ? "bg-navy text-white text-xs" : "text-xs"}
        >
          All Executions ({history.length})
        </Button>
        <Button
          size="sm"
          variant={activeFilter === "custom" ? "default" : "outline"}
          onClick={() => setActiveFilter("custom")}
          className={activeFilter === "custom" ? "bg-navy text-white text-xs" : "text-xs"}
        >
          Custom MCP: pulao-procurement-mcp ({customCalls})
        </Button>
        <Button
          size="sm"
          variant={activeFilter === "borrowed" ? "default" : "outline"}
          onClick={() => setActiveFilter("borrowed")}
          className={activeFilter === "borrowed" ? "bg-purple-700 text-white text-xs" : "text-xs"}
        >
          Borrowed MCP: @modelcontextprotocol/server-filesystem ({borrowedCalls})
        </Button>
        <Button
          size="sm"
          variant={activeFilter === "gated" ? "default" : "outline"}
          onClick={() => setActiveFilter("gated")}
          className={activeFilter === "gated" ? "bg-caution text-white text-xs" : "text-xs"}
        >
          Irreversible Action Gates ({gatedCalls})
        </Button>
      </div>

      {/* Tool Call Feed */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background/50 p-6 text-center">
          <Terminal className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-medium text-foreground">No tool calls recorded in this view yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Lodge a bid or click "Run LangGraph Multi-Step Audit" to trigger MCP tool execution.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
          {filtered.map((item) => {
            const isExpanded = expandedId === item.id;
            const isCustom = item.server_id === MCP_SERVERS.CUSTOM.id;
            const isGated = item.context?.human_gate_required;

            return (
              <div
                key={item.id}
                className={`rounded-lg border transition-all text-xs font-mono ${
                  isGated
                    ? "border-caution/40 bg-caution-soft/20"
                    : isCustom
                    ? "border-navy/20 bg-background"
                    : "border-purple-200 bg-purple-50/20"
                }`}
              >
                {/* Header row */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="flex cursor-pointer items-center justify-between gap-2 p-3 hover:bg-muted/40"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={`font-semibold ${
                        isGated ? "text-caution" : isCustom ? "text-navy" : "text-purple-700"
                      }`}
                    >
                      {item.tool}
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {isCustom ? "pulao-procurement-mcp" : "official-filesystem-mcp"}
                    </span>
                    {isGated && (
                      <span className="flex items-center gap-1 rounded bg-caution text-white px-1.5 py-0.5 text-[10px] font-bold">
                        <Lock className="h-2.5 w-2.5" />
                        GATED IRREVERSIBLE
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-muted-foreground text-[11px]">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="hidden sm:inline">({item.duration_ms}ms)</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        item.status === "success"
                          ? "bg-compliance/15 text-compliance"
                          : "bg-critical/15 text-critical"
                      }`}
                    >
                      {item.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-border p-3 space-y-3 bg-muted/20">
                    {isGated && (
                      <div className="rounded border border-caution/40 bg-caution-soft p-2.5 text-xs text-caution">
                        <div className="font-semibold flex items-center gap-1.5">
                          <Lock className="h-3.5 w-3.5" />
                          HUMAN-IN-THE-LOOP SAFETY GATE ENFORCED
                        </div>
                        <p className="mt-1 font-sans text-xs text-caution/90">
                          This tool call generated an enforceable statutory disqualification notice. Under Kenya PPADA 2015 s.79,
                          it is gated and cannot be enacted until signed off by the named Evaluation Committee Chairperson.
                        </p>
                      </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-2">
                      {/* Inputs */}
                      <div>
                        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                          Inputs
                        </div>
                        <pre className="max-h-48 overflow-auto rounded bg-card p-2 text-[11px] border border-border">
                          {JSON.stringify(item.inputs, null, 2)}
                        </pre>
                      </div>

                      {/* Outputs */}
                      <div>
                        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                          Outputs
                        </div>
                        <pre className="max-h-48 overflow-auto rounded bg-card p-2 text-[11px] border border-border">
                          {JSON.stringify(item.outputs, null, 2)}
                        </pre>
                      </div>
                    </div>

                    {/* Metadata & Digest */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/50 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Key className="h-3 w-3 text-navy" />
                        <span>SHA-256 Digest:</span>
                        <code className="bg-background px-1.5 py-0.5 rounded text-foreground font-mono">
                          {item.sha256}
                        </code>
                      </div>
                      <div className="flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3 text-compliance" />
                        <span>Tamper-evident audit logged</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
