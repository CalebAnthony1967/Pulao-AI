# ARCHITECTURE.md — Pulao AI Sovereign Procurement Audit Agent

## 1. System Overview & Agent Shape

Pulao AI is an adversarial, deterministic-grounded compliance and anti-collusion agent for public procurement authorities. It replaces opaque, manual committee evaluations with an auditable, open-source **LangGraph.js** state graph orchestrated across the open **Model Context Protocol (MCP)**.

```
                              ┌────────────────────────────────────────┐
                              │          Tender & Bid Packets          │
                              │     (OCDS Format & PDF Annexures)      │
                              └───────────────────┬────────────────────┘
                                                  │
                                                  ▼
                         ┌─────────────────────────────────────────────────┐
                         │       Open-Source LangGraph Orchestrator        │
                         │             (@langchain/langgraph)              │
                         │                                                 │
                         │  [1. read_packets] ──────────────────────────┐  │
                         │         │                                    │  │
                         │         ▼                                    │  │
                         │  [2. statutory_auditor]                      │  │
                         │         │                                    │  │
                         │         ▼                                    │  │
                         │  [3. pricing_benchmark]                      │  │
                         │         │                                    │  │
                         │         ▼                                    │  │
                         │  [4. collusion_detector]                     │  │
                         │         │                                    │  │
                         │         ▼                                    │  │
                         │  [5. disqualification_drafter] (MUTATING)    │  │
                         │         │                                    │  │
                         │         ▼                                    │  │
                         │  [6. human_gate_checkpoint] ◄── [SAFETY GATE]│  │
                         │         │                                    │  │
                         │         ▼                                    │  │
                         │  [7. report_compiler] (MUTATING)             │  │
                         │         │                                    │  │
                         │         ▼                                    │  │
                         │  [8. audit_vault_commit] ────────────────────┘  │
                         └──────────────┬──────────────────┬───────────────┘
                                        │                  │
                ┌───────────────────────┴──────┐    ┌──────┴──────────────────────┐
                │                              │    │                             │
                ▼                              ▼    ▼                             ▼
   ┌──────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────────┐
   │ Custom MCP Server        │ │ Borrowed Official MCP    │ │ Sovereign Inference      │
   │ pulao-procurement-mcp    │ │ @modelcontextprotocol/   │ │ Llama 3.3 (Open-Weights) │
   │                          │ │ server-filesystem        │ │ Local Air-Gapped Host    │
   │ - statutory_registers    │ │                          │ │                          │
   │ - market_pricing         │ │ - read_tender_dossier    │ │ (Zero foreign cloud      │
   │ - flag_disqualification  │ │ - list_procurement_vault │ │  data egress)            │
   │ - draft_eval_report      │ │ - document_checksum      │ │                          │
   └────────────┬─────────────┘ └────────────┬─────────────┘ └──────────────┬───────────┘
                │                            │                              │
                └────────────────────────────┼──────────────────────────────┘
                                             │
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │    Human-in-the-Loop Irreversible Gate       │
                      │    (Named Human Approver + Statutory Seal)   │
                      └──────────────────────┬───────────────────────┘
                                             │
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │    Immutable Cryptographic Audit Vault       │
                      │    (SHA-256 Merkle Chained Ledger)           │
                      └──────────────────────────────────────────────┘
```

---

## 2. Model Context Protocol (MCP) Topology

### A. Custom MCP Server (`pulao-procurement-mcp`)
Built directly on `@modelcontextprotocol/sdk` (`/mcp-server/index.js`), this server exposes 4 high-assurance procurement tools complying with the JSON-RPC MCP specification:

1. **`verify_statutory_registers` (Read-only):**  
   Adversarially queries official Kenyan public registers: Kenya Revenue Authority (iTax Tax Compliance Certificates), Business Registration Service (BRS corporate status and beneficial ownership), National Social Security Fund (NSSF), Social Health Authority (SHA/SHIF), and AGPO (Access to Government Procurement Opportunities affirmative quotas).
