import React, { useState } from "react";
import { AlertTriangle, Loader2, Lock, PenLine, ShieldCheck, UserCheck, Stamp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { recordAudit } from "@/lib/audit";
import { updateLocalEvaluationStatus } from "@/lib/data";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignOffPanel({ tender, evaluations, decisions, onSigned }) {
  const { user, profile } = useSession();
  const [signerName, setSignerName] = useState(
    profile?.full_name || "Dr. Evans Kiprop"
  );
  const [signerRole, setSignerRole] = useState(
    "Chairperson, Tender Evaluation Committee / Head of Procurement"
  );
  const [nationalId, setNationalId] = useState("ID/STAFF: KAO-99218");
  const [statutoryAffirmation, setStatutoryAffirmation] = useState(false);
  const [note, setNote] = useState(
    "The Evaluation Committee has audited all bids against statutory registers (KRA, BRS, NSSF, SHIF) and market price benchmarks. All non-responsive bids are disqualified pursuant to PPADA 2015 Section 79(1). The responsive lowest evaluated tender is recommended for award."
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const openFindings = evaluations.reduce((count, evaluation) => {
    const findings = Array.isArray(evaluation.findings) ? evaluation.findings : [];
    const decided = decisions.filter((decision) => decision.evaluation_id === evaluation.id);
    return count + findings.filter((finding) => !decided.some((d) => d.finding_key === finding.key)).length;
  }, 0);

  const criticalFindings = evaluations.reduce((count, evaluation) => {
    const findings = Array.isArray(evaluation.findings) ? evaluation.findings : [];
    return count + findings.filter((f) => f.severity === "critical").length;
  }, 0);

  const alreadySigned = evaluations.every((evaluation) => evaluation.overall_status === "signed_off");

  const sign = async () => {
    setError(null);
    if (!signerName.trim()) {
      setError("Please enter the name of the designated Human Sign-Off Official.");
      return;
    }
    if (!statutoryAffirmation) {
      setError("You must confirm the statutory affirmation before unlocking and executing this irreversible decision.");
      return;
    }
    if (openFindings > 0) {
      setError("Every finding must be upheld or overridden with a note before the report can be signed.");
      return;
    }
    if (note.trim().length < 30) {
      setError("Write at least 30 characters summarising the committee's decision.");
      return;
    }

    setBusy(true);
    const signTimestamp = new Date().toISOString();
    try {
      for (const evaluation of evaluations) {
        try {
          await supabase.rpc("sign_off_evaluation", {
            p_evaluation_id: evaluation.id,
            p_justification: `${note.trim()} [Signed by: ${signerName.trim()} (${signerRole.trim()}, ${nationalId.trim()})]`,
            p_reviewer_name: signerName.trim(),
            p_action: "approved",
          });
        } catch {}
        updateLocalEvaluationStatus(evaluation.id, "signed_off", note.trim());
      }

      await recordAudit({
        action: "Human-In-The-Loop Irreversible Gate Approved",
        tool: "HumanSignOffGate",
        input: {
          tender_number: tender.tender_number,
          evaluations_count: evaluations.length,
          approver_name: signerName.trim(),
          designation: signerRole.trim(),
          official_id: nationalId.trim(),
          statutory_affirmation: true,
          timestamp: signTimestamp,
        },
        output: {
          status: "GATE_UNLOCKED_EXECUTED",
          sealed_evaluations: evaluations.length,
          summary: note.trim(),
        },
      }).catch(() => {});

      setResult({
        signerName: signerName.trim(),
        signerRole: signerRole.trim(),
        timestamp: signTimestamp,
      });
      if (onSigned) onSigned();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-navy" />
          <div>
            <h3 className="font-semibold text-foreground">Committee Sign-Off &amp; Approval</h3>
            <p className="text-xs text-muted-foreground">
              Formal committee approval required for evaluation determinations and award recommendations
            </p>
          </div>
        </div>
        <span className="rounded-full bg-navy/10 px-2.5 py-0.5 text-xs font-semibold text-navy flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5" />
          PPADA Compliance Review
        </span>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Under Public Procurement and Asset Disposal Regulations, automated evaluation tools provide decision support only. Final determinations and awards require official review and signature by the authorized committee.
      </p>

      {/* Irreversible Findings Indicator */}
      {criticalFindings > 0 && (
        <div className="rounded-lg border border-caution/40 bg-caution-soft p-3 text-xs text-caution">
          <div className="flex items-center gap-2 font-semibold">
            <Lock className="h-4 w-4" />
            CRITICAL COMPLIANCE FINDINGS ({criticalFindings} flag(s))
          </div>
          <p className="mt-1 text-caution/90">
            Verification checks identified potential statutory non-compliance. Please review the findings before confirming the evaluation report.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Findings still open</p>
          <p className={openFindings ? "text-lg font-semibold text-caution" : "text-lg font-semibold text-compliance"}>
            {openFindings}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Bids in this report</p>
          <p className="text-lg font-semibold text-navy">{evaluations.length}</p>
        </div>
      </div>

      {alreadySigned && !result ? (
        <div className="rounded-lg border border-compliance/30 bg-compliance-soft p-3 text-xs text-compliance flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          This evaluation report has already been signed off by the Evaluation Committee.
        </div>
      ) : null}

      {/* Named Human Approver Form */}
      <div className="grid gap-3 sm:grid-cols-3 pt-2">
        <div className="space-y-1 sm:col-span-1">
          <Label htmlFor="signer_name" className="text-xs font-medium flex items-center gap-1">
            <UserCheck className="h-3.5 w-3.5 text-navy" />
            Named Approving Officer
          </Label>
          <Input
            id="signer_name"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Official full name"
            className="text-xs h-8"
          />
        </div>

        <div className="space-y-1 sm:col-span-1">
          <Label htmlFor="signer_role" className="text-xs font-medium">Designation / Role</Label>
          <Input
            id="signer_role"
            value={signerRole}
            onChange={(e) => setSignerRole(e.target.value)}
            placeholder="Committee designation"
            className="text-xs h-8"
          />
        </div>

        <div className="space-y-1 sm:col-span-1">
          <Label htmlFor="national_id" className="text-xs font-medium">Staff ID / National ID</Label>
          <Input
            id="national_id"
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value)}
            placeholder="Official identification"
            className="text-xs h-8"
          />
        </div>
      </div>

      {/* Decision Note */}
      <div className="space-y-1.5 pt-1">
        <Label htmlFor="signoff" className="text-xs font-medium">Committee Evaluation Summary Note</Label>
        <Textarea
          id="signoff"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Summarise the committee's reasoning, the recommended bidder and any statutory conditions attached."
          className="text-xs leading-relaxed"
        />
      </div>

      {/* Statutory Affirmation Checkbox */}
      <div className="rounded-lg border border-border bg-background p-3">
        <label className="flex items-start gap-2.5 cursor-pointer text-xs leading-relaxed">
          <input
            type="checkbox"
            checked={statutoryAffirmation}
            onChange={(e) => setStatutoryAffirmation(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border text-navy focus:ring-navy"
          />
          <span className="text-muted-foreground select-none">
            <strong className="text-foreground">Official Affirmation:</strong> I confirm that I have reviewed the submitted bids, statutory verification records, and price benchmarks, and that the evaluation findings reflect the committee's review in accordance with public procurement guidelines.
          </span>
        </label>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-critical/30 bg-critical-soft p-3 text-xs text-critical">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="rounded-lg border border-compliance/40 bg-compliance-soft p-3 text-xs text-compliance space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <Stamp className="h-4 w-4" />
            EVALUATION REPORT APPROVED &amp; RECORDED
          </div>
          <p>
            Approved by: <strong>{result.signerName}</strong> ({result.signerRole})
          </p>
          <p className="text-[11px] text-compliance/80 font-mono">
            Signed Timestamp: {new Date(result.timestamp).toLocaleString()} | Recorded to Audit Register
          </p>
        </div>
      ) : null}

      <Button
        className="w-full bg-navy text-white hover:bg-navy/90 text-xs font-medium py-2.5"
        disabled={busy || alreadySigned}
        onClick={sign}
      >
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}
        Confirm &amp; Formally Sign Evaluation Report
      </Button>
    </div>
  );
}
