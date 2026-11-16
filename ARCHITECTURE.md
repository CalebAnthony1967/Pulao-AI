# ARCHITECTURE.md — Pulao AI Multi-Agent Procurement Oversight Architecture

## 1. System Topology

Pulao AI separates the browser UI cleanly from all AI SDKs, PDF extraction, and MCP stdio child processes behind an Express server (`server.ts`) running on port 3000.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Browser Client (React + Tailwind)                        │
│  • Sector Mode & EN/SW/Auto Context (src/lib/i18n.jsx)                       │
│  • AI Studio SSE Evaluation Console (AuditRunner.jsx) & Thinking Drawer      │
│  • Grounded Citation & Page Inspector (FindingList.jsx)                      │
│  • Streaming Bilingual Assistant (PulaoAssistantDrawer.jsx — zero API keys)  │
│  • Observability, Cost Ledger & Eval Suite Dashboard (AuditVault.jsx)        │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ HTTP POST / Server-Sent Events (SSE)
┌───────────────────────────────▼──────────────────────────────────────────────┐
│                  Express Backend Proxy & Orchestrator (server.ts)            │
│                                                                              │
│  • /api/packets/upload      → Real PDF text/metadata/OCR extraction          │
│  • /api/agent/stream        → 6-Node Cyclic LangGraph StateGraph (SSE)       │
│  • /api/assistant/stream    → Bilingual Gemini 4 Hydrogen / Ollama SSE       │
│  • /api/mcp/call            → Stdio MCP Bridge Manager + Trace Ledger        │
│  • /api/observability/*     → Run Cost (USD/KES) & Tool Trace Persistence    │
│  • /api/evals/*             → Multi-Trial 14×3 Reliability Benchmark API     │
└───────┬───────────────────────────────┬───────────────────────────┬──────────┘
        │ StdioClientTransport          │ StdioClientTransport      │ HTTPS / Local
┌───────▼──────────────────┐   ┌────────▼────────────────┐   ┌──────▼──────────┐
│ Custom MCP Server v2.0.0 │   │ Official Filesystem MCP │   │ Model Backends  │
│ mcp-server/index.js      │   │ @modelcontextprotocol/  │   │ • gemini-4-     │
│                          │   │   server-filesystem     │   │   hydrogen SSE  │
│ • verify_statutory_      │   │   (sandboxed to         │   │ • Local Ollama  │
│   registers              │   │    ./vault_sandbox)     │   │   Llama 3.3     │
│ • benchmark_market_      │   │ • read_text_file        │   │ • Deterministic │
│   pricing                │   │ • list_directory        │   │   Grounded      │
│ • query_compliance_      │   │ • get_file_info         │   │   Fallback      │
│   rulebook               │   └─────────────────────────┘   └─────────────────┘
│ • flag_procurement_      │
│   disqualification (MUT) │
│ • draft_evaluation_      │
│   report (MUT)           │
└──────────────────────────┘
```

---

## 2. 6-Node Cyclic / Conditional LangGraph Orchestrator (`server/multiAgentGraph.ts`)

Instead of a static linear script, the evaluation executes a conditional `@langchain/langgraph` `StateGraph`:

1. **`supervisor_planner`**: Queries `query_compliance_rulebook` (Public PPADA 2015 vs Corporate RFP) and verifies the sandboxed workspace via `@modelcontextprotocol/server-filesystem`, streaming an explicit step-by-step plan (`plan` SSE event).
2. **`intake_and_ocr`**: Runs `pdfjs-dist` extraction (`server/pdfParser.ts`) page-by-page, computes character-density OCR confidence, extracts PDF author/producer/SHA-256 metadata, and runs prompt-injection sanitization (`server/language.ts`).
3. **Conditional Branch → `recovery_handler` OR `specialist_audit`**:
   - If `averageOcrConfidence < 0.55` (skewed or image-only mobile scans), execution routes through `recovery_handler`, blocking automatic statutory disqualification and emitting a non-punitive **Fairness Visual Review** item so rural/SME suppliers are not unfairly penalized.
4. **`specialist_audit`**: Invokes stdio MCP tools (`verify_statutory_registers`, `benchmark_market_pricing`, `flag_procurement_disqualification`) and performs cross-bid collusion analysis (shared beneficial owners, PDF author metadata, SHA-256 collisions).
5. **`citation_guard` (Zero-Unsourced-Flag Rule)**: Validates that every candidate finding holds `document_name`, `page >= 1`, `section`, and a `verbatim_quote` verifiable against the extracted packet or registry response. Any ungrounded claim increments `unverified_claims_suppressed` and is discarded.
6. **`bilingual_drafter_and_gate`**: Calls `draft_evaluation_report` (`never_auto_awarded: true`), streams the English or Kiswahili brief via `streamSynthesis()`, logs exact token/latency/USD/KES telemetry to `server/data/observability_store.json`, and keeps the **Human Committee Sign-Off Gate** armed.

---

## 3. Security, Privacy & Defensibility

- **Zero Browser Keys**: `@google/genai` is imported exclusively inside `server/geminiClient.ts` using `User-Agent: aistudio-build`.
- **Prompt Injection Defense**: Untrusted bid text is scanned and redacted (`[REDACTED_PROMPT_INJECTION_ATTEMPT]`) before reaching LLM prompts, and injection attempts raise a cited `security` finding.
- **Database Schema (`supabase/schema.sql`)**: Includes Row-Level Security (RLS) policies, `organization_rulebooks`, `agent_runs`, and hash-chained PostgreSQL RPCs (`append_audit_log`, `sign_off_evaluation`).
