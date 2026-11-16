import { runStreamingMultiAgentPipeline } from "./langgraphOrchestrator.js";

export const TOOL = {
  parse: "parse_tender_packet",
  statutory: "verify_statutory_registers",
  pricing: "benchmark_market_pricing",
  collusion: "detect_collusion_patterns",
  citation: "verify_citation_existence",
};

/**
 * Legacy-compatible entrypoint delegated directly to the server-side
 * 6-node cyclic LangGraph + real stdio MCP verification pipeline.
 * Ensures zero hash-modulo tricks and enforces Zero-Unsourced-Flag citations.
 */
export async function runAuditPipeline({ tender, bids = [], priceIndex = [], onProgress = () => {} }) {
  onProgress("Submitting bid dossier to multi-agent verification pipeline...");
  const result = await runStreamingMultiAgentPipeline({
    tender,
    bids,
    priceIndex,
    modelEngine: "gemini-4-hydrogen",
    language: "auto",
    onEvent: (eventName, data) => {
      if (eventName === "node_event" && data?.label) {
        onProgress(data.label);
      }
    },
  });
  return {
    evaluations: result?.evaluations || [],
    collusion: result?.collusion_signals || [],
  };
}
