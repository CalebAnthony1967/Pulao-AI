# Pulao AI — Multi-Agent Procurement & Corporate Bid Oversight Platform

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![MCP Protocol](https://img.shields.io/badge/MCP-Stdio_SDK_v2-purple.svg)](https://modelcontextprotocol.io)
[![LangGraph](https://img.shields.io/badge/Orchestrator-LangGraph.js_Cyclic-orange.svg)](https://langchain-ai.github.io/langgraphjs/)
[![Languages](https://img.shields.io/badge/Context-Kenya_EN_%2F_Kiswahili-green.svg)](#bilingual-african-context)

**Pulao AI** is an open-source, multi-agent procurement pre-audit and bid verification platform built for public-sector Tender Evaluation Committees (Kenya PPADA 2015 / OCDS) and Private Corporate RFP & Vendor KYB Governance Teams.

> **Non-Negotiable Legal Invariant:** Pulao AI **prepares and verifies the evaluation dossier only — it never awards a tender or finalizes a disqualification.** Procurement statutes across Africa vest that authority strictly in a named Human Evaluation Committee and Accounting Officer.
> **Zero-Unsourced-Flag Rule:** Every risk flag must cite `document_name`, `page` ($\ge 1$), `section`, and a `verbatim_quote` verified against extracted evidence. Any ungrounded claim is suppressed by the `citation_guard` node before reaching reviewers.

---

## Quick Start (Clone & Run)

```bash
cp .env.example .env.local
npm install
npm run dev
```

- Open `http://localhost:3000` (Express + Vite full-stack server).
- Run the **42-run multi-trial reliability evaluation suite**:
  ```bash
  npm run eval
  ```
- Run the **Custom Procurement MCP Server** standalone over stdio:
  ```bash
  npm run mcp
  ```

---

## Honest Disclosure: What Is Real vs. What Is Simulated

To uphold open-source rigour, we state the exact implementation boundary clearly:

| Component | Real / Live Implementation | Simulated / Host-Dependent Boundary |
|---|---|---|
| **Orchestrator (`server/multiAgentGraph.ts`)** | Real 6-node cyclic/conditional `@langchain/langgraph` `StateGraph` with SSE streaming & low-OCR recovery routing. | — |
| **MCP Transports (`server/mcpManager.ts`)** | Real `@modelcontextprotocol/sdk` `StdioClientTransport` spawning both `mcp-server/index.js` and `@modelcontextprotocol/server-filesystem` (`./vault_sandbox`). | — |
| **PDF Ingestion (`server/pdfParser.ts`)** | Real page-by-page extraction, metadata/SHA-256 fingerprinting, OCR character-density confidence scoring, and prompt-injection sanitization via `pdfjs-dist`. | Skewed mobile-photo image-only scans (<55% OCR confidence) escalate to human visual review rather than claiming cloud vision OCR. |
| **Statutory Registers (`server/data/statutory_registers.json`)** | Structured JSON register lookup supporting known test entities, PPRA debarment, beneficial owners, and honest `UNVERIFIED_MANUAL_CHECK` escalation for unknown IDs. | **Simulated snapshot** (`adapter_mode: "simulated_register_db"`). Live Kenya KRA iTax, BRS e-Citizen, NSSF, and SHA APIs require institutional mutual-TLS credentials not bundled in public open-source repos. |
| **Market Pricing (`server/data/ppra_price_index.json`)** | Real token-overlap matching against caller `price_index` and PPRA Q2 2026 baseline rates; flags gouging, undercutting, and unbenchmarked items (`UNBENCHMARKED_MANUAL_REVIEW`). | Baseline contains 9 representative categories; specialized unindexed equipment routes honestly to manual market quote review. |
| **AI Synthesis & Thinking (`server/geminiClient.ts`)** | Server-side `@google/genai` (`gemini-4-hydrogen` with `ThinkingLevel.MEDIUM` & `includeThoughts: true`) + local Ollama `localhost:11434` probe over SSE, with exact token & USD/KES cost metering. | Falls back transparently to a deterministic evidence-grounded synthesizer when neither `GEMINI_API_KEY` nor a local Ollama daemon is attached in the host. |
| **Database (`supabase/schema.sql`)** | Full PostgreSQL schema, RLS policies, and hash-chained `append_audit_log` / `sign_off_evaluation` RPCs with resilient localStorage mirror for offline sandbox demos. | — |

---

## Architecture & Competition Criteria Highlights

- **1. Custom MCP Server (`mcp-server/index.js`, `pulao-procurement-mcp` v2.0.0):** 5 stdio JSON-RPC tools:
  - `verify_statutory_registers` (read)
  - `benchmark_market_pricing` (read)
  - `query_compliance_rulebook` (read — Public PPADA 2015 vs Corporate RFP)
  - `flag_procurement_disqualification` (write/mutate — refuses without `source_page >= 1` & `evidence_quote`; locks behind human gate)
  - `draft_evaluation_report` (write/mutate — sets `never_auto_awarded: true` with SHA-256 seal)
- **2. Borrowed Official MCP Server (`@modelcontextprotocol/server-filesystem`):** Sandboxed to `./vault_sandbox` for path-canonical, symlink-safe tender dossier and manifest access.
- **3. Streaming AI Studio-Style Evaluation Console (`AuditRunner.jsx` & `PulaoAssistantDrawer.jsx`):** Streams Supervisor plans, model thinking traces, live node states, token-by-token English/Kiswahili briefs, and exact USD/KES costs via Server-Sent Events (`/api/agent/stream` & `/api/assistant/stream`).
- **4. Bilingual African Context (`server/language.ts`, `src/lib/i18n.jsx`):** Users toggle **Auto-Detect**, **English**, or **Kiswahili** (*Zabuni, Kamati ya Tathmini, Cheti cha Ushuru*). Auto-Detect detects Kiswahili prompts and bid schedules automatically.
- **5. Dual-Sector Governance Mode:** Switchable between **Public Sector (Kenya PPADA 2015 / OCDS, +15% ceiling)** and **Private Corporate (RFP / Vendor KYB, +12% ceiling, insurance & beneficial ownership screening)**.

---

## Empirical Evaluation Summary (`npm run eval`)

Latest recorded run (`evals/results.json` across **14 scenarios × 3 trials = 42 runs**):
- **Pass Rate:** `100%` (`42 / 42`)
- **Run-to-Run Consistency:** `100%`
- **Unsourced Citation Violations:** `0`
- **Autonomous Award Gate Violations:** `0`
- **End-to-End Latency:** `p50 = 395 ms`, `p95 = 475 ms`

See [`EVALS.md`](EVALS.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`SUBMISSION.md`](SUBMISSION.md) (including the 3-minute live demo script).

---

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
