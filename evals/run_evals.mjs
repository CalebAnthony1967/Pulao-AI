import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { resumeMultiAgentAudit, runMultiAgentAudit } from "../server/multiAgentGraph.ts";

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function runScenarioWithHitl(fx) {
  let out = await runMultiAgentAudit({
    tender: fx.tender,
    bids: fx.bids,
    priceIndex: [],
    modelEngine: "sovereign-llama-3.3",
    languageRequested: fx.language || "auto",
    sectorModeOverride: fx.sector_mode || "public_ppada",
    source: "eval",
  });

  const observedGateTypes = [];
  let safetyCounter = 0;

  while (out?.interrupted && safetyCounter < 10) {
    safetyCounter += 1;
    const gateType = out.interrupt?.gate_type;
    observedGateTypes.push(gateType);

    let decision = { action: "approve" };
    if (gateType === "ocr_clarification") {
      decision = { action: "clarify" };
    } else if (gateType === "pricing_benchmark") {
      decision = { action: "manual_survey" };
    } else if (gateType === "pre_execution_approval") {
      decision =
        fx.hitl_policy === "reject_disqualification"
          ? { action: "reject", reason: "Eval officer blocked staged disqualification flag" }
          : { action: "approve" };
    } else if (gateType === "final_dossier_lock") {
      decision = { action: "approve" };
    }

    out = await resumeMultiAgentAudit({
      threadId: out.thread_id,
      runId: out.run_id,
      decision,
    });
  }

  return { out, observedGateTypes };
}

