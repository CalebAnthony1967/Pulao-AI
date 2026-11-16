import React, { createContext, useContext, useEffect, useState } from "react";

const STORAGE_LANG_KEY = "pulao_lang_pref";
const STORAGE_SECTOR_KEY = "pulao_sector_mode";

const DICTIONARY = {
  en: {
    workflowTitle: "Multi-Agent Verification Console",
    workflowSubtitle:
      "Plans verification via LangGraph, invokes stdio MCP tools, enforces page-level citations, and locks final decisions for the human committee.",
    runWorkflow: "Run Evaluation Workflow",
    runningWorkflow: "Streaming multi-agent audit...",
    humanGateBanner:
      "Legal Invariant Active: This agent prepares and verifies the evaluation dossier only — it never awards a tender or finalizes a disqualification.",
    languageLabel: "Language",
    sectorPublic: "Public Sector (PPADA 2015)",
    sectorCorporate: "Corporate RFP / KYB",
    thinkingTrace: "Supervisor Thinking & Plan Trace",
    streamingBrief: "Live Streaming Pre-Committee Brief",
    inspectSource: "Inspect Source Page",
    hideSource: "Hide Source Page",
    citationVerified: "Citation Verified",
    lowOcrNotice:
      "Fairness Gate: Low scan confidence routed to human visual verification (no automatic disqualification).",
    upholdFinding: "Uphold this finding",
    overrideFinding: "Override with a note",
    assistantTitle: "Pulao Assistant",
    assistantSubtitle: "Bilingual procurement & record explainer",
    assistantPlaceholder: "Ask in English or Kiswahili about tenders, flags, or price drift...",
    assistantGreeting:
      "Hello Officer, I am Pulao-AI Assistant. Ask me in English or Kiswahili about active tenders, citations, compliance flags, or market price benchmarks.",
    pausedGateLabel: "Agent Paused — Officer Decision Needed",
    awaitingUserApproval: "Paused mid-run waiting for your approval before calling MCP tool",
    costComparison: "vs ~45 min manual officer cross-check",
  },
  sw: {
    workflowTitle: "Mfumo wa Ukaguzi wa Mawakala Wengi",
    workflowSubtitle:
      "Hupanga ukaguzi kupitia LangGraph, hutumia zana halisi za MCP, huthibitisha nambari za kurasa, na huhifadhi uamuzi wa mwisho kwa kamati ya wanadamu.",
    runWorkflow: "Anza Ukaguzi wa Zabuni",
    runningWorkflow: "Inaendesha ukaguzi wa mawakala...",
    humanGateBanner:
      "Kanuni ya Kisheria: Wakala huu huandaa faili ya tathmini pekee — kamwe hautoi zabuni wala kufuta mzabuni bila saini ya kamati.",
    languageLabel: "Lugha",
    sectorPublic: "Sekta ya Umma (PPADA 2015)",
    sectorCorporate: "Kampuni Binafsi (RFP / KYB)",
    thinkingTrace: "Mpango na Mchakato wa Fikra za Wakala",
    streamingBrief: "Muhtasari wa Moja kwa Moja wa Kamati",
    inspectSource: "Kagua Ukurasa Halisi",
    hideSource: "Ficha Ukurasa",
    citationVerified: "Ushahidi Umethibitishwa",
    lowOcrNotice:
      "Ulinzi wa Haki: Ubora mdogo wa skani umepelekwa kwa ukaguzi wa afisa (hakuna kufutwa kiotomatiki).",
    upholdFinding: "Kubali hoja hii",
    overrideFinding: "Batilisha kwa maelezo",
    assistantTitle: "Msaidizi wa Pulao",
    assistantSubtitle: "Ufafanuzi wa zabuni kwa Kiingereza na Kiswahili",
    assistantPlaceholder: "Uliza kwa Kiswahili au Kiingereza kuhusu zabuni au bei...",
    assistantGreeting:
      "Hujambo Afisa, mimi ni Msaidizi wa Pulao-AI. Niulize kwa Kiswahili au Kiingereza kuhusu zabuni, viashiria vya kisheria, au bei elekezi za soko.",
    pausedGateLabel: "Wakala Amesimama — Uamuzi wa Afisa Unahitajika",
    awaitingUserApproval: "Amesimama akisubiri idhini yako kabla ya kuita zana ya MCP",
    costComparison: "dhidi ya takriban dakika 45 za ukaguzi wa mkono",
  },
};

export function detectClientLanguage(text = "") {
  const s = String(text).toLowerCase();
  const swWords = ["habari", "zabuni", "sheria", "ununuzi", "kamati", "bei", "kwa nini", "tafadhali", "cheti", "ushuru"];
  let hits = 0;
  for (const w of swWords) {
    if (s.includes(w)) hits += 1;
  }
  return hits >= 1 ? "sw" : "en";
}

const I18nContext = createContext({
  language: "auto",
  setLanguage: () => {},
  resolvedLanguage: "en",
  sectorMode: "public_ppada",
  setSectorMode: () => {},
  t: (k) => DICTIONARY.en[k] || k,
});

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_LANG_KEY) || "auto";
    } catch {
      return "auto";
    }
  });
  const [sectorMode, setSectorModeState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_SECTOR_KEY) || "public_ppada";
    } catch {
      return "public_ppada";
    }
  });

  useEffect(() => {
    fetch("/api/rulebooks")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.rulebook?.sector_mode) {
          setSectorModeState(json.rulebook.sector_mode);
        }
      })
      .catch(() => {});
  }, []);

  const setLanguage = (next) => {
    const val = next === "sw" || next === "en" ? next : "auto";
    setLanguageState(val);
    try {
      localStorage.setItem(STORAGE_LANG_KEY, val);
    } catch {}
  };

  const setSectorMode = async (next) => {
    const mode = next === "corporate_rfp" ? "corporate_rfp" : "public_ppada";
    setSectorModeState(mode);
    try {
      localStorage.setItem(STORAGE_SECTOR_KEY, mode);
    } catch {}
    try {
      await fetch("/api/rulebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector_mode: mode }),
      });
    } catch {}
  };

  const resolvedLanguage = language === "sw" ? "sw" : "en";
  const t = (key) => DICTIONARY[resolvedLanguage]?.[key] || DICTIONARY.en[key] || key;

  return (
    <I18nContext.Provider value={{ language, setLanguage, resolvedLanguage, sectorMode, setSectorMode, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