2. **`benchmark_market_pricing` (Read-only):**  
   Maps bidder itemized bills of quantities against the statutory PPRA Quarterly Market Price Index. Calculates variance percentages, flagging predatory underpricing (<30% of median) or unapproved budget gouging (>15% ceiling).
3. **`flag_procurement_disqualification` (Write / Mutate):**  
   *Read-only is not an agent's hands.* This tool actively drafts formal, legally binding Disqualification Notices citing specific statutory provisions under the Public Procurement and Asset Disposal Act 2015 (e.g. PPADA Section 79(1) for preliminary unresponsiveness, Section 41 for debarment, Section 42 for conflicts of interest).
4. **`draft_evaluation_report` (Write / Mutate):**  
   Synthesizes responsive bid rankings into the official statutory Tender Evaluation Committee Report with SHA-256 cryptographic digests.

### B. Borrowed Official MCP Server (`@modelcontextprotocol/server-filesystem`)
Integrated via `@modelcontextprotocol/server-filesystem` for isolated bid packet storage:
> **Why it beats writing it yourself:** Official `@modelcontextprotocol/server-filesystem` beats writing it yourself because it enforces strict directory path sandboxing, canonical path normalization, atomic file descriptor access, and cross-platform symlink escape prevention out of the box.

---

## 3. Open-Source Orchestration (LangGraph.js)

Instead of brittle linear scripts or closed no-code builders, Pulao AI uses `@langchain/langgraph` (`src/lib/langgraphOrchestrator.js`) to model evaluation as a stateful, cyclic directed graph:
- **`ProcurementStateAnnotation`**: Models the comprehensive evaluation context (`tender`, `bids`, `packets`, `statutoryVerdicts`, `pricingVerdicts`, `collusionSignals`, `disqualificationDrafts`, `humanGateStatus`).
- **Graph Nodes**: 8 modular stages with state-channel persistence.
- **Dynamic Routing**: If statutory failures or cartel metadata coordination are detected, the graph branches into `disqualification_drafter` to generate formal charges, then gates on `human_gate_checkpoint`.

---

## 4. Sovereign Open-Weights Model Execution

Under Section 31 of the Kenya Data Protection Act 2019 and public finance procurement statutes, classified bidding packets containing proprietary financial models and statutory certificates cannot be transmitted to offshore foreign cloud providers.

Pulao AI addresses this with **sovereign dual-model execution**:
1. **Sovereign Llama 3.3 (Local On-Premises / Air-Gapped):**  
   Connects to an on-premises Ollama instance (`llama3.3:70b` on `localhost:11434`) or runs via local in-memory deterministic sovereign inference. Guarantees **zero cross-border data egress**.
2. **Frontier Gemini 2.5 Flash:**  
   Mounted side-by-side for non-classified global benchmarking and multi-currency exchange index normalization.
3. **Residency Verification:** The UI prominently certifies data residency: `Republic of Kenya (Air-Gapped Sovereign Execution)`.

---

## 5. Human-in-the-Loop Safety Gate & Irreversible Action Lock

An AI agent must never unilaterally award or disqualify government contracts. Pulao AI enforces a strict cryptographic gate on all irreversible actions:
- **Irreversible Actions:** Disqualification notice issuance, tender cancellation, contract award recommendation, debarment referrals.
- **The Gate:** When `flag_procurement_disqualification` mutates state, the action is marked `DRAFT_PENDING_HUMAN_GATE` and execution is locked.
- **Required Credentials:**
  1. Named Human Approver (e.g., *Dr. Evans Kiprop, Accounting Officer / Committee Chair*).
  2. Designation & Official Staff ID Number.
  3. Statutory Affirmation under Section 176 of PPADA 2015.
  4. Precise timestamp & cryptographic digital seal.
- **Audit Logging:** Every single tool call (inputs, outputs, duration, caller context) is recorded in real time and chained into the tamper-evident append-only ledger (`src/lib/audit.js`) using recursive SHA-256 Merkle hashes.
