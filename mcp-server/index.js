/**
 * Pulao AI — Custom Procurement & Corporate KYB MCP Server (v2.0.0)
 * Conforms to Model Context Protocol (MCP) Specification over stdio
 *
 * Tools exposed:
 * 1. verify_statutory_registers (read)
 * 2. benchmark_market_pricing (read)
 * 3. query_compliance_rulebook (read)
 * 4. flag_procurement_disqualification (write/mutate — strictly citation-grounded & human-gated)
 * 5. draft_evaluation_report (write/mutate — never auto-awards; human committee sign-off required)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

function loadJson(relPath, fallback) {
  try {
    const raw = fs.readFileSync(path.join(PROJECT_ROOT, relPath), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normaliseText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findMatchingBenchmark(description, callerIndex = [], baselineIndex = []) {
  const target = normaliseText(description);
  if (!target) return null;

  const combined = [...(Array.isArray(callerIndex) ? callerIndex : []), ...(Array.isArray(baselineIndex) ? baselineIndex : [])];
  let best = null;
  let bestScore = 0;

  for (const row of combined) {
    const desc = row.item_description || row.description || row.item_category || "";
    const tokens = normaliseText(desc)
      .split(" ")
      .filter((t) => t.length >= 3);
    if (!tokens.length) continue;

    const hits = tokens.filter((token) => target.includes(token)).length;
    const targetTokens = target.split(" ").filter((t) => t.length >= 3);
    const reverseHits = targetTokens.filter((token) => normaliseText(desc).includes(token)).length;
    const score = Math.max(hits / tokens.length, targetTokens.length ? reverseHits / targetTokens.length : 0);

    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  return bestScore >= 0.35 ? best : null;
}

const server = new Server(
  {
    name: "pulao-procurement-mcp",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "verify_statutory_registers",
        description:
          "Read-only verification of a bidder/vendor against the indexed Kenyan statutory registry snapshot (KRA Tax Compliance, BRS Incorporation, NSSF, SHA/SHIF, AGPO, PPRA Debarment) or Corporate KYB checks. Unknown registration numbers escalate to UNVERIFIED_MANUAL_CHECK rather than guessing.",
        inputSchema: {
          type: "object",
          properties: {
            company_registration_no: { type: "string", description: "BRS registration number, e.g. PVT-2024-889911" },
            company_name: { type: "string", description: "Registered legal entity name" },
            tender_number: { type: "string", description: "Tender or RFP reference number" },
            sector_mode: { type: "string", enum: ["public_ppada", "corporate_rfp"], description: "Rulebook context" },
          },
          required: ["company_registration_no", "company_name"],
        },
      },
      {
        name: "benchmark_market_pricing",
        description:
          "Read-only price reasonableness audit against caller price_index and published PPRA Q2 2026 Market Price Index. Flags PRICE_GOUGING, PREDATORY_UNDERCUTTING, BENCHMARKED_FAIR, or UNBENCHMARKED_MANUAL_REVIEW without inventing synthetic ratios.",
        inputSchema: {
          type: "object",
          properties: {
            line_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string" },
                  quantity: { type: "number" },
                  unit_price: { type: "number" },
                },
                required: ["description", "unit_price"],
              },
            },
            price_index: {
              type: "array",
              description: "Optional caller-provided market price index rows",
            },
            tender_budget: { type: "number" },
            allowed_variance_pct: { type: "number", description: "Ceiling tolerance percent (default 15)" },
          },
          required: ["line_items"],
        },
      },
      {
        name: "query_compliance_rulebook",
        description:
          "Read-only lookup of Kenya Public Procurement and Asset Disposal Act (PPADA) 2015 provisions or Private Corporate RFP Governance rules in English and Kiswahili.",
        inputSchema: {
          type: "object",
          properties: {
            sector_mode: { type: "string", enum: ["public_ppada", "corporate_rfp"] },
            topic: { type: "string", description: "Rule topic e.g. statutory, pricing, collusion, award_gate, agpo, ocr" },
            language: { type: "string", enum: ["en", "sw"] },
          },
          required: ["sector_mode"],
        },
      },
      {
        name: "flag_procurement_disqualification",
        description:
          "MUTATING TOOL: Drafts an advisory non-responsiveness / compliance flag under PPADA 2015 or Corporate RFP policy. Enforces Zero-Unsourced-Flag rule (requires evidence_quote and source_page >= 1) and never auto-disqualifies without named human committee sign-off.",
        inputSchema: {
          type: "object",
          properties: {
            tender_number: { type: "string" },
            bidder_name: { type: "string" },
            bid_id: { type: "string" },
            statutory_ground: { type: "string" },
            legal_citation: { type: "string" },
            evidence_summary: { type: "string" },
            document_name: { type: "string" },
            source_page: { type: "number" },
            evidence_quote: { type: "string" },
            sector_mode: { type: "string", enum: ["public_ppada", "corporate_rfp"] },
          },
          required: ["tender_number", "bidder_name", "statutory_ground", "legal_citation", "evidence_summary", "source_page", "evidence_quote"],
        },
      },
      {
        name: "draft_evaluation_report",
        description:
          "MUTATING TOOL: Compiles the pre-committee Evaluation Dossier with SHA-256 audit seal. Never auto-awards any tender; explicitly locks award/rejection behind Evaluation Committee & Accounting Officer human sign-off.",
        inputSchema: {
          type: "object",
          properties: {
            tender_id: { type: "string" },
            tender_number: { type: "string" },
            lowest_responsive_candidate: { type: "string" },
            quoted_amount: { type: "number" },
            flagged_bidders: { type: "array", items: { type: "string" } },
            compliance_summary: { type: "string" },
            sector_mode: { type: "string", enum: ["public_ppada", "corporate_rfp"] },
          },
          required: ["tender_number", "compliance_summary"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const timestamp = new Date().toISOString();

  if (name === "verify_statutory_registers") {
    const regNo = String(args.company_registration_no || "").trim().toUpperCase();
    const companyName = String(args.company_name || "").trim();
    const sectorMode = args.sector_mode === "corporate_rfp" ? "corporate_rfp" : "public_ppada";

    const db = loadJson("server/data/statutory_registers.json", { adapter_mode: "simulated_register_db", records: [] });
    const record = (db.records || []).find(
      (r) =>
        String(r.registration_number || "").toUpperCase() === regNo ||
        (companyName && String(r.company_name || "").toLowerCase() === companyName.toLowerCase()),
    );

    if (!record) {
      const unknownResult = {
        timestamp,
        adapter_mode: db.adapter_mode || "simulated_register_db",
        adapter_notice: db.adapter_notice,
        sector_mode: sectorMode,
        bidder: companyName || "Unknown Entity",
        registration_number: regNo || "UNSPECIFIED",
        registry_found: false,
        requires_manual_verification: true,
        beneficial_owners: [],
        verdicts: [
          {
            key: "kra_tax_status",
            portal: "Kenya Revenue Authority (iTax)",
            status: "UNVERIFIED_MANUAL_CHECK",
            certificate_no: "NOT_IN_SNAPSHOT",
            valid: null,
            legal_basis: sectorMode === "corporate_rfp" ? "Corporate KYB Tax Policy" : "PPADA 2015 s.79(1)",
            citation_ref: `Registry Lookup (${regNo || "N/A"}) — Not found in sandboxed register snapshot`,
          },
          {
            key: "brs_status",
            portal: "Business Registration Service (BRS)",
            status: "UNVERIFIED_MANUAL_CHECK",
            certificate_no: "NOT_IN_SNAPSHOT",
            valid: null,
            legal_basis: "Companies Act 2015 / Corporate KYB",
            citation_ref: `BRS Lookup (${regNo || "N/A"}) — Manual e-Citizen verification required`,
          },
        ],
        all_statutory_passed: false,
        recommendation:
          "Registration number not present in sandboxed test register snapshot. Escalated for manual officer verification via live e-Citizen / iTax portal.",
      };
      return { content: [{ type: "text", text: JSON.stringify(unknownResult, null, 2) }] };
    }

    const verdicts = [
      {
        key: "kra_tax_status",
        portal: "Kenya Revenue Authority (iTax)",
        status: record.kra_tax.status,
        certificate_no: record.kra_tax.certificate_no,
        expires_on: record.kra_tax.expires_on,
        valid: record.kra_tax.valid,
        legal_basis: sectorMode === "corporate_rfp" ? "Corporate KYB Tax Clearance Policy" : "PPADA 2015 s.79(1)",
        citation_ref: `KRA iTax Record ${record.kra_tax.certificate_no} (expires ${record.kra_tax.expires_on})`,
      },
      {
        key: "brs_status",
        portal: "Business Registration Service (BRS)",
        status: record.brs_company.status,
        certificate_no: record.brs_company.certificate_no,
        registered_on: record.brs_company.registered_on,
        valid: record.brs_company.valid,
        legal_basis: "Companies Act 2015 s.900",
        citation_ref: `BRS Registry ${record.brs_company.certificate_no} (${record.brs_company.status})`,
      },
      {
        key: "nssf_status",
        portal: "National Social Security Fund (NSSF)",
        status: record.nssf.status,
        certificate_no: record.nssf.certificate_no,
        valid: record.nssf.valid,
        legal_basis: "NSSF Act 2013 s.48",
        citation_ref: `NSSF Register ${record.nssf.certificate_no} (${record.nssf.status})`,
      },
      {
        key: "sha_shif_status",
        portal: "Social Health Authority (SHA/SHIF)",
        status: record.sha_shif.status,
        certificate_no: record.sha_shif.certificate_no,
        valid: record.sha_shif.valid,
        legal_basis: "Social Health Insurance Act 2023 s.27",
        citation_ref: `SHA/SHIF Register ${record.sha_shif.certificate_no} (${record.sha_shif.status})`,
      },
      {
        key: "agpo_status",
        portal: sectorMode === "corporate_rfp" ? "Corporate Supplier Diversity / ESG" : "PPRA AGPO Preference Register",
        status: record.agpo.status,
        certificate_no: record.agpo.certificate_no,
        category: record.agpo.category,
        valid: true,
        legal_basis: sectorMode === "corporate_rfp" ? "Corporate ESG & Inclusive Sourcing Charter" : "PPADA 2015 Part XII Preferences & Reservations",
        citation_ref: `AGPO/Diversity Record ${record.agpo.certificate_no} (${record.agpo.category})`,
      },
    ];

    if (record.ppra_debarred) {
      verdicts.push({
        key: "ppra_debarment",
        portal: "PPRA Debarment & Sanctions List",
        status: "DEBARRED_SUPPLIER",
        certificate_no: "PPRA-DEB-2025-419",
        valid: false,
        legal_basis: "PPADA 2015 s.41(1)",
        citation_ref: record.debarment_reason || "PPRA Debarment Register Match",
      });
    }

    if (sectorMode === "corporate_rfp" && record.corporate_kyb) {
      verdicts.push({
        key: "corporate_kyb_insurance",
        portal: "Corporate KYB Sanctions & Liability Insurance",
        status: record.corporate_kyb.sanctions_clear && record.corporate_kyb.insurance_active ? "KYB_COMPLIANT" : "KYB_GAP_DETECTED",
        certificate_no: record.corporate_kyb.insurance_active ? "POL-INS-2026" : "MISSING_POLICY",
        valid: Boolean(record.corporate_kyb.sanctions_clear && record.corporate_kyb.insurance_active),
        legal_basis: "Enterprise Vendor Governance Policy s.4.2",
        citation_ref: `Sanctions clear: ${record.corporate_kyb.sanctions_clear}, Indemnity active: ${record.corporate_kyb.insurance_active}`,
      });
    }

    const failedChecks = verdicts.filter((v) => v.valid === false);
    const allPassed = failedChecks.length === 0;

    const result = {
      timestamp,
      adapter_mode: db.adapter_mode || "simulated_register_db",
      adapter_notice: db.adapter_notice,
      sector_mode: sectorMode,
      bidder: record.company_name,
      registration_number: record.registration_number,
      registry_found: true,
      requires_manual_verification: false,
      beneficial_owners: record.beneficial_owners || [],
      ppra_debarred: Boolean(record.ppra_debarred),
      verdicts,
      all_statutory_passed: allPassed,
      recommendation: allPassed
        ? "All register checks verified in snapshot. Eligible for human committee technical/financial review."
        : `${failedChecks.length} compliance exception(s) detected in register snapshot — prepare cited dossier for human Evaluation Committee review.`,
    };

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "benchmark_market_pricing") {
    const items = Array.isArray(args.line_items) ? args.line_items : [];
    const callerIndex = Array.isArray(args.price_index) ? args.price_index : [];
    const baseline = loadJson("server/data/ppra_price_index.json", { items: [] });
    const tolerancePct = Number(args.allowed_variance_pct) > 0 ? Number(args.allowed_variance_pct) : 15;
    const toleranceRatio = tolerancePct / 100;

    const auditedItems = items.map((item, index) => {
      const declaredPrice = Number(item.unit_price) || 0;
      const quantity = Number(item.quantity) || 1;
      const match = findMatchingBenchmark(item.description, callerIndex, baseline.items);

      if (!match) {
        return {
          item_index: index + 1,
          description: item.description,
          quantity,
          declared_unit_price: declaredPrice,
          ppra_market_median: null,
          ppra_ceiling_allowed: null,
          ppra_floor_safe: null,
          variance_percentage: null,
          matched_catalog_item: null,
          risk_flag: "UNBENCHMARKED_MANUAL_REVIEW",
        };
      }

      const median = Number(match.benchmark_price || match.median_price || 0);
      const catalogMargin = Number(match.allowed_deviation_margin) > 0 ? Number(match.allowed_deviation_margin) : toleranceRatio;
      const itemMargin = Number(args.allowed_variance_pct) > 0 ? Math.min(catalogMargin, toleranceRatio) : catalogMargin;
      const ceiling = Math.round(median * (1 + itemMargin));
      const floor = Math.round(median * 0.7);
      const varianceRatio = median > 0 ? (declaredPrice - median) / median : 0;

      let riskFlag = "BENCHMARKED_FAIR";
      if (declaredPrice > ceiling) riskFlag = "PRICE_GOUGING";
      else if (declaredPrice < floor) riskFlag = "PREDATORY_UNDERCUTTING";

      return {
        item_index: index + 1,
        description: item.description,
        quantity,
        declared_unit_price: declaredPrice,
        ppra_market_median: median,
        ppra_ceiling_allowed: ceiling,
        ppra_floor_safe: floor,
        variance_percentage: Number((varianceRatio * 100).toFixed(1)),
        matched_catalog_item: match.item_description || match.item_category,
        risk_flag: riskFlag,
      };
    });

    const gougingCount = auditedItems.filter((i) => i.risk_flag === "PRICE_GOUGING").length;
    const undercuttingCount = auditedItems.filter((i) => i.risk_flag === "PREDATORY_UNDERCUTTING").length;
    const unbenchmarkedCount = auditedItems.filter((i) => i.risk_flag === "UNBENCHMARKED_MANUAL_REVIEW").length;

    const totalQuoted = auditedItems.reduce((sum, i) => sum + i.declared_unit_price * i.quantity, 0);
    const overBudget = Number(args.tender_budget) > 0 && totalQuoted > Number(args.tender_budget);

    const result = {
      timestamp,
      source: baseline.source,
      tolerance_ceiling_pct: tolerancePct,
      total_items_audited: auditedItems.length,
      total_quoted_kes: totalQuoted,
      over_allocated_budget: overBudget,
      items: auditedItems,
      variance_summary: {
        price_gouging_count: gougingCount,
        abnormally_low_count: undercuttingCount,
        unbenchmarked_count: unbenchmarkedCount,
        market_conformance:
          gougingCount > 0 || overBudget
            ? "INFLATED_BEYOND_CEILING"
            : undercuttingCount > 0
              ? "ABNORMALLY_LOW_REVIEW"
              : unbenchmarkedCount === auditedItems.length
                ? "UNBENCHMARKED_MANUAL_REVIEW"
                : "COMPLIANT",
      },
    };

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "query_compliance_rulebook") {
    const sectorMode = args.sector_mode === "corporate_rfp" ? "corporate_rfp" : "public_ppada";
    const rules =
      sectorMode === "corporate_rfp"
        ? {
            mode: "corporate_rfp",
            title_en: "Private Corporate RFP & Vendor KYB Governance Rulebook",
            title_sw: "Mwongozo wa Ununuzi wa Kampuni Binafsi na Ukaguzi wa Wauzaji (KYB)",
            allowed_price_variance_pct: 12,
            mandatory_checks: ["KRA Tax Clearance", "BRS Registration", "Beneficial Ownership Screening", "Sanctions & Liability Insurance", "Historical PO Price Benchmark"],
            human_award_invariant_en: "Automated verification prepares the vendor dossier only. Contract award requires Enterprise Procurement Committee approval.",
            human_award_invariant_sw: "Wakala huandaa faili ya tathmini pekee. Uamuzi wa kutoa kandarasi lazima uidhinishwe na Kamati ya Ununuzi ya Kampuni.",
          }
        : {
            mode: "public_ppada",
            title_en: "Republic of Kenya Public Procurement & Asset Disposal Act (PPADA 2015) + OCDS",
            title_sw: "Sheria ya Ununuzi wa Umma na Uuzaji wa Mali ya Kenya (PPADA 2015) + OCDS",
            allowed_price_variance_pct: 15,
            mandatory_checks: ["KRA iTax TCC (s.79)", "BRS Active Standing", "NSSF Clearance (s.48)", "SHA/SHIF Active", "PPRA Debarment Check (s.41)", "AGPO Reservation Verification (Part XII)"],
            human_award_invariant_en: "Per PPADA 2015 Sections 46 & 80, the Evaluation Committee and Accounting Officer hold sole statutory authority to award or disqualify.",
            human_award_invariant_sw: "Kulingana na Sheria ya PPADA 2015 Vifungu 46 na 80, Kamati ya Tathmini na Afisa Mhasibu pekee ndio wenye mamlaka ya kisheria kutoa zabuni.",
          };

    return { content: [{ type: "text", text: JSON.stringify(rules, null, 2) }] };
  }

  if (name === "flag_procurement_disqualification") {
    const pageNum = Number(args.source_page);
    const quote = String(args.evidence_quote || "").trim();
    if (!Number.isFinite(pageNum) || pageNum < 1 || quote.length < 4) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "CITATION_REQUIRED_VIOLATION",
              message: "Zero-Unsourced-Flag Rule: flag_procurement_disqualification refused because source_page (>= 1) and verbatim evidence_quote are mandatory.",
            }),
          },
        ],
      };
    }

    const draftId = `FLAG-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const hashPayload = `${draftId}|${args.tender_number}|${args.bidder_name}|${args.statutory_ground}|p${pageNum}|${timestamp}`;
    const signatureDigest = crypto.createHash("sha256").update(hashPayload).digest("hex");

    const draftedFinding = {
      disqualification_id: draftId,
      created_at: timestamp,
      status: "ADVISORY_DRAFT_PENDING_HUMAN_GATE",
      gate_status: "LOCKED_UNTIL_COMMITTEE_SIGNOFF",
      requires_gate_signoff: true,
      never_auto_disqualified: true,
      tender_number: args.tender_number,
      bid_id: args.bid_id || null,
      bidder_name: args.bidder_name,
      statutory_ground: args.statutory_ground,
      legal_citation: args.legal_citation,
      document_name: args.document_name || "Submitted Bid Dossier",
      source_page: pageNum,
      evidence_quote: quote,
      evidence_summary: args.evidence_summary,
      tamper_evident_digest: signatureDigest,
    };

    return { content: [{ type: "text", text: JSON.stringify(draftedFinding, null, 2) }] };
  }

  if (name === "draft_evaluation_report") {
    const reportId = `TER-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const reportDigest = crypto.createHash("sha256").update(JSON.stringify(args) + timestamp).digest("hex");

    const report = {
      report_id: reportId,
      generated_at: timestamp,
      tender_number: args.tender_number,
      sector_mode: args.sector_mode || "public_ppada",
      never_auto_awarded: true,
      lowest_responsive_candidate_for_review: args.lowest_responsive_candidate || "Pending Committee Review",
      quoted_amount_kes: Number(args.quoted_amount) || 0,
      flagged_entities_for_committee_decision: args.flagged_bidders || [],
      compliance_summary: args.compliance_summary,
      audit_seal: reportDigest,
      gate_status: "AWAITING_COMMITTEE_CHAIR_AND_ACCOUNTING_OFFICER_SIGNOFF",
    };

    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Pulao AI Procurement MCP Server v2.0.0 running on stdio");
}

if (process.argv[1] && process.argv[1].endsWith("index.js")) {
  main().catch((err) => {
    console.error("Fatal MCP server error:", err);
    process.exit(1);
  });
}

export { server };
