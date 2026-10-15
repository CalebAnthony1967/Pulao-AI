# Pulao AI — Competition Submission Description

**Project Name:** Pulao AI — Sovereign Autonomous Public Procurement Audit Agent  
**Theme:** Government Integrity, Sovereign AI Agents, & Public Finance Auditing  
**Target Institution:** Public Procurement Regulatory Authority (PPRA), The National Treasury, and Kenya Revenue Authority (Republic of Kenya)  
**Target Workflow:** Statutory Preliminary Evaluation, Market Price Benchmark Auditing, Cartel Collusion Screening, and Human-Gated Committee Award (PPADA 2015 Sections 41, 42, 79, & 131)

---

### Project Overview (~300 Words)

Public procurement in Kenya represents over KES 2.5 trillion annually, yet ministerial evaluation committees remain vulnerable to cartel collusion rings, forged tax certificates, predatory underpricing, and systematic price gouging that inflates public infrastructure costs by 20–40%.

**Pulao AI** is an open-source, sovereign autonomous procurement auditor architected specifically for sovereign public sector workflows. Operating on an open-source LangGraph DAG state machine and standard Model Context Protocol (MCP) servers, Pulao AI ingests Open Contracting Data Standard (OCDS) tenders and supplier bid packets.

The agent coordinates two distinct MCP layers:
1. **A Custom Procurement MCP Server (`pulao-procurement-mcp`)** providing 4 high-assurance tools:
   - `verify_statutory_registers` (read): verifies live KRA Tax Compliance, BRS Company Status, NSSF, SHIF/NHIF contributions, and AGPO affirmative quotas;
   - `benchmark_market_pricing` (read): audits itemised schedules against statutory PPRA median baselines;
   - `flag_procurement_disqualification` (write/mutate): drafts formal, enforceable statutory notices citing legal sections (e.g. PPADA 2015 s.79(1));
   - `draft_evaluation_report` (write/mutate): synthesizes the official statutory evaluation committee dossier.
2. **A Borrowed Official MCP Server (`@modelcontextprotocol/server-filesystem`)** ensuring strict path-sandboxed, canonical access to encrypted bid dossiers and tamper-evident merkle trees.

Crucially, under the Kenya Data Protection Act 2019, sensitive tender packets cannot leave the national boundary. Pulao AI enforces complete **data sovereignty** via local open-weights model execution (**Llama 3.3 70B** on-premises) alongside frontier model benchmarking. 

Every agent action emits an immutable tool log with cryptographic SHA-256 digests. Crucially, every irreversible action—such as disqualifications, tender cancellations, or contract awards—is halted by an enforceable **Human-in-the-Loop Safety Gate**. The agent never awards a tender autonomously: an authenticated Accounting Officer must inspect the evidence dossier and execute a named, timestamped statutory sign-off before records are sealed into the append-only cryptographic audit vault.
