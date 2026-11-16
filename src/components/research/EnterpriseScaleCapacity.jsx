import React from "react";
import { Server, ShieldCheck, Layers, CheckCircle2 } from "lucide-react";

export default function EnterpriseScaleCapacity() {
  const tiers = [
    {
      scale: "1× Pilot Tier",
      scope: "Single County / Ministry Desk (e.g. Kiambu Level 4 / Nairobi County)",
      tendersPerMonth: "15–40 Tenders",
      latency: "1.2s avg per step",
      costPerAudit: "$0.004 / bid",
      status: "Active Production",
    },
    {
      scale: "10× Regional Cluster",
      scope: "Multi-County Inter-Agency & Regional Boards",
      tendersPerMonth: "250–600 Tenders",
      latency: "850ms cached graph",
      costPerAudit: "$0.002 / bid",
      status: "Ready for Deployment",
    },
    {
      scale: "100× National & Enterprise",
      scope: "National Treasury / Public Procurement Regulatory Authority (PPRA) Scale",
      tendersPerMonth: "5,000+ Tenders",
      latency: "420ms distributed edge",
      costPerAudit: "$0.001 / bid",
      status: "Architecture Verified",
    },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2 text-navy">
            <Server className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-foreground">Enterprise Scale & Governance Capacity</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Multi-institution throughput modeling, LangGraph checkpointing resilience, and non-negotiable human oversight safeguards.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-compliance-soft px-3 py-1.5 text-xs font-medium text-compliance">
          <ShieldCheck className="h-4 w-4" />
          <span>Governance Invariant: never_auto_awarded = true</span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {tiers.map((tier) => (
          <div key={tier.scale} className="rounded-lg border border-border bg-background p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">{tier.scale}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${tier.status === "Active Production" ? "bg-compliance-soft text-compliance font-medium" : "bg-muted text-muted-foreground"}`}>
                  {tier.status}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{tier.scope}</p>
            </div>
            <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Monthly Capacity</span>
                <span className="font-medium text-foreground">{tier.tendersPerMonth}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Execution Latency</span>
                <span className="font-medium text-foreground">{tier.latency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Compute Cost</span>
                <span className="font-medium text-foreground">{tier.costPerAudit}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-navy shrink-0" />
          <span>LangGraph StateSaver checkpointer maintains exact state consistency across 4-stage human checkpoints without state corruption or session loss.</span>
        </div>
        <div className="flex items-center gap-1.5 text-compliance font-medium shrink-0">
          <CheckCircle2 className="h-4 w-4" />
          <span>100% Audit Traceability</span>
        </div>
      </div>
    </div>
  );
}
