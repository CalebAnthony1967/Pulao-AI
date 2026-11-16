import React, { useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Coins,
  Loader2,
  PauseCircle,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSession } from "@/lib/session";
import { useI18n } from "@/lib/i18n";
import { pushToolTrace } from "@/lib/mcpClient.js";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export default function PulaoAssistantDrawer() {
  const [open, setOpen] = useState(false);
  const { role } = useSession();
  const { language, setLanguage, resolvedLanguage, sectorMode, setSectorMode, t } = useI18n();
  const [messages, setMessages] = useState([
    {
      sender: "bot",
      text: t("assistantGreeting"),
      thoughts: "",
      telemetry: null,
      actionProposal: null,
      actionStatus: null,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmingIdx, setConfirmingIdx] = useState(null);
  const [expandedThoughtIdx, setExpandedThoughtIdx] = useState(null);

  const handleConfirmAction = async (msgIdx, proposal, approved) => {
    setConfirmingIdx(msgIdx);
    try {
      const res = await fetch("/api/assistant/confirm-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool_name: proposal.tool_name,
          params: proposal.params,
          approved,
        }),
      });
      const json = await res.json();
      if (approved && json.rulebook?.sector_mode) {
        setSectorMode(json.rulebook.sector_mode);
      }
      if (approved && json.trace) {
        pushToolTrace(json.trace);
      }
      setMessages((prev) => {
        const next = [...prev];
        const target = { ...next[msgIdx] };
        target.actionStatus = approved ? "executed" : "rejected";
        target.actionResult = json.result || json.rulebook || null;
        next[msgIdx] = target;
        return next;
      });
    } catch {
    } finally {
      setConfirmingIdx(null);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput("");
    const botIndex = messages.length + 1;
    setMessages((prev) => [
      ...prev,
      { sender: "user", text: userText },
      { sender: "bot", text: "", thoughts: "", telemetry: null, detectedLang: null, actionProposal: null, actionStatus: null },
    ]);
    setLoading(true);

    try {
      const [{ data: tenders }, { data: evals }, { data: logs }] = await Promise.all([
        supabase.from("tenders_ocds").select("tender_number, title, budget_allocation, status").limit(6),
        supabase.from("compliance_evaluations").select("overall_status, price_variance_score, summary, bid_submissions(bidder_name)").limit(6),
        supabase.from("immutable_audit_logs").select("action_performed, timestamp").order("timestamp", { ascending: false }).limit(5),
      ]);

      const response = await fetch("/api/assistant/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          role,
          language,
          sectorMode,
          context: { tenders: tenders || [], evals: evals || [], logs: logs || [] },
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
            const payload = JSON.parse(dataStr);
            setMessages((prev) => {
              const next = [...prev];
              const target = { ...(next[botIndex] || { sender: "bot", text: "", thoughts: "" }) };
              if (eventName === "meta") {
                target.detectedLang = payload.language_resolved;
              } else if (eventName === "thinking_chunk" && payload.text) {
                target.thoughts = (target.thoughts || "") + payload.text;
              } else if (eventName === "token_chunk" && payload.text) {
                target.text = (target.text || "") + payload.text;
              } else if (eventName === "action_proposal") {
                target.actionProposal = payload;
                target.actionStatus = "pending";
              } else if (eventName === "complete") {
                if (payload.text && !target.text) target.text = payload.text;
                if (payload.action_proposal && !target.actionProposal) {
                  target.actionProposal = payload.action_proposal;
                  target.actionStatus = "pending";
                }
                target.telemetry = payload.telemetry || null;
                target.detectedLang = payload.language_resolved || target.detectedLang;
              } else if (eventName === "error") {
                target.text = payload.message || "Unable to complete oversight query.";
              }
              next[botIndex] = target;
              return next;
            });
          } catch {}
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        next[botIndex] = {
          sender: "bot",
          text: "Unable to stream oversight response right now. Please retry.",
          thoughts: "",
          telemetry: null,
        };
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          onClick={() => setOpen(!open)}
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-compliance/40 bg-navy text-white shadow-2xl transition-transform hover:scale-105 hover:bg-navy/90"
          aria-label="Toggle AI Assistant"
        >
          {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6 text-compliance" />}
        </Button>
      </div>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[560px] w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in slide-in-from-bottom-5">
          <div className="border-b border-border bg-navy px-4 py-3 text-white space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-compliance" />
                <div>
                  <h4 className="text-sm font-semibold">{t("assistantTitle")}</h4>
                  <p className="text-[11px] text-white/70">{t("assistantSubtitle")}</p>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-white/70 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono text-white/60">
                {sectorMode === "corporate_rfp" ? "Corporate RFP" : "PPADA 2015"} · Approval Gated
              </span>
              <div className="flex items-center rounded border border-white/20 bg-white/10 p-0.5">
                {[
                  { id: "auto", label: "Auto" },
                  { id: "en", label: "EN" },
                  { id: "sw", label: "SW" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setLanguage(opt.id)}
                    className={cn(
                      "rounded px-2 py-0.5 font-medium transition-colors",
                      language === opt.id ? "bg-compliance text-white" : "text-white/70 hover:text-white",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ScrollArea className="flex-1 p-4 space-y-4">
            {messages.map((m, idx) => {
              const useSw = m.detectedLang === "sw" || resolvedLanguage === "sw";
              return (
                <div key={idx} className={`flex gap-3 ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                  {m.sender === "bot" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-compliance/20 text-compliance">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      m.sender === "user"
                        ? "rounded-br-none bg-navy text-white"
                        : "rounded-bl-none border border-border bg-muted text-foreground"
                    }`}
                  >
                    {m.thoughts && (
                      <div className="mb-2 border-b border-border/60 pb-1.5">
                        <button
                          type="button"
                          onClick={() => setExpandedThoughtIdx(expandedThoughtIdx === idx ? null : idx)}
                          className="flex items-center gap-1 font-mono text-[10px] font-semibold text-navy hover:underline"
                        >
                          {expandedThoughtIdx === idx ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          Thinking Trace
                        </button>
                        {expandedThoughtIdx === idx && (
                          <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                            {m.thoughts}
                          </pre>
                        )}
                      </div>
                    )}

                    <div className="whitespace-pre-wrap">
                      {m.text || (loading && idx === messages.length - 1 ? "..." : "")}
                    </div>

                    {m.actionProposal && (
                      <div className="mt-2.5 rounded-lg border border-caution/40 bg-card p-2.5 space-y-2">
                        <div className="flex items-center gap-1.5 font-semibold text-caution text-[11px]">
                          <PauseCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>{useSw ? m.actionProposal.title_sw : m.actionProposal.title_en}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {useSw ? m.actionProposal.description_sw : m.actionProposal.description_en}
                        </p>

                        {m.actionStatus === "pending" ? (
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              type="button"
                              size="sm"
                              disabled={confirmingIdx === idx}
                              onClick={() => handleConfirmAction(idx, m.actionProposal, true)}
                              className="h-7 bg-navy px-2.5 text-[11px] text-white hover:bg-navy/90"
                            >
                              {confirmingIdx === idx && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                              {useSw ? "Idhinisha" : "Approve & Run"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={confirmingIdx === idx}
                              onClick={() => handleConfirmAction(idx, m.actionProposal, false)}
                              className="h-7 px-2.5 text-[11px]"
                            >
                              {useSw ? "Kataa" : "Cancel"}
                            </Button>
                          </div>
                        ) : m.actionStatus === "executed" ? (
                          <div className="space-y-1">
                            <p className="flex items-center gap-1 text-[11px] font-semibold text-compliance">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {useSw ? "Imetekelezwa baada ya idhini" : "Approved & executed via server"}
                            </p>
                            {m.actionResult && (
                              <pre className="max-h-24 overflow-auto rounded bg-muted p-1.5 font-mono text-[10px]">
                                {JSON.stringify(m.actionResult, null, 2)}
                              </pre>
                            )}
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            {useSw ? "Imezuiwa na afisa." : "Blocked by officer."}
                          </p>
                        )}
                      </div>
                    )}

                    {m.telemetry && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-1.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                        <span className="flex items-center gap-1">
                          <Coins className="h-2.5 w-2.5 text-compliance" />
                          {m.telemetry.totalTokens} tok · KES {Number(m.telemetry.estimatedCostKes || 0).toFixed(2)}
                        </span>
                        {m.detectedLang && <span>· {m.detectedLang.toUpperCase()}</span>}
                      </div>
                    )}
                  </div>
                  {m.sender === "user" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy/10 text-navy">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              );
            })}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-compliance" />
                Streaming server-side oversight response...
              </div>
            )}
          </ScrollArea>

          <form onSubmit={handleSend} className="flex gap-2 border-t border-border bg-muted/30 p-3">
            <Input
              placeholder={t("assistantPlaceholder")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="h-10 text-xs"
            />
            <Button type="submit" size="sm" disabled={loading} className="h-10 bg-navy px-3 text-white hover:bg-navy/90">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
