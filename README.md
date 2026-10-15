# Pulao AI — Sovereign Autonomous Public Procurement Audit Agent

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![MCP Protocol](https://img.shields.io/badge/MCP-Model_Context_Protocol_1.3-purple.svg)](https://modelcontextprotocol.io)
[![LangGraph](https://img.shields.io/badge/Orchestrator-LangGraph.js-orange.svg)](https://langchain-ai.github.io/langgraphjs/)
[![Sovereign AI](https://img.shields.io/badge/Data_Residency-Kenya_Air--Gapped-green.svg)](#sovereignty)

Pulao AI is an open-source, sovereign autonomous procurement auditor architected specifically for public finance integrity and ministerial tender evaluation under Kenya's **Public Procurement and Asset Disposal Act 2015 (PPADA)**.

It replaces opaque, vulnerable committee evaluations with an auditable, open-source **LangGraph.js** directed state graph orchestrated across the open **Model Context Protocol (MCP)**, backed by cryptographic audit vaults and strict human-in-the-loop safety gating.

---

## ⚡ Quick Start (Run in One Command)

To run the complete application locally:

```bash
npm install && npm run dev
```

Open `http://localhost:3000` (or the port shown in your terminal).

To run the **Custom Procurement MCP Server** directly via stdio:

```bash
npm run mcp
```

---

## 🏆 Competition Criteria Matrix

| Criterion | Specification | Pulao AI Implementation |
|---|---|---|
| **1. Your Own MCP Server** | 3+ tools, at least one that mutates (drafts, files, flags). | **`mcp-server/index.js`** (`pulao-procurement-mcp`):<br>• `verify_statutory_registers` (read)<br>• `benchmark_market_pricing` (read)<br>• `flag_procurement_disqualification` (mutate: drafts formal statutory notice)<br>• `draft_evaluation_report` (mutate: seals committee report) |
| **2. Borrowed MCP Server** | Community/official server with 1-line justification. | **`@modelcontextprotocol/server-filesystem`**:<br>*"Official @modelcontextprotocol/server-filesystem beats writing it yourself because it enforces strict directory path sandboxing, canonical path normalization, atomic file descriptor access, and cross-platform symlink escape prevention out of the box."* |
| **3. Open-Source Orchestrator** | LangGraph, CrewAI, Pydantic AI, smolagents, etc. | **`@langchain/langgraph`** (`src/lib/langgraphOrchestrator.js`): Stateful 8-node cyclic StateGraph with live DAG visualization. |
| **4. Open-Weights Model** | Sovereign task on open-weights model for data residency. | **Sovereign Llama 3.3 (Air-Gapped On-Premises)** (`src/lib/sovereignAgent.js`): Full statutory audit with zero cross-border data egress under Kenya Data Protection Act 2019. |
| **5. Logged Tool Calls & Gates** | Every action logged; gates on irreversible actions with named human approving. | **`McpToolCallLogger.jsx` & `SignOffPanel.jsx`**:<br>• Inputs, outputs, timestamps, and SHA-256 digests.<br>• Irreversible actions (disqualification/award) gated on named Accounting Officer sign-off. |
| **6. OSI-Approved License** | Public repository with standard OSI license. | **Apache License 2.0** (`LICENSE`). |
| **7. Architecture Document** | One page detailing agent shape and MCP servers. | **`ARCHITECTURE.md`**. |
| **8. Evaluation Suite** | 8+ test tasks (Pass/Fail) + 1 documented unfixed failure. | **`EVALS.md`** (9 PASS cases, 1 documented low-DPI OCR failure). |
| **9. Submission Description** | ~300-word text description of workflow & institution. | **`SUBMISSION.md`**. |

---

## 🏛 System Architecture & Workflows

### 1. Model Context Protocol (MCP) Integration
- **Custom MCP Server (`/mcp-server`)**: Built on `@modelcontextprotocol/sdk`. Runs as an independent stdio JSON-RPC process or bridged in-app through `src/lib/mcpClient.js`.
- **Mutating Tools**: Rather than passive read-only lookup, `flag_procurement_disqualification` synthesizes actionable legal instruments citing PPADA 2015 Sections 41, 42, and 79(1).
- **Borrowed Official Server**: Employs `@modelcontextprotocol/server-filesystem` for isolated sandbox storage of tender dossiers and OCDS records.

### 2. LangGraph State Machine (`@langchain/langgraph`)
The audit pipeline executes across 8 interconnected state graph nodes:
1. `read_packets`: Extracts OCR checksums, page boundaries, and schedules.
2. `statutory_auditor`: Queries KRA, BRS, NSSF, SHIF, and AGPO via MCP.
3. `pricing_benchmark`: Audits line items against the PPRA Market Price Index.
4. `collusion_detector`: Scans cross-bidder correlation and PDF author fingerprints.
5. `disqualification_drafter`: Mutating tool drafting enforceable statutory notices.
6. `human_gate_checkpoint`: Locks irreversible decisions behind safety gates.
7. `report_compiler`: Mutating tool assembling the formal Evaluation Committee Report.
8. `audit_vault_commit`: Commits cryptographic Merkle-chained records to permanent storage.

### 3. Sovereign Open-Weights Model Execution
Under Section 31 of the Kenya Data Protection Act 2019, sensitive tender dossiers containing proprietary intellectual property cannot leave sovereign borders.
Pulao AI features a built-in **Sovereignty Switcher**:
- **Sovereign Llama 3.3 (Air-Gapped Local Host)**: Zero foreign cloud telemetry; processed on-premises.
- **Frontier Cloud Gemini 2.5 Flash**: Mounted alongside for non-classified global benchmarking.

### 4. Human-in-the-Loop Safety Gate
Autonomous AI agents must never unilaterally award or disqualify public tenders. Irreversible mutations trigger a visual **Safety Gate** requiring:
- Designated Official Name (e.g. *Dr. Evans Kiprop, Accounting Officer / Committee Chair*)
- Official Role & Staff/National ID Number
- Statutory Affirmation under Section 176 of PPADA 2015
- Timestamp & cryptographic SHA-256 seal

---

## 📂 Repository Structure

```
├── ARCHITECTURE.md          # Complete 1-page architecture document
├── EVALS.md                 # 10 test evaluations (9 pass, 1 documented failure)
├── SUBMISSION.md            # 300-word institutional submission text
├── LICENSE                  # Apache 2.0 OSI-approved license
├── README.md                # One-command quick start and manual
├── package.json             # Scripts and dependencies
├── mcp-server/              # Custom Procurement MCP Server
│   └── index.js             # Standalone MCP stdio server (@modelcontextprotocol/sdk)
└── src/
    ├── components/
    │   ├── bids/            # Quotation & LineItemsEditor components
    │   ├── evaluation/      # LangGraph runner, Matrix, McpToolCallLogger, SignOffPanel
    │   └── vault/           # Tamper-evident VaultTable with Merkle chain integrity
    ├── lib/
    │   ├── mcpClient.js     # Universal MCP Client (Custom & Borrowed servers)
    │   ├── langgraphOrchestrator.js # LangGraph StateGraph pipeline
    │   ├── sovereignAgent.js# Sovereign Llama 3.3 vs Frontier Gemini execution
    │   ├── audit.js         # SHA-256 chained tamper-evident vault logger
    │   └── data.js          # Resilient storage and Supabase sync
    └── pages/
        ├── AuthPortal.jsx   # Role-based portal selector & auth
        ├── SupplierPortal.jsx# Bid submission & status tracking
        ├── SelfAudit.jsx    # Pre-submission dry run with live MCP inspector
        ├── CommitteePortal.jsx# Tender portfolio & evaluation pipeline
        ├── EvaluationWorkspace.jsx# Full LangGraph & MCP evaluation workbench
        └── AuditVault.jsx   # Super admin permanent immutable ledger
```

---

## 📜 Portals & User Roles

- **Supplier Desk (`/supplier`)**: Lodge bids with itemised deliverable quotations and document annexures.
- **Pre-Submission Self-Audit (`/supplier/self-audit`)**: Private dry run against statutory registers and price indices before lodgement.
- **Committee Evaluation Workspace (`/committee/tender/:id`)**: Execute the LangGraph multi-step audit, inspect live MCP tool calls, review cross-bidder collusion rings, and execute the Human-in-the-Loop sign-off gate.
- **Permanent Audit Vault (`/vault`)**: Cryptographic Merkle-tree ledger with automated chain integrity verification.

---

## ⚖️ License

Licensed under the **Apache License, Version 2.0**. See [`LICENSE`](LICENSE) for details.
