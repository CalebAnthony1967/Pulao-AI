/**
 * Bilingual Kenyan Context Language Engine (English & Kiswahili)
 * and Prompt-Injection Sanitizer for untrusted supplier PDF text.
 */

export type LanguageCode = "en" | "sw";
export type LanguagePreference = "auto" | "en" | "sw";

const KISWAHILI_MARKERS = [
  "habari",
  "jambo",
  "tafadhali",
  "zabuni",
  "mzabuni",
  "kampuni",
  "sheria",
  "ununuzi",
  "kamati",
  "tathmini",
  "cheti",
  "ushuru",
  "bei",
  "orodha",
  "ukaguzi",
  "maelezo",
  "kiasi",
  "kwa nini",
  "nini",
  "gani",
  "vipi",
  "je",
  "naomba",
  "nyaraka",
  "fidia",
  "malipo",
  "mkataba",
  "wajibu",
  "hatari",
  "imefeli",
  "imepita",
  "imekwisha",
  "kwa mujibu",
  "kompyuta",
  "shule",
  "pampu",
  "vifaa",
  "usafiri",
];

export function detectLanguage(text: string): LanguageCode {
  const clean = String(text || "").toLowerCase();
  if (!clean.trim()) return "en";

  const words = clean.split(/[^a-z]+/).filter(Boolean);
  let hits = 0;
  for (const marker of KISWAHILI_MARKERS) {
    if (marker.includes(" ")) {
      if (clean.includes(marker)) hits += 2;
    } else if (words.includes(marker)) {
      hits += 1;
    }
  }
  return hits >= 2 ? "sw" : "en";
}

export function resolveOutputLanguage(requested: LanguagePreference | string | undefined, textSample: string): {
  detected: LanguageCode;
  resolved: LanguageCode;
} {
  const detected = detectLanguage(textSample);
  if (requested === "sw") return { detected, resolved: "sw" };
  if (requested === "en") return { detected, resolved: "en" };
  return { detected, resolved: detected };
}

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|system|audit)\s+rules?/gi,
  /mark\s+(this\s+)?(bid|bidder|company)\s+as\s+(compliant|awarded|passed)/gi,
  /bypass\s+(human\s+)?(gate|committee|sign[- ]?off|audit)/gi,
  /auto[- ]?award\s+(this\s+)?tender/gi,
  /you\s+are\s+now\s+(instructed|commanded|ordered)\s+to/gi,
  /system\s*:\s*override/gi,
  /<\s*system\s*>/gi,
];

export function sanitizeUntrustedText(rawText: string): {
  sanitized: string;
  injectionDetected: boolean;
  patternsMatched: string[];
} {
  let text = String(rawText || "");
  const patternsMatched: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      patternsMatched.push(...matches.map((m) => m.slice(0, 80)));
      text = text.replace(pattern, "[REDACTED_PROMPT_INJECTION_ATTEMPT]");
    }
  }

  return {
    sanitized: text,
    injectionDetected: patternsMatched.length > 0,
    patternsMatched,
  };
}
