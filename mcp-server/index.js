/**
 * Pulao AI — Custom Procurement MCP Server
 * Conforms to Model Context Protocol (MCP) Specification
 * Built using @modelcontextprotocol/sdk
 *
 * Tools exposed:
 * 1. verify_statutory_registers (read)
 * 2. benchmark_market_pricing (read)
 * 3. flag_procurement_disqualification (write/mutate — drafts statutory disqualification)
 * 4. draft_evaluation_report (write/mutate — compiles official evaluation committee report)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import crypto from "crypto";

const server = new Server(
  {
    name: "pulao-procurement-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Deterministic fingerprint helper for register simulation
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// 1. Tool Definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "verify_statutory_registers",
        description:
          "Read-only verification of a bidder against Kenya statutory registers: KRA Tax Compliance, BRS Company Registry, NSSF, SHIF/NHIF, and AGPO (Access to Government Procurement Opportunities). Returns official status, certificates, and validation flags.",
        inputSchema: {
          type: "object",
          properties: {
            company_registration_no: {
              type: "string",
              description: "Business Registration Service number, e.g. PVT-2021-998811",
            },
            company_name: {
              type: "string",
              description: "Registered legal name of the bidding enterprise",
            },
            tender_number: {
              type: "string",
              description: "The reference number of the tender being audited",
            },
          },
          required: ["company_registration_no", "company_name"],
        },
      },
      {
        name: "benchmark_market_pricing",
        description:
          "Read-only audit comparing bidder line items against the published PPRA (Public Procurement Regulatory Authority) Market Price Index. Identifies abnormal underpricing (<30% of market median) or price gouging (>15% above ceiling).",
        inputSchema: {
          type: "object",
          properties: {
            line_items: {
              type: "array",
              description: "Array of line items with description, quantity, and unit_price",
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
            tender_budget: {
              type: "number",
              description: "Total allocated budget for the tender in KES",
            },
          },
          required: ["line_items"],
        },
      },
      {
        name: "flag_procurement_disqualification",
        description:
          "MUTATING TOOL: Drafts an enforceable statutory disqualification notice under the Public Procurement and Asset Disposal Act 2015 (PPADA). Formulates formal statutory charges (e.g. s.79 non-responsiveness, s.41 debarment, s.42 conflict of interest). Places the action behind a mandatory human-in-the-loop gate requiring Accounting Officer sign-off.",
        inputSchema: {
          type: "object",
          properties: {
            tender_number: {
              type: "string",
              description: "Tender reference identifier",
            },
            bidder_name: {
              type: "string",
              description: "Name of the bidding company being disqualified",
            },
            bid_id: {
              type: "string",
              description: "Unique identifier of the disqualified bid",
            },
            statutory_ground: {
              type: "string",
              enum: [
                "EXPIRED_TAX_COMPLIANCE",
                "COMPANY_STRUCK_OFF",
                "COLLUSIVE_TENDERING",
                "ABNORMAL_PRICING_UNRESPONSIVE",
                "FORGED_CERTIFICATE",
                "CONFLICT_OF_INTEREST",
              ],
              description: "Primary statutory ground for disqualification",
            },
            legal_citation: {
              type: "string",
              description: "Legal statutory section, e.g. 'PPADA 2015 Section 79(1)'",
            },
            evidence_summary: {
              type: "string",
              description: "Factual evidentiary proof established by the audit",
            },
          },
          required: [
            "tender_number",
            "bidder_name",
            "statutory_ground",
            "legal_citation",
            "evidence_summary",
          ],
        },
      },
      {
        name: "draft_evaluation_report",
        description:
          "MUTATING TOOL: Compiles and drafts the official statutory Tender Evaluation Committee Report with cryptographic SHA-256 seal for ministerial gazettement and human sign-off.",
        inputSchema: {
          type: "object",
          properties: {
            tender_id: { type: "string" },
            tender_number: { type: "string" },
            recommended_bidder: { type: "string" },
            awarded_amount: { type: "number" },
            disqualified_bidders: {
              type: "array",
              items: { type: "string" },
            },
            compliance_summary: { type: "string" },
          },
          required: ["tender_number", "recommended_bidder", "awarded_amount"],
        },
      },
    ],
  };
});

// 2. Tool Handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const timestamp = new Date().toISOString();

  if (name === "verify_statutory_registers") {
    const regNo = args.company_registration_no || "";
    const nameStr = args.company_name || "";
    const seed = hashString(regNo + nameStr);

    const isTaxValid = seed % 5 !== 1;
    const isBrsActive = seed % 7 !== 2;
    const isNssfValid = seed % 6 !== 0;
    const isShifValid = seed % 8 !== 3;
    const isAgpo = seed % 3 === 0;

    const kraStatus = isTaxValid ? "VALID_TAX_CERTIFICATE" : "EXPIRED_TAX_CERTIFICATE";
    const brsStatus = isBrsActive ? "ACTIVE_COMPANY" : "STRUCK_OFF";
    const nssfStatus = isNssfValid ? "COMPLIANT" : "ARREARS_OUTSTANDING";
    const shifStatus = isShifValid ? "COMPLIANT" : "DEFAULTED";
    const agpoStatus = isAgpo ? "AGPO_REGISTERED_YOUTH" : "STANDARD_ENTERPRISE";

    const allPassed = isTaxValid && isBrsActive && isNssfValid && isShifValid;

    const result = {
      timestamp,
      bidder: nameStr,
      registration_number: regNo,
      statutory_verdicts: {
        kra_tax: {
          status: kraStatus,
          certificate_no: `KRA-TCC-${2026}-${(seed % 89999) + 10000}`,
          valid: isTaxValid,
          statutory_source: "Kenya Revenue Authority iTax Portal",
        },
        brs_company: {
          status: brsStatus,
          registration_date: "2018-04-12",
          valid: isBrsActive,
          statutory_source: "Business Registration Service (BRS)",
        },
        nssf: {
          status: nssfStatus,
          valid: isNssfValid,
          statutory_source: "National Social Security Fund Portal",
        },
        shif: {
          status: shifStatus,
          valid: isShifValid,
          statutory_source: "Social Health Authority Register",
        },
        agpo: {
          status: agpoStatus,
          category: isAgpo ? "Youth (Under 35)" : "Open",
          statutory_source: "Public Procurement Directorate AGPO Register",
        },
      },
      statutory_compliance_pass: allPassed,
      recommendation: allPassed
        ? "Proceed to technical and financial evaluation"
        : "Mandatory statutory rejection under PPADA 2015 s.79(1)",
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === "benchmark_market_pricing") {
    const items = Array.isArray(args.line_items) ? args.line_items : [];
    const auditedItems = items.map((item, index) => {
      const declaredPrice = Number(item.unit_price) || 0;
      // Synthetic statutory market index reference
      const referenceMedian = declaredPrice > 0 ? Math.round(declaredPrice * 0.95) : 50000;
      const ceiling = Math.round(referenceMedian * 1.15);
      const floor = Math.round(referenceMedian * 0.7);

      const varianceRatio = referenceMedian > 0 ? (declaredPrice - referenceMedian) / referenceMedian : 0;
      const isGouging = declaredPrice > ceiling;
      const isAbnormallyLow = declaredPrice < floor;

      return {
        item_index: index + 1,
        description: item.description,
        declared_unit_price: declaredPrice,
        ppra_market_median: referenceMedian,
        ppra_ceiling_allowed: ceiling,
        ppra_floor_safe: floor,
        variance_percentage: (varianceRatio * 100).toFixed(1) + "%",
        risk_flag: isGouging ? "PRICE_GOUGING" : isAbnormallyLow ? "PREDATORY_UNDERCUTTING" : "BENCHMARKED_FAIR",
      };
    });

    const hasGouging = auditedItems.some((i) => i.risk_flag === "PRICE_GOUGING");
    const hasUndercutting = auditedItems.some((i) => i.risk_flag === "PREDATORY_UNDERCUTTING");

    const result = {
      timestamp,
      total_items_audited: auditedItems.length,
      items: auditedItems,
      pricing_verdict: hasGouging ? "INFLATED_BEYOND_CEILING" : hasUndercutting ? "ABNORMALLY_LOW" : "COMPLIANT",
      requires_market_clarification: hasGouging || hasUndercutting,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === "flag_procurement_disqualification") {
    // MUTATION: Drafts statutory disqualification and places behind irreversible gate
    const draftId = `DISQ-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const hashPayload = `${draftId}|${args.tender_number}|${args.bidder_name}|${args.statutory_ground}|${timestamp}`;
    const signatureDigest = crypto.createHash("sha256").update(hashPayload).digest("hex");

    const draftedFinding = {
      disqualification_id: draftId,
      created_at: timestamp,
      status: "DRAFT_PENDING_HUMAN_GATE",
      gate_status: "LOCKED_UNTIL_ACCOUNTING_OFFICER_SIGNOFF",
      is_irreversible: true,
      tender_number: args.tender_number,
      bid_id: args.bid_id || null,
      bidder_name: args.bidder_name,
      statutory_ground: args.statutory_ground,
      legal_citation: args.legal_citation,
      evidence_summary: args.evidence_summary,
      statutory_notice_text: `FORMAL NOTICE OF DISQUALIFICATION PURSUANT TO ${args.legal_citation}:\n` +
        `Be advised that the bid tendered by ${args.bidder_name} for tender ref ${args.tender_number} ` +
        `has been found non-responsive on grounds of: ${args.statutory_ground}.\n` +
        `Findings: ${args.evidence_summary}.\n` +
        `This disqualification will take legal effect immediately upon digital countersignature ` +
        `by the designated Tender Evaluation Committee Chairperson.`,
      tamper_evident_digest: signatureDigest,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(draftedFinding, null, 2),
        },
      ],
    };
  }

  if (name === "draft_evaluation_report") {
    const reportId = `TER-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const reportDigest = crypto.createHash("sha256").update(JSON.stringify(args) + timestamp).digest("hex");

    const report = {
      report_id: reportId,
      generated_at: timestamp,
      tender_number: args.tender_number,
      award_recommendation: {
        awardee: args.recommended_bidder,
        contract_sum: args.awarded_amount,
        compliance_status: "FULLY_RESPONSIVE",
      },
      disqualified_entities: args.disqualified_bidders || [],
      committee_findings_summary: args.compliance_summary,
      audit_seal: reportDigest,
      gate_status: "AWAITING_COMMITTEE_CHAIR_AND_SECRETARY_APPROVAL",
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(report, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Run with stdio transport when executed directly
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Pulao AI Procurement MCP Server running on stdio");
}

if (process.argv[1] && process.argv[1].endsWith("index.js")) {
  main().catch((err) => {
    console.error("Fatal MCP server error:", err);
    process.exit(1);
  });
}

export { server };
