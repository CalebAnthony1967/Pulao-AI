/**
 * Pulao AI — Resumable Streaming Multi-Agent Orchestrator Client
 * Consumes Server-Sent Events (SSE) from POST /api/agent/stream and POST /api/agent/resume
 * for the checkpointer-backed @langchain/langgraph StateGraph with native interrupt() gates.
 */

import { pushToolTrace } from "./mcpClient.js";
import { recordAudit } from "./audit.js";
import { saveLocalEvaluation } from "./data.js";
import { supabase } from "./supabase.js";

const graphSubscribers = new Set();
export function subscribeToLangGraph(listener) {
  graphSubscribers.add(listener);
  return () => graphSubscribers.delete(listener);
}

function emitGraphUpdate(update) {
  graphSubscribers.forEach((fn) => {
    try {
      fn(update);
    } catch {}
  });
}

async function persistEvaluations(evaluations = [], bids = [], tender) {
  const bidMap = new Map(bids.map((b) => [b.id, b]));
  for (const ev of evaluations) {
    saveLocalEvaluation(ev);
    try {
      const { parsed_pages: _p, run_id: _r, bid_submissions: _b, ...dbRow } = ev;
      await supabase.from("compliance_evaluations").insert(dbRow);
    } catch {}
    if (!ev.bid_submissions && bidMap.has(ev.bid_id)) {
      ev.bid_submissions = bidMap.get(ev.bid_id);
    }
  }

  await recordAudit({
    action: "Multi-Agent Evaluation Dossier Prepared (Human Gate Locked)",
    tool: "LangGraphMultiAgent",
    input: { tender_number: tender?.tender_number, bids_count: bids.length },
    output: { evaluations: evaluations.length, never_auto_awarded: true },
  }).catch(() => {});
}

async function consumeSseStream(response, onEvent = () => {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload = null;
  let interruptedPayload = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      let eventName = "message";
      let dataStr = "";

      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
      }

      if (!dataStr) continue;
      try {
        const parsed = JSON.parse(dataStr);
        if (eventName === "mcp_call") {
          pushToolTrace(parsed);
        } else if (eventName === "node_event") {
          emitGraphUpdate(parsed);
        } else if (eventName === "human_interrupt") {
          interruptedPayload = parsed;
        } else if (eventName === "complete") {
          finalPayload = parsed;
        } else if (eventName === "error") {
          throw new Error(parsed.message || "Agent execution error");
        }
        onEvent(eventName, parsed);
      } catch (err) {
        if (eventName === "error") throw err;
      }
    }
  }

  return { finalPayload, interruptedPayload };
}

export async function runStreamingMultiAgentPipeline({
  tender,
  bids = [],
  priceIndex = [],
  modelEngine = "gemini-4-hydrogen",
  language = "auto",
  sectorMode,
  onEvent = () => {},
}) {
  const response = await fetch("/api/agent/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tender,
      bids,
      priceIndex,
      modelEngine,
      language,
      sectorMode,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Streaming pipeline failed (HTTP ${response.status})`);
  }

  const { finalPayload, interruptedPayload } = await consumeSseStream(response, onEvent);

  if (interruptedPayload) {
    return { interrupted: true, interrupt: interruptedPayload };
  }

  if (finalPayload?.evaluations) {
    await persistEvaluations(finalPayload.evaluations, bids, tender);
  }

  return finalPayload;
}

export async function resumeStreamingMultiAgentPipeline({
  threadId,
  runId,
  decision = { action: "approve" },
  tender,
  bids = [],
  onEvent = () => {},
}) {
  const response = await fetch("/api/agent/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      thread_id: threadId,
      run_id: runId || threadId,
      decision,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Resume pipeline failed (HTTP ${response.status})`);
  }

  const { finalPayload, interruptedPayload } = await consumeSseStream(response, onEvent);

  if (interruptedPayload) {
    return { interrupted: true, interrupt: interruptedPayload };
  }

  if (finalPayload?.evaluations) {
    await persistEvaluations(finalPayload.evaluations, bids, tender);
  }

  return finalPayload;
}

export async function runLangGraphPipeline({
  tender,
  bids = [],
  priceIndex = [],
  modelEngine = "gemini-4-hydrogen",
  language = "auto",
  sectorMode,
  onProgress = () => {},
}) {
  return runStreamingMultiAgentPipeline({
    tender,
    bids,
    priceIndex,
    modelEngine,
    language,
    sectorMode,
    onEvent: (eventName, data) => {
      if (eventName === "node_event" && data?.label) {
        onProgress(`[${data.node}] ${data.label}`);
      } else if (eventName === "human_interrupt" && data?.title_en) {
        onProgress(`[PAUSED FOR HUMAN APPROVAL] ${data.title_en}`);
      } else if (eventName === "complete") {
        onProgress("Verification dossier prepared and locked at Human Committee Gate.");
      }
    },
  });
}
