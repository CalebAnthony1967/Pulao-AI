/**
 * Pulao AI — Model Execution Registry (Client Metadata Only)
 * Zero client-side API keys or Gemini SDK imports; all inference executes via server-side proxies (/api/agent/stream & /api/assistant/stream).
 */

export const AVAILABLE_MODELS = [
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen (SSE Thinking)",
    weights: "gemini-4-hydrogen (Server-Side @google/genai)",
    residency: "Server-Side Proxy (Zero Browser Keys · Real-Time Thinking SSE)",
    badge: "Streaming Frontier",
    description:
      "Streams live thinking tokens, structured verification briefs, and exact token/KES cost telemetry via backend proxy.",
  },
  {
    id: "sovereign-llama-3.3",
    name: "Local Sovereign Engine (On-Premises)",
    weights: "Meta Llama 3.3 (Local Ollama / Deterministic Sovereign Kernel)",
    residency: "On-Premises Environment (Zero Cross-Border Egress)",
    badge: "On-Premises",
    description:
      "Executes via local Ollama daemon on localhost:11434 when available, with deterministic evidence-grounded fallback in offline sandboxes.",
  },
];

export async function runProcurementReasoning({
  modelId = "gemini-4-hydrogen",
  tender,
  bid,
  language = "auto",
}) {
  const res = await fetch("/api/assistant/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Analyze bidder ${bid?.bidder_name} (${bid?.registration_number}) for tender ${tender?.tender_number}`,
      language,
      context: { tender, bid, modelId },
    }),
  });
  const text = await res.text();
  return {
    timestamp: new Date().toISOString(),
    model_id: modelId,
    reasoning: text,
  };
}
