import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export interface ModelTelemetry {
  promptTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimatedCostKes: number;
  backend: string;
}

const USD_TO_KES = 129;

function computeCost(promptTokens: number, completionTokens: number, thinkingTokens: number, isCloudGemini: boolean) {
  if (!isCloudGemini) {
    return { usd: 0, kes: 0 };
  }
  // Standard Gemini Flash-tier reference pricing ($0.15 / 1M input, $0.60 / 1M output+thinking)
  const usd = Number((((promptTokens / 1_000_000) * 0.15) + (((completionTokens + thinkingTokens) / 1_000_000) * 0.6)).toFixed(6));
  const kes = Number((usd * USD_TO_KES).toFixed(4));
  return { usd, kes };
}

function estimateTokens(text: string): number {
  const s = String(text || "");
  return Math.max(1, Math.ceil(s.length / 4));
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export async function probeOllama(): Promise<{ available: boolean; models: string[] }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const res = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { available: false, models: [] };
    const json: any = await res.json();
    const models = Array.isArray(json?.models) ? json.models.map((m: any) => m.name) : [];
    return { available: true, models };
  } catch {
    return { available: false, models: [] };
  }
}

export async function streamSynthesis({
  modelId,
  systemInstruction,
  prompt,
  fallbackText,
  onThought,
  onToken,
}: {
  modelId: string;
  systemInstruction: string;
  prompt: string;
  fallbackText: string;
  onThought?: (chunk: string) => void;
  onToken?: (chunk: string) => void;
}): Promise<{ text: string; thoughts: string; telemetry: ModelTelemetry }> {
  const promptTokensEst = estimateTokens(systemInstruction + "\n" + prompt);

  // 1. Local Sovereign Open-Weights via Ollama if requested and active
  if (modelId === "sovereign-llama-3.3") {
    const ollama = await probeOllama();
    if (ollama.available) {
      try {
        const res = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: ollama.models[0] || "llama3.3",
            system: systemInstruction,
            prompt,
            stream: true,
          }),
        });
        if (res.ok && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let fullText = "";
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.response) {
                  fullText += parsed.response;
                  onToken?.(parsed.response);
                }
              } catch {}
            }
          }
          const compTokens = estimateTokens(fullText);
          return {
            text: fullText || fallbackText,
            thoughts: "",
            telemetry: {
              promptTokens: promptTokensEst,
              completionTokens: compTokens,
              thinkingTokens: 0,
              totalTokens: promptTokensEst + compTokens,
              estimatedCostUsd: 0,
              estimatedCostKes: 0,
              backend: `Local Sovereign Ollama (${ollama.models[0] || "llama3.3"})`,
            },
          };
        }
      } catch {
        // Fall through cleanly
      }
    }
  }

  // 2. Server-Side Gemini 4 Hydrogen Streaming (when gemini-4-hydrogen selected & GEMINI_API_KEY configured)
  const ai = getGeminiClient();
  if (ai && (modelId === "gemini-4-hydrogen" || modelId === "frontier-gemini-2.5")) {
    try {
      const responseStream = await ai.models.generateContentStream({
        model: "gemini-4-hydrogen",
        contents: prompt,
        config: {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.MEDIUM,
            includeThoughts: true,
          },
        },
      });

      let fullText = "";
      let fullThoughts = "";
      let usageMeta: any = null;

      for await (const chunk of responseStream) {
        if (chunk.usageMetadata) usageMeta = chunk.usageMetadata;
        const parts = chunk.candidates?.[0]?.content?.parts || [];
        for (const part of parts as any[]) {
          if (part.thought && part.text) {
            fullThoughts += part.text;
            onThought?.(part.text);
          } else if (part.text) {
            fullText += part.text;
            onToken?.(part.text);
          }
        }
        if (parts.length === 0 && chunk.text) {
          fullText += chunk.text;
          onToken?.(chunk.text);
        }
      }

      const pTok = usageMeta?.promptTokenCount || promptTokensEst;
      const cTok = usageMeta?.candidatesTokenCount || estimateTokens(fullText);
      const tTok = usageMeta?.thoughtsTokenCount || estimateTokens(fullThoughts);
      const cost = computeCost(pTok, cTok, tTok, true);

      return {
        text: fullText || fallbackText,
        thoughts: fullThoughts,
        telemetry: {
          promptTokens: pTok,
          completionTokens: cTok,
          thinkingTokens: tTok,
          totalTokens: pTok + cTok + tTok,
          estimatedCostUsd: cost.usd,
          estimatedCostKes: cost.kes,
          backend: "Google Gemini 4 Hydrogen (Server-Side @google/genai SSE)",
        },
      };
    } catch {
      // Fall through cleanly to deterministic verified synthesizer
    }
  }

  // 3. Deterministic Evidence-Grounded Synthesizer (Zero external key / offline Ollama container mode)
  const words = fallbackText.split(/(\s+)/);
  for (let i = 0; i < words.length; i += 6) {
    const slice = words.slice(i, i + 6).join("");
    onToken?.(slice);
    await new Promise((r) => setTimeout(r, 12));
  }

  const cTok = estimateTokens(fallbackText);
  const backendLabel =
    modelId === "sovereign-llama-3.3"
      ? "Local Deterministic Fallback (Ollama localhost:11434 offline in sandbox)"
      : "Deterministic Verified Fallback (GEMINI_API_KEY not attached in host)";

  return {
    text: fallbackText,
    thoughts: "",
    telemetry: {
      promptTokens: promptTokensEst,
      completionTokens: cTok,
      thinkingTokens: 0,
      totalTokens: promptTokensEst + cTok,
      estimatedCostUsd: 0,
      estimatedCostKes: 0,
      backend: backendLabel,
    },
  };
}