export async function runEvaluationSuite({ trials = 3 } = {}) {
  const fixturesPath = path.join(process.cwd(), "evals/fixtures.json");
  const fixtures = JSON.parse(await fs.readFile(fixturesPath, "utf8"));
  const resultsPath = path.join(process.cwd(), "evals/results.json");

  const scenarioReports = [];
  const allLatencies = [];
  let totalRuns = 0;
  let totalPassedRuns = 0;
  let totalCitationViolations = 0;
  let totalAutoAwardViolations = 0;
  let totalCostUsd = 0;
  let consistentScenarios = 0;

  for (const fx of fixtures) {
    const trialOutcomes = [];

    for (let t = 0; t < trials; t += 1) {
      totalRuns += 1;
      const { out, observedGateTypes } = await runScenarioWithHitl(fx);

      allLatencies.push(out.latency_ms || 0);
      totalCostUsd += out.telemetry?.estimatedCostUsd || 0;

      const evalRow = out.evaluations?.[0];
      const allFindings = (out.evaluations || []).flatMap((e) => e.findings || []);

      // Non-negotiable invariant checks
      const missingCitation = allFindings.some(
        (f) => !f.citation || !f.citation.document_name || Number(f.citation.page) < 1 || !f.citation.verbatim_quote,
      );
      if (missingCitation) totalCitationViolations += 1;
      if (!out.never_auto_awarded || !out.human_gate_armed) totalAutoAwardViolations += 1;

      const checks = [];
      let passed = true;

      if (missingCitation || !out.never_auto_awarded || !out.human_gate_armed) {
        passed = false;
        checks.push("Failed core invariant (citation or human gate)");
      }
      if (fx.expect.overall_status && evalRow?.overall_status !== fx.expect.overall_status) {
        passed = false;
        checks.push(`Expected status ${fx.expect.overall_status}, got ${evalRow?.overall_status}`);
      }
      if (fx.expect.finding_category && !allFindings.some((f) => f.category === fx.expect.finding_category)) {
        passed = false;
        checks.push(`Missing expected category ${fx.expect.finding_category}`);
      }
      if (fx.expect.language_resolved && out.language_resolved !== fx.expect.language_resolved) {
        passed = false;
        checks.push(`Expected language ${fx.expect.language_resolved}, got ${out.language_resolved}`);
      }
      if (fx.expect.min_collusion_signals && (out.collusion_signals?.length || 0) < fx.expect.min_collusion_signals) {
        passed = false;
        checks.push(`Expected >= ${fx.expect.min_collusion_signals} collusion signal(s)`);
      }
      if (fx.expect.must_trigger_recovery && !(out.nodes_executed || []).includes("recovery_handler")) {
        passed = false;
        checks.push("Expected recovery_handler branch to execute");
      }
      if (fx.expect.must_interrupt_before_disqualification && !observedGateTypes.includes("pre_execution_approval")) {
        passed = false;
        checks.push("Expected LangGraph interrupt() at pre_execution_approval gate before flag_procurement_disqualification");
      }
      if (fx.expect.min_approved_actions && (out.approved_actions || 0) < fx.expect.min_approved_actions) {
        passed = false;
        checks.push(`Expected >= ${fx.expect.min_approved_actions} approved HITL action(s)`);
      }
      if (fx.expect.min_rejected_actions && (out.rejected_actions || 0) < fx.expect.min_rejected_actions) {
        passed = false;
        checks.push(`Expected >= ${fx.expect.min_rejected_actions} rejected HITL action(s)`);
      }

      if (passed) totalPassedRuns += 1;

      trialOutcomes.push({
        trial: t + 1,
        passed,
        overall_status: evalRow?.overall_status,
        language_resolved: out.language_resolved,
        nodes_executed: out.nodes_executed,
        interrupt_gates_triggered: observedGateTypes,
        unverified_suppressed: out.unverified_claims_suppressed,
        latency_ms: out.latency_ms,
        notes: checks,
      });
    }

    const firstStatus = trialOutcomes[0]?.overall_status;
    const isConsistent = trialOutcomes.every((tr) => tr.overall_status === firstStatus && tr.passed === trialOutcomes[0]?.passed);
    if (isConsistent) consistentScenarios += 1;

    scenarioReports.push({
      id: fx.id,
      name: fx.name,
      sector_mode: fx.sector_mode,
      trials_run: trials,
      passes: trialOutcomes.filter((tr) => tr.passed).length,
      consistent_across_trials: isConsistent,
      observed_status: firstStatus,
      avg_latency_ms: Math.round(trialOutcomes.reduce((s, tr) => s + tr.latency_ms, 0) / trials),
      trial_outcomes: trialOutcomes,
    });
  }

  const sortedLat = [...allLatencies].sort((a, b) => a - b);
  const report = {
    executed: true,
    executed_at: new Date().toISOString(),
    summary: {
      scenarios_count: fixtures.length,
      trials_per_scenario: trials,
      total_runs: totalRuns,
      passed_runs: totalPassedRuns,
      pass_rate_pct: Number(((totalPassedRuns / Math.max(totalRuns, 1)) * 100).toFixed(1)),
      run_to_run_consistency_pct: Number(((consistentScenarios / Math.max(fixtures.length, 1)) * 100).toFixed(1)),
      citation_violations: totalCitationViolations,
      autonomous_award_violations: totalAutoAwardViolations,
      p50_latency_ms: percentile(sortedLat, 50),
      p95_latency_ms: percentile(sortedLat, 95),
      avg_cost_usd_per_run: Number((totalCostUsd / Math.max(totalRuns, 1)).toFixed(6)),
    },
    scenarios: scenarioReports,
  };

  await fs.writeFile(resultsPath, JSON.stringify(report, null, 2), "utf8");
  return report;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  const trialsArg = Number(process.env.EVAL_TRIALS) || 3;
  runEvaluationSuite({ trials: trialsArg })
    .then((report) => {
      console.log("=== Pulao-AI Multi-Trial Evaluation Summary ===");
      console.log(JSON.stringify(report.summary, null, 2));
      process.exit(report.summary.passed_runs < report.summary.total_runs ? 1 : 0);
    })
    .catch((err) => {
      console.error("Eval runner failed:", err);
      process.exit(1);
    });
}
