import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileText, FolderOpen, ShieldQuestion } from "lucide-react";
import { listMyBids, listMyEvaluations } from "@/lib/data";
import { useSession } from "@/lib/session";
import { formatCurrency, formatDate, plainStatus } from "@/lib/format";
import { overallStyle } from "@/lib/statusLabels";
import PortalShell from "@/components/layout/PortalShell";
import RoleGate from "@/components/common/RoleGate";
import TenderFeed from "@/components/tenders/TenderFeed";
import StatusBadge from "@/components/common/StatusBadge";
import StatCard from "@/components/common/StatCard";
import EmptyState from "@/components/common/EmptyState";
import LoadingBlock from "@/components/common/LoadingBlock";
import { Button } from "@/components/ui/button";

export default function SupplierPortal() {
  const { user, profile } = useSession();
  const [bids, setBids] = useState(null);
  const [evaluations, setEvaluations] = useState([]);

  useEffect(() => {
    const uid = user?.id || profile?.id;
    listMyBids(uid).then(setBids).catch(() => setBids([]));
    listMyEvaluations(uid).then(setEvaluations).catch(() => setEvaluations([]));
  }, [user, profile]);

  const evaluationFor = (bidId) => evaluations.find((row) => row.bid_id === bidId);

  return (
    <PortalShell
      eyebrow="Supplier desk"
      title="Your bids and the open register"
      description="Track your submissions, review compliance status, and check draft bids against statutory registers before lodging."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="border-border bg-card hover:bg-muted text-xs">
            <a
              href="/sample-bid-packet.pdf"
              download="Apex_Sovereign_Technologies_Bid_Packet_T-2026-KEBS-014.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
              Demo Bid Packet (PDF)
            </a>
          </Button>
          <Button asChild className="bg-compliance text-white hover:bg-compliance/90 text-xs">
            <Link to="/supplier/self-audit">
              <ShieldQuestion className="mr-1.5 h-3.5 w-3.5" />
              Verify a draft bid
            </Link>
          </Button>
        </div>
      }
    >
      <RoleGate roles={["supplier", "admin", "superadmin"]}>
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Bids lodged" value={bids?.length ?? "—"} hint="Submissions on the record" />
            <StatCard
              label="Total value quoted"
              value={formatCurrency((bids || []).reduce((sum, bid) => sum + Number(bid.quoted_amount || 0), 0))}
              hint="Across every open submission"
              tone="compliance"
            />
            <StatCard
              label="Compliance notes"
              value={(evaluations || []).reduce(
                (count, row) =>
                  count + (Array.isArray(row.findings) ? row.findings.filter((f) => f.severity !== "info").length : 0),
                0,
              )}
              hint="Items the committee will review"
              tone="caution"
            />
          </div>

          <div>
            <h2 className="font-display text-2xl text-navy">My submissions</h2>
            <div className="mt-4">
              {bids === null ? (
                <LoadingBlock label="Loading your submissions" />
              ) : bids.length === 0 ? (
                <EmptyState
                  icon={FolderOpen}
                  title="You have not lodged a bid yet"
                  description="Pick an open tender below and lodge your first submission."
                />
              ) : (
                <div className="space-y-3">
                  {bids.map((bid) => {
                    const evaluation = evaluationFor(bid.id);
                    const overall = evaluation ? overallStyle(evaluation.overall_status) : null;
                    return (
                      <div
                        key={bid.id}
                        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {bid.tenders_ocds?.tender_number}
                          </p>
                          <p className="mt-1 font-medium text-foreground">{bid.tenders_ocds?.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Lodged {formatDate(bid.submission_date)} · {bid.tenders_ocds?.procuring_entity}
                          </p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="font-semibold text-navy">{formatCurrency(bid.quoted_amount)}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5 sm:justify-end">
                            {overall ? (
                              <StatusBadge tone={overall.tone}>{overall.label}</StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral">{plainStatus("pending")}</StatusBadge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-navy" />
              <h2 className="font-display text-2xl text-navy">Open opportunities</h2>
            </div>
            <div className="mt-4">
              <TenderFeed />
            </div>
          </div>
        </div>
      </RoleGate>
    </PortalShell>
  );
}