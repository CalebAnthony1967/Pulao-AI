import React, { useState } from "react";
import { Eye, FileText, Quote, ShieldAlert, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { recordAudit } from "@/lib/audit";
import { saveLocalDecision } from "@/lib/data";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { severityStyle } from "@/lib/format";
import StatusBadge from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const ACTION_LABEL = {
  approved: { label: "Finding upheld", tone: "compliance" },
  overridden: { label: "Overridden by committee", tone: "caution" },
  flagged: { label: "Escalated", tone: "critical" },
};

export default function FindingList({ evaluation, decisions, onDecision }) {
  const { user, profile } = useSession();
  const { resolvedLanguage, t } = useI18n();
  const [openKey, setOpenKey] = useState(null);
  const [inspectKey, setInspectKey] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const findings = Array.isArray(evaluation.findings) ? evaluation.findings : [];
  const parsedPages = Array.isArray(evaluation.parsed_pages) ? evaluation.parsed_pages : [];

  const decided = (key) =>
    decisions.find((decision) => decision.evaluation_id === evaluation.id && decision.finding_key === key);

  const decide = async (finding, action) => {
    if (action === "overridden" && note.trim().length < 20) {
      setError("A written justification of at least 20 characters is required to override a finding.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const decisionPayload = {
        id: "dec_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
        evaluation_id: evaluation.id,
        tender_id: evaluation.tender_id,
        reviewer_id: user?.id || profile?.id || "reviewer_committee",
        reviewer_name: profile?.full_name || user?.email || "Committee Member",
        decision_action: action,
        finding_key: finding.key,
        written_justification: action === "overridden" ? note.trim() : "Finding accepted as raised by the audit.",
        signed_at: new Date().toISOString(),
      };

      try {
        await supabase.from("committee_decisions").insert(decisionPayload);
      } catch {}

      saveLocalDecision(decisionPayload);

      await recordAudit({
        action: "Committee decision recorded",
        input: { finding: finding.title, action, bidder: evaluation.bid_submissions?.bidder_name },
        output: { evaluation_id: evaluation.id },
      }).catch(() => {});

      setOpenKey(null);
      setNote("");
      onDecision();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {findings.map((finding) => {
        const style = severityStyle(finding.severity);
        const already = decided(finding.key);
        const isSw = resolvedLanguage === "sw";
        const displayTitle = isSw && finding.title_sw ? finding.title_sw : finding.title;
        const displayDetail = isSw && finding.detail_sw ? finding.detail_sw : finding.detail;
        const pageNum = finding.citation?.page || 1;
        const pageObj = parsedPages.find((p) => Number(p.page) === Number(pageNum)) || parsedPages[0];
        const isInspecting = inspectKey === finding.key;

        return (
          <div key={finding.key} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex-1">
                <StatusBadge tone={style.tone}>{style.label}</StatusBadge>
                <h4 className="mt-2 font-semibold text-foreground">{displayTitle}</h4>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{displayDetail}</p>
              </div>
            </div>

            {finding.category === "ocr_review" && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-caution/30 bg-caution-soft px-3 py-2 text-xs text-caution">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                <span>{t("lowOcrNotice")}</span>
              </div>
            )}

            {/* Mandatory Grounded Citation Strip */}
            <div className="mt-3 space-y-2 rounded-lg border border-border bg-background px-3 py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <FileText className="h-3.5 w-3.5 text-navy shrink-0" />
                <span className="font-medium text-foreground">
                  {finding.citation?.document_name || "Bid Dossier"}
                </span>
                <span>· Page {pageNum}</span>
                <span>· {finding.citation?.section || finding.citation?.reference || "Verified Section"}</span>
                <span className="ml-auto inline-flex items-center gap-1 font-medium text-compliance">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t("citationVerified")}
                </span>
              </div>

              {finding.citation?.verbatim_quote && (
                <div className="flex items-start gap-2 border-t border-border/60 pt-2 font-mono text-[11px] text-muted-foreground">
                  <Quote className="mt-0.5 h-3 w-3 shrink-0 text-navy" />
                  <span>&ldquo;{finding.citation.verbatim_quote}&rdquo;</span>
                </div>
              )}

              {pageObj && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setInspectKey(isInspecting ? null : finding.key)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy hover:underline"
                  >
                    <Eye className="h-3 w-3" />
                    {isInspecting ? t("hideSource") : t("inspectSource")} (Page {pageObj.page})
                  </button>
                  {isInspecting && (
                    <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-muted/30 p-2.5 font-mono text-[11px] text-foreground">
                      {pageObj.text || "No extracted text on this page."}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {already ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusBadge tone={ACTION_LABEL[already.decision_action]?.tone || "neutral"}>
                  {ACTION_LABEL[already.decision_action]?.label || already.decision_action}
                </StatusBadge>
                <span className="text-xs text-muted-foreground">
                  {already.reviewer_name} · {already.written_justification}
                </span>
              </div>
            ) : (
              <div className="mt-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="bg-compliance text-white hover:bg-compliance/90"
                    disabled={busy}
                    onClick={() => decide(finding, "approved")}
                  >
                    {t("upholdFinding")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setOpenKey(openKey === finding.key ? null : finding.key);
                      setNote("");
                      setError(null);
                    }}
                  >
                    {t("overrideFinding")}
                  </Button>
                </div>

                {openKey === finding.key ? (
                  <div className="mt-3 space-y-2">
                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={3}
                      placeholder="Explain why the committee is setting this finding aside. This note becomes part of the permanent record."
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="bg-caution text-white hover:bg-caution/90"
                        disabled={busy}
                        onClick={() => decide(finding, "overridden")}
                      >
                        Record override
                      </Button>
                      <span className={cn("text-xs", note.trim().length < 20 ? "text-caution" : "text-compliance")}>
                        {note.trim().length}/20 characters minimum
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}

      {error ? (
        <div className="rounded-lg border border-critical/30 bg-critical-soft p-3 text-sm text-critical">{error}</div>
      ) : null}
    </div>
  );
}