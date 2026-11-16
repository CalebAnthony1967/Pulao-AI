import React, { useEffect, useState } from "react";
import { CheckCircle2, Coins, Cpu, Loader2, Play, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/common/StatusBadge";

export default function ObservabilityEvalPanel() {
  const [runs, setRuns] = useState([]);
  const [evalReport, setEvalReport] = useState(null);
  const [runningEvals, setRunningEvals] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [runsRes, evalRes] = await Promise.all([
        fetch("/api/observability/runs").then((r) => (r.ok ? r.json() : { runs: [] })),
        fetch("/api/evals/latest").then((r) => (r.ok ? r.json() : null)),
      ]);
      setRuns(runsRes.runs || []);
      setEvalReport(evalRes);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const triggerEvals = async () => {
    setRunningEvals(true);
    try {
      const res = await fetch("/api/evals/run", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        setEvalReport(json);
        loadData();
      }
    } finally {
      setRunningEvals(false);
    }
  };

  const summary = evalReport?.summary;

  return (
    <div className="space-y-6">
      {/* Multi-Trial Reliability & Invariant Benchmark */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-compliance" />
              <h3 className="font-semibold text-foreground">Multi-Trial Reliability &amp; Invariant Benchmark</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Evaluates 16 uncurated Kenyan &amp; Corporate RFP scenarios across 3 trials each (48 total runs), measuring consistency, latency, cost, and zero-unsourced-flag compliance.
            </p>
          </div>
          <Button
            onClick={triggerEvals}
            disabled={runningEvals}
            size="sm"
            className="bg-navy text-white hover:bg-navy/90 whitespace-nowrap"
          >
            {runningEvals ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
            {runningEvals ? "Running 48-Run Suite..." : "Run Reliability Eval Suite"}
          </Button>
        </div>

        {loading && !summary ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading evaluation benchmark results...
          </div>
        ) : summary ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pass Rate</p>
                <p className="mt-1 font-mono text-xl font-semibold text-compliance tabular-nums">{summary.pass_rate_pct}%</p>
                <p className="text-[11px] text-muted-foreground">
                  {summary.passed_runs}/{summary.total_runs} runs
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Consistency</p>
                <p className="mt-1 font-mono text-xl font-semibold text-navy tabular-nums">{summary.run_to_run_consistency_pct}%</p>
                <p className="text-[11px] text-muted-foreground">{summary.trials_per_scenario} trials/case</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Citation Breaches</p>
                <p className="mt-1 font-mono text-xl font-semibold text-compliance tabular-nums">{summary.citation_violations}</p>
                <p className="text-[11px] text-muted-foreground">Unsourced flags</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Auto-Awards</p>
                <p className="mt-1 font-mono text-xl font-semibold text-compliance tabular-nums">{summary.autonomous_award_violations}</p>
                <p className="text-[11px] text-muted-foreground">Gate locked</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Latency p50 / p95</p>
                <p className="mt-1 font-mono text-lg font-semibold text-foreground tabular-nums">
                  {summary.p50_latency_ms} / {summary.p95_latency_ms}ms
                </p>
                <p className="text-[11px] text-muted-foreground">End-to-end graph</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Avg Cost / Run</p>
                <p className="mt-1 font-mono text-lg font-semibold text-foreground tabular-nums">${summary.avg_cost_usd_per_run}</p>
                <p className="text-[11px] text-muted-foreground">KES {(summary.avg_cost_usd_per_run * 129).toFixed(3)}</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border bg-navy-soft text-left text-navy">
                    <th className="px-3 py-2 font-semibold">Scenario</th>
                    <th className="px-3 py-2 font-semibold">Mode</th>
                    <th className="px-3 py-2 font-semibold">Observed Status</th>
                    <th className="px-3 py-2 font-semibold">Trials Passed</th>
                    <th className="px-3 py-2 font-semibold">Avg Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(evalReport.scenarios || []).map((sc) => (
                    <tr key={sc.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium text-foreground">{sc.name}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{sc.sector_mode}</td>
                      <td className="px-3 py-2">
                        <StatusBadge
                          tone={
                            sc.observed_status === "critical"
                              ? "critical"
                              : sc.observed_status === "warning"
                                ? "caution"
                                : "compliance"
                          }
                        >
                          {sc.observed_status}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          {sc.passes === sc.trials_run ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-compliance" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-critical" />
                          )}
                          {sc.passes}/{sc.trials_run}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground tabular-nums">{sc.avg_latency_ms}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No evaluation report recorded yet. Click Run Reliability Eval Suite to execute the 48-run benchmark.</p>
        )}
      </div>

      {/* Operational Token & Compute Ledger */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-navy" />
            <div>
              <h3 className="font-semibold text-foreground">Operational Token &amp; Compute Ledger</h3>
              <p className="text-xs text-muted-foreground">
                Detailed telemetry tracking per-run model execution latency, backend engine routing, token consumption, and KES cost efficiency.
              </p>
            </div>
          </div>
          <StatusBadge tone="navy">{runs.length} recorded run(s)</StatusBadge>
        </div>

        {runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Run an audit workflow in the Evaluation Room to populate live compute ledger entries.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-navy-soft text-left text-navy">
                  <th className="px-3 py-2 font-semibold">Run / Tender</th>
                  <th className="px-3 py-2 font-semibold">Governance &amp; Lang</th>
                  <th className="px-3 py-2 font-semibold">HITL Interrupts</th>
                  <th className="px-3 py-2 font-semibold">Execution Engine</th>
                  <th className="px-3 py-2 font-semibold">Token Breakdown &amp; Cost</th>
                  <th className="px-3 py-2 font-semibold">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.slice(0, 15).map((r) => (
                  <tr key={r.run_id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <p className="font-mono text-[11px] font-semibold text-foreground">{r.tender_number}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{r.run_id}</p>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {r.sector_mode} · {String(r.language_resolved || "en").toUpperCase()}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] tabular-nums">
                      {r.interrupt_count || 0} gate(s) · {r.human_decision || "none"}
                      {r.human_wait_ms ? ` (${(r.human_wait_ms / 1000).toFixed(1)}s)` : ""}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground truncate max-w-[200px]">{r.execution_backend}</td>
                    <td className="px-3 py-2 font-mono text-[11px] tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Coins className="h-3 w-3 text-compliance" />
                        {(r.prompt_tokens || 0) + (r.completion_tokens || 0) + (r.thinking_tokens || 0)} tok · $
                        {Number(r.estimated_cost_usd || 0).toFixed(5)} (KES {Number(r.estimated_cost_kes || 0).toFixed(2)})
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground tabular-nums">{r.latency_ms}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