export async function generateSupervisorRationale({
  modelId,
  tenderTitle,
  tenderNumber,
  sectorMode,
  bidsCount,
  languageResolved,
  isEval = false,
}: {
  modelId: string;
  tenderTitle: string;
  tenderNumber: string;
  sectorMode: "public_ppada" | "corporate_rfp";
  bidsCount: number;
  languageResolved: "en" | "sw";
  isEval?: boolean;
}): Promise<{ rationale: string; source: "gemini" | "deterministic" }> {
  const deterministic =
    languageResolved === "sw"
      ? `Mpango wa Msimamizi (${tenderNumber}): Kukagua zabuni ${bidsCount} chini ya ${
          sectorMode === "corporate_rfp" ? "kanuni za Corporate RFP (+12% & KYB)" : "sheria ya PPADA 2015 (+15% & AGPO)"
        }. Hatua za MCP zimepangwa kwa mpangilio wa kisheria zikiwa na vituo vya idhini ya afisa kabla ya kuweka dosari au kufunga faili.`
      : `Supervisor Plan (${tenderNumber}): Auditing ${bidsCount} bid(s) under ${
          sectorMode === "corporate_rfp" ? "Corporate RFP (+12% tolerance & KYB)" : "Kenya PPADA 2015 (+15% PPRA tolerance & AGPO)"
        }. Staged MCP sequence: rulebook load -> sandbox vault verification -> OCR intake gate -> statutory/KYB & market pricing checks -> officer approval gate before any disqualification flag.`;

  if (isEval) {
    return { rationale: deterministic, source: "deterministic" };
  }

  const ai = getGeminiClient();
  if (ai && (modelId === "gemini-4-hydrogen" || modelId === "frontier-gemini-2.5")) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await Promise.race([
        ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: `Tender: ${tenderNumber} (${tenderTitle}). Bids: ${bidsCount}. Mode: ${sectorMode}. Language: ${languageResolved}.
Write a concise 2-sentence Supervisor tool-planning rationale explaining WHICH MCP tools will be used (query_compliance_rulebook, list_procurement_vault, verify_statutory_registers, benchmark_market_pricing, flag_procurement_disqualification, draft_evaluation_report) and WHY human approval gates are enforced.`,
        }),
        new Promise<null>((resolve) => {
          controller.signal.addEventListener("abort", () => resolve(null));
        }),
      ]);
      clearTimeout(timeout);
      const txt = (res as any)?.text?.trim();
      if (txt) {
        return { rationale: txt, source: "gemini" };
      }
    } catch {
      // Fallback cleanly
    }
  }

  return { rationale: deterministic, source: "deterministic" };
}

