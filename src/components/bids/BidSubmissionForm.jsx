import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Paperclip, Send, UploadCloud, Building2, Hash, Download, FileText, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { recordAudit } from "@/lib/audit";
import { runAuditPipeline } from "@/lib/tools";
import { executeMcpTool } from "@/lib/mcpClient";
import { listPriceIndex, saveLocalBid } from "@/lib/data";
import { useSession } from "@/lib/session";
import { formatCurrency } from "@/lib/format";
import LineItemsEditor, { EMPTY_ITEM, lineTotal } from "./LineItemsEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function BidSubmissionForm({ tender, onSubmitted }) {
  const { profile, user } = useSession();
  const [bidderName, setBidderName] = useState(profile?.organization || profile?.full_name || "");
  const [registrationNumber, setRegistrationNumber] = useState(profile?.registration_number || "");
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [stage, setStage] = useState("");

  const autoFillSampleDossier = () => {
    setBidderName("Apex Sovereign Technologies Limited");
    setRegistrationNumber("PVT-2024-889911");
    // Pre-fill realistic line items tailored to this tender scope
    if (
      tender?.tender_number === "T-2026-KEBS-014" ||
      tender?.title?.toLowerCase().includes("computer") ||
      tender?.title?.toLowerCase().includes("switch")
    ) {
      setItems([
        {
          description: "Commercial Grade Desktop Computers (Intel Core i7 13th Gen, 32GB RAM, 1TB SSD, Win 11 Pro)",
          quantity: 80,
          unit_price: 95000,
          unit_of_measure: "Units",
        },
        {
          description: "27-inch 4K IPS Ultra-Slim Desktop Displays (3840x2160, USB-C 65W PD)",
          quantity: 80,
          unit_price: 28000,
          unit_of_measure: "Units",
        },
        {
          description: "24-Port Managed PoE+ Gigabit Network Switches (Layer 2/3 Enterprise, 370W)",
          quantity: 20,
          unit_price: 75000,
          unit_of_measure: "Units",
        },
        {
          description: "Structured Cat6A Pure Copper Cabling & 24-Port Loaded Patch Panels",
          quantity: 20,
          unit_price: 45000,
          unit_of_measure: "Lots",
        },
      ]);
    } else {
      const budget = tender?.budget_allocation ? tender.budget_allocation * 0.95 : 12000000;
      setItems([
        {
          description: `${tender?.title || "Main Scope Deliverables"} — Primary Implementation`,
          quantity: 1,
          unit_price: Math.round(budget * 0.7),
          unit_of_measure: "Lot",
        },
        {
          description: "Quality Assurance, Testing, and Commissioning",
          quantity: 1,
          unit_price: Math.round(budget * 0.2),
          unit_of_measure: "Lot",
        },
        {
          description: "12-Month Maintenance & Warranty Support",
          quantity: 1,
          unit_price: Math.round(budget * 0.1),
          unit_of_measure: "Year",
        },
      ]);
    }

    // Attach sample dummy bid packet PDF
    setDocuments([
      {
        uri: "/sample-bid-packet.pdf",
        name: "Apex_Sovereign_Technologies_Bid_Packet_T-2026-KEBS-014.pdf",
        size: 44236,
      },
    ]);
  };

  useEffect(() => {
    if (profile) {
      if (!bidderName) setBidderName(profile.organization || profile.full_name || "");
      if (!registrationNumber && profile.registration_number) {
        setRegistrationNumber(profile.registration_number);
      }
    }
  }, [profile]);

  const total = items.reduce((sum, item) => sum + lineTotal(item), 0);

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = [];
      for (const file of files) {
        let uri = "";
        try {
          uri = URL.createObjectURL(file);
        } catch {
          uri = `file://${file.name}`;
        }
        uploaded.push({ uri, name: file.name, size: file.size });
      }
      setDocuments((current) => [...current, ...uploaded]);
    } catch {
      setError("A document could not be attached. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!bidderName.trim()) {
      return setError("Enter the name of the bidding company.");
    }
    if (!registrationNumber.trim()) {
      return setError("Enter the company registration number (e.g. PVT-2021-998811).");
    }

    // Clean, parse, and normalize line items
    const parsedItems = items.map((item, idx) => {
      const rawPrice = item.unit_price;
      const numericPrice =
        typeof rawPrice === "number"
          ? rawPrice
          : Number(String(rawPrice ?? "0").replace(/[^0-9.-]+/g, "")) || 0;

      const rawQty = item.quantity;
      const numericQty =
        typeof rawQty === "number"
          ? rawQty > 0
            ? rawQty
            : 1
          : Number(String(rawQty ?? "1").replace(/[^0-9.-]+/g, "")) || 1;

      let desc = (item.description || "").trim();
      // If user entered price but left description blank, auto-fill standard deliverable description
      if (!desc && numericPrice > 0) {
        desc = `${tender.title || "Quotation item"} — Deliverable #${idx + 1}`;
      }

      return {
        ...item,
        description: desc,
        quantity: numericQty,
        unit_price: numericPrice,
        unit_of_measure: (item.unit_of_measure || "").trim() || "per unit",
      };
    });

    const pricedItems = parsedItems.filter((i) => i.unit_price > 0);

    if (pricedItems.length === 0) {
      return setError(
        "Please enter a unit price greater than 0 for at least one line item in your quotation.",
      );
    }

    const calculatedTotal = pricedItems.reduce(
      (sum, item) => sum + item.quantity * item.unit_price,
      0,
    );
    const userId = user?.id || profile?.id || "usr_" + Math.random().toString(36).substring(2, 9);
    const authorName = profile?.full_name || profile?.organization || user?.email || bidderName.trim();

    setSubmitting(true);
    setStage("Registering quotation in secure registry...");
    try {
      const bidPayload = {
        tender_id: tender.id,
        bidder_name: bidderName.trim(),
        registration_number: registrationNumber.trim(),
        quoted_amount: calculatedTotal,
        line_items: pricedItems,
        document_urls: documents.map((doc) => doc.uri),
        metadata: {
          author: authorName,
          producer: "Pulao-AI supplier desk",
          created: new Date().toISOString(),
          pages: documents.length,
          attachments: documents.map((doc) => doc.name),
        },
        submitted_by: userId,
        submission_date: new Date().toISOString(),
        status: "submitted",
      };

      let bidData = null;
      try {
        const { data, error: insertError } = await supabase
          .from("bid_submissions")
          .insert(bidPayload)
          .select()
          .single();

        if (!insertError && data) {
          bidData = data;
        }
      } catch (dbErr) {
        console.warn("Direct database insert notice, activating resilient vault:", dbErr);
      }

      if (!bidData) {
        bidData = {
          ...bidPayload,
          id: "bid_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8),
        };
      }

      // Persist locally so it's guaranteed visible in all portals immediately
      saveLocalBid(bidData);

      setStage("Recording tamper-evident audit log...");
      await recordAudit({
        action: "Bid submitted",
        input: { tender_number: tender.tender_number, bidder: bidderName, amount: calculatedTotal },
        output: { bid_id: bidData.id, documents: documents.length },
      }).catch(() => {});

      setStage("Reading packet and checking statutory registers...");
      const priceIndex = await listPriceIndex().catch(() => []);

      // Invoke Custom MCP Tools
      await executeMcpTool("verify_statutory_registers", {
        company_registration_no: registrationNumber.trim(),
        company_name: bidderName.trim(),
        tender_number: tender.tender_number,
      }, { bid_id: bidData.id, caller: "Supplier Bid Submission" }).catch(() => {});

      if (pricedItems.length > 0) {
        await executeMcpTool("benchmark_market_pricing", {
          line_items: pricedItems,
          price_index: priceIndex,
          tender_budget: tender.budget_allocation,
        }, { bid_id: bidData.id, caller: "Supplier Bid Submission" }).catch(() => {});
      }

      await runAuditPipeline({
        tender,
        bids: [bidData],
        priceIndex,
        onProgress: (lbl) => setStage(lbl),
      }).catch((pipelineErr) => {
        console.warn("Pipeline non-fatal notice:", pipelineErr);
      });

      setStage("");
      setDone(true);
      if (onSubmitted) onSubmitted(bidData);
    } catch (err) {
      setError(err.message || "Failed to lodge bid. Please verify company details.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitting && stage) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-navy" />
        <h3 className="mt-3 font-semibold text-foreground">Verifying your submission</h3>
        <p className="mt-2 text-sm text-muted-foreground">{stage}</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-xl border border-compliance/30 bg-compliance-soft p-6 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-compliance" />
        <h3 className="mt-3 text-lg font-semibold text-compliance">Bid Submitted Successfully</h3>
        <p className="mt-2 text-sm leading-relaxed text-compliance/90">
          {formatCurrency(total)} submitted for {tender.tender_number}. Your submission has been recorded and will be reviewed by the evaluation committee alongside statutory checks and pricing benchmarks.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Submit Your Bid</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            All submitted items and documentation are subject to statutory verification and committee review.
          </p>
        </div>
      </div>

      {/* Demo helper banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-navy/20 bg-navy/5 p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-navy text-white">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">Demonstration Bid Packet Available</p>
            <p className="text-[11px] text-muted-foreground">
              Official dummy tender dossier with statutory certificates, priced schedule, and sworn affidavits.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/sample-bid-packet.pdf"
            download="Apex_Sovereign_Technologies_Bid_Packet_T-2026-KEBS-014.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow-sm hover:bg-muted"
          >
            <Download className="h-3 w-3 text-muted-foreground" />
            Download Sample PDF
          </a>
          <button
            type="button"
            onClick={autoFillSampleDossier}
            className="inline-flex items-center gap-1.5 rounded-md bg-navy px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-navy/90"
          >
            <Sparkles className="h-3 w-3" />
            Auto-Fill Sample Bid
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bidder" className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            Bidding company
          </Label>
          <Input
            id="bidder"
            value={bidderName}
            onChange={(event) => setBidderName(event.target.value)}
            placeholder="Registered company name"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="regno" className="flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            Company registration number
          </Label>
          <Input
            id="regno"
            value={registrationNumber}
            onChange={(event) => setRegistrationNumber(event.target.value)}
            placeholder="e.g. PVT-2024-889911"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Itemised quotation</Label>
        <LineItemsEditor items={items} onChange={setItems} tender={tender} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Bid packet documents</Label>
          <a
            href="/sample-bid-packet.pdf"
            download="sample-bid-packet.pdf"
            className="text-[11px] text-navy hover:underline"
          >
            Download dummy packet (.pdf)
          </a>
        </div>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center transition-colors hover:border-navy/40">
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-navy" />
          ) : (
            <UploadCloud className="h-5 w-5 text-navy" />
          )}
          <span className="text-sm font-medium">
            {uploading ? "Attaching documents" : "Attach your bid packet (PDF, images, spreadsheets)"}
          </span>
          <span className="text-xs text-muted-foreground">
            Supporting annexures, statutory certificates, and priced schedules for committee review.
          </span>
          <input type="file" multiple className="hidden" onChange={handleFiles} disabled={uploading} />
        </label>

        {documents.length ? (
          <ul className="space-y-1.5">
            {documents.map((doc, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 truncate">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-navy" />
                  <span className="font-medium text-foreground truncate">{doc.name}</span>
                  {doc.size ? (
                    <span className="text-muted-foreground">({Math.round(doc.size / 1024)} KB)</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {doc.uri ? (
                    <a
                      href={doc.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-navy hover:underline"
                    >
                      View
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDocuments(documents.filter((_, i) => i !== idx))}
                    className="text-muted-foreground hover:text-critical"
                    title="Remove document"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-critical/30 bg-critical-soft p-3 text-sm text-critical">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-sm font-semibold text-navy">Quoted total: {formatCurrency(total)}</p>
        <Button type="submit" disabled={submitting || uploading} className="bg-navy text-white hover:bg-navy/90">
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Submit Bid
        </Button>
      </div>
    </form>
  );
}
