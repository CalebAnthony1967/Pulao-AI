import React, { useState } from "react";
import { Calculator, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ProcurementRoiCalculator({ bidsCount = 3 }) {
  const [tendersPerYear, setTendersPerYear] = useState(24);
  const [bidsPerTender, setBidsPerTender] = useState(bidsCount || 4);

  // Economic Baseline Calculations
  // Manual baseline: ~3.5 hours per bid review across 3 committee members = ~10.5 officer hours per bid @ KES 1,000/hr = KES 10,500 per bid.
  // Pulao-AI Agentic Audit: ~1.2s stdio MCP execution + 15 min officer review = KES 450 in compute + officer time.
  const manualHoursPerBid = 10.5;
  const officerHourlyRateKes = 1200;
  const manualCostPerTender = bidsPerTender * manualHoursPerBid * officerHourlyRateKes; // e.g. 4 * 10.5 * 1200 = KES 50,400

  const agentComputeCostPerTender = 350; // KES compute + token cost
  const agentReviewHoursPerBid = 0.5; // 30 min committee confirmation at gate
  const agentCostPerTender = (bidsPerTender * agentReviewHoursPerBid * officerHourlyRateKes) + agentComputeCostPerTender;

  const savingsPerTender = manualCostPerTender - agentCostPerTender;
  const annualSavingsKes = savingsPerTender * tendersPerYear;
  const savingsPct = Math.round((savingsPerTender / manualCostPerTender) * 100);

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <Calculator className="h-5 w-5 text-navy" />
        <div>
          <h3 className="font-semibold text-foreground">Procurement ROI &amp; Efficiency Calculator</h3>
          <p className="text-xs text-muted-foreground">
            Evaluating institutional time savings, officer cost reduction, and compliance overhead comparison.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tenders_input" className="text-xs font-medium text-foreground">
            Tenders Evaluated per Year: <span className="font-mono text-navy font-bold">{tendersPerYear}</span>
          </Label>
          <Input
            id="tenders_input"
            type="number"
            min={1}
            max={500}
            value={tendersPerYear}
            onChange={(e) => setTendersPerYear(Math.max(1, Number(e.target.value) || 1))}
            className="h-8 text-xs font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bids_input" className="text-xs font-medium text-foreground">
            Average Bids per Tender: <span className="font-mono text-navy font-bold">{bidsPerTender}</span>
          </Label>
          <Input
            id="bids_input"
            type="number"
            min={1}
            max={50}
            value={bidsPerTender}
            onChange={(e) => setBidsPerTender(Math.max(1, Number(e.target.value) || 1))}
            className="h-8 text-xs font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Manual Baseline</p>
          <p className="mt-1 font-mono text-lg font-semibold text-critical tabular-nums">
            KES {Math.round(manualCostPerTender).toLocaleString()}
          </p>
          <p className="text-[11px] text-muted-foreground">Per tender review ({bidsPerTender * 10.5} hrs)</p>
        </div>

        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pulao-AI Agentic Audit</p>
          <p className="mt-1 font-mono text-lg font-semibold text-compliance tabular-nums">
            KES {Math.round(agentCostPerTender).toLocaleString()}
          </p>
          <p className="text-[11px] text-muted-foreground">Compute + Gate review</p>
        </div>

        <div className="rounded-lg border border-compliance/40 bg-compliance-soft/50 p-3">
          <p className="text-[11px] uppercase tracking-wide text-compliance font-semibold">Net Institutional Savings</p>
          <p className="mt-1 font-mono text-lg font-semibold text-compliance tabular-nums">
            {savingsPct}% ({Math.round(annualSavingsKes / 1_000_000).toFixed(1)}M KES/yr)
          </p>
          <p className="text-[11px] text-compliance/90">Based on {tendersPerYear} tenders/yr</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground border-t border-border pt-3">
        <CheckCircle2 className="h-4 w-4 text-compliance shrink-0" />
        <span>
          Eliminates manual KRA/BRS verification bottlenecks while upholding strict human committee review via native interrupt gates.
        </span>
      </div>
    </div>
  );
}
