# Pulao AI — Competition Submission & 3-Minute Demo Script

**Project Name:** Pulao AI — Multi-Agent Procurement & Corporate Bid Oversight Platform  
**Target Institutions:**  
1. **Public Sector:** Kenyan & African Tender Evaluation Committees (PPRA / County & Ministerial Committees under PPADA 2015 & OCDS).  
2. **Private Corporate:** Enterprise Procurement, Internal Audit & Vendor KYB Committees (banks, telcos, NGOs, manufacturers).

---

## Project Overview (~300 Words)

Public procurement in Kenya exceeds KES 2.5 trillion annually, while private African enterprises routinely lose 10–25% of addressable spend to price inflation, shell-company bid rotation, and undocumented vendor exceptions. Yet evaluation committees still review hundreds of PDF pages manually.

**Pulao AI** is an open-source multi-agent pre-audit workbench built with **LangGraph (`@langchain/langgraph`)**, real **stdio Model Context Protocol (`@modelcontextprotocol/sdk`)** servers, **pdfjs-dist**, and server-side **`gemini-4-hydrogen`** streaming (alongside a local on-premises Llama 3.3 Ollama adapter).

Two strict invariants govern the entire system:
1. **The agent prepares the file; it never awards the tender.** Disqualification drafts and award recommendations remain locked behind a named Human Committee Sign-Off Gate.
2. **Zero unsourced flags.** Every adverse finding must pass a `citation_guard` node verifying `document_name`, `page >= 1`, `section`, and a `verbatim_quote`.

The platform runs across two distinct stdio MCP servers: our custom `pulao-procurement-mcp` (`verify_statutory_registers`, `benchmark_market_pricing`, `query_compliance_rulebook`, `flag_procurement_disqualification`, `draft_evaluation_report`) and the official `@modelcontextprotocol/server-filesystem` sandboxed to `./vault_sandbox`. It supports **English and Kiswahili** (*Auto-Detect / EN / SW*) and switches cleanly between **Public PPADA 2015** (+15% market ceiling) and **Private Corporate RFP / KYB** (+12% ceiling, insurance & beneficial ownership checks). An executable 42-run multi-trial eval suite (`npm run eval`) achieved 100% pass rate, 100% run-to-run consistency, and zero citation or auto-award violations.

---

## 3-Minute Competition Demo Script (Including Failure & Escalation Cases)

- **0:00–0:45 — Bilingual Console & Live Streaming Audit (`EvaluationWorkspace.jsx`)**  
  Show the Committee Evaluation Room. Toggle language (**Auto / EN / Kiswahili**) and Governance Mode (**PPADA 2015 vs Corporate RFP**). Click **Run Evaluation Workflow** to stream the 6-node cyclic LangGraph plan, collapsible thinking trace, stdio MCP tool invocations, bilingual brief, and live token/USD/KES cost counter.
- **0:45–1:40 — Zero-Unsourced-Flag Citation Inspector & Human Gate (`FindingList.jsx` & `SignOffPanel.jsx`)**  
  Click **Inspect Source Page** on a flagged finding to prove every alert cites `document_name`, `page`, and `verbatim_quote`. Show that the Committee Sign-Off button stays locked until every finding is upheld or overridden with a written 20-character rationale by a named officer.
- **1:40–2:30 — Where the Agent Intentionally Escalates / Refuses (`AuditVault.jsx` & `evals/results.json`)**  
  Walk through `ObservabilityEvalPanel` inside `/vault`, highlighting two real failure/limitation scenarios verified in the 42-run benchmark:
  - **`eval_14_low_dpi_scan_fairness_escalation`**: When an SME uploads a blurry low-character scan, `intake_and_ocr` routes to the conditional `recovery_handler` branch instead of hallucinating or auto-disqualifying.
  - **`eval_11` & `eval_12`**: Unknown registration numbers escalate to `UNVERIFIED_MANUAL_CHECK` instead of guessing, and PDF prompt injections (`"IGNORE PREVIOUS INSTRUCTIONS"`) are redacted and logged without bypassing the gate.
- **2:30–3:00 — Bilingual Oversight Assistant & Commercial Path (`PulaoAssistantDrawer.jsx`)**  
  Ask a question in Kiswahili (*"Kwa nini mzabuni huyu ameonyeshwa dosari?"*) and watch the server-side SSE proxy auto-detect Kiswahili and stream an evidence-cited reply.
