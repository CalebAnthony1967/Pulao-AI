import { supabase } from "./supabase";

const DEFAULT_TENDERS = [
  {
    id: "tender_014",
    tender_number: "T-2026-KEBS-014",
    title: "Supply and Commissioning of Automated Metrology & Calibration Equipment",
    procuring_entity: "Kenya Bureau of Standards (KEBS)",
    budget_allocation: 45000000,
    category: "Goods",
    region: "National",
    agpo_reserved: true,
    submission_deadline: "2026-05-15",
    status: "Active"
  },
  {
    id: "tender_015",
    tender_number: "T-2026-MOW-022",
    title: "Construction of County Link Bitumen Access Roads & Drainage System",
    procuring_entity: "Ministry of Public Works & Infrastructure",
    budget_allocation: 185000000,
    category: "Works",
    region: "Nairobi / Central",
    agpo_reserved: false,
    submission_deadline: "2026-05-28",
    status: "Active"
  },
  {
    id: "tender_016",
    tender_number: "T-2026-MOH-089",
    title: "Enterprise Cloud ERP Software Licencing & Implementation Support",
    procuring_entity: "Ministry of Health",
    budget_allocation: 72000000,
    category: "Services",
    region: "National",
    agpo_reserved: true,
    submission_deadline: "2026-06-05",
    status: "Active"
  }
];

const DEFAULT_PRICE_INDEX = [
  { id: "pi_1", item_category: "Construction Materials", item_name: "Portland Cement 50kg Bag", benchmark_min: 850, benchmark_max: 980, unit: "bag" },
  { id: "pi_2", item_category: "Construction Materials", item_name: "High Yield Reinforcement Steel 12mm", benchmark_min: 115000, benchmark_max: 132000, unit: "ton" },
  { id: "pi_3", item_category: "ICT Equipment", item_name: "Enterprise Core Switch 24-Port PoE", benchmark_min: 180000, benchmark_max: 220000, unit: "pcs" },
  { id: "pi_4", item_category: "ICT Equipment", item_name: "High-Performance Workstation i7 32GB", benchmark_min: 140000, benchmark_max: 175000, unit: "pcs" },
  { id: "pi_5", item_category: "Medical Supplies", item_name: "Surgical Examination Gloves (Box 100)", benchmark_min: 950, benchmark_max: 1250, unit: "box" }
];

export async function listTenders({ search = "", category = "all", region = "all", agpoOnly = false } = {}) {
  let remote = [];
  try {
    const { data, error } = await supabase.from("tenders_ocds").select("*").order("submission_deadline", { ascending: true });
    if (!error && data) remote = data;
  } catch {}

  let local = [];
  try {
    const raw = localStorage.getItem("pulao_local_tenders");
    local = raw ? JSON.parse(raw) : DEFAULT_TENDERS;
  } catch {
    local = DEFAULT_TENDERS;
  }

  const map = new Map();
  for (const t of local) map.set(t.id, t);
  for (const t of remote) map.set(t.id, t);

  let combined = Array.from(map.values());
  if (search) {
    const s = search.toLowerCase();
    combined = combined.filter(
      (t) =>
        (t.title || "").toLowerCase().includes(s) ||
        (t.tender_number || "").toLowerCase().includes(s) ||
        (t.procuring_entity || "").toLowerCase().includes(s),
    );
  }
  if (category !== "all") combined = combined.filter((t) => t.category === category);
  if (region !== "all") combined = combined.filter((t) => t.region === region);
  if (agpoOnly) combined = combined.filter((t) => t.agpo_reserved);
  return combined;
}

export async function getTender(id) {
  try {
    const { data, error } = await supabase.from("tenders_ocds").select("*").eq("id", id).maybeSingle();
    if (!error && data) return data;
  } catch {}
  const all = await listTenders();
  return all.find((t) => t.id === id) || null;
}

// Local persistence helpers for resilient bids, evaluations, and decisions
export function getAllLocalBids() {
  try {
    const raw = localStorage.getItem("pulao_local_bids");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalBid(bid) {
  try {
    const bids = getAllLocalBids();
    const idx = bids.findIndex((b) => b.id === bid.id);
    if (idx >= 0) {
      bids[idx] = bid;
    } else {
      bids.unshift(bid);
    }
    localStorage.setItem("pulao_local_bids", JSON.stringify(bids));
  } catch {}
}

export function getAllLocalEvaluations() {
  try {
    const raw = localStorage.getItem("pulao_local_evaluations");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalEvaluation(evaluation) {
  try {
    const evals = getAllLocalEvaluations();
    const idx = evals.findIndex((e) => e.id === evaluation.id || (e.bid_id && e.bid_id === evaluation.bid_id));
    if (idx >= 0) {
      evals[idx] = { ...evals[idx], ...evaluation };
    } else {
      evals.push(evaluation);
    }
    localStorage.setItem("pulao_local_evaluations", JSON.stringify(evals));
  } catch {}
}

export function updateLocalEvaluationStatus(evalId, status, justification = "") {
  try {
    const evals = getAllLocalEvaluations();
    const target = evals.find((e) => e.id === evalId);
    if (target) {
      target.overall_status = status;
      target.justification = justification;
      localStorage.setItem("pulao_local_evaluations", JSON.stringify(evals));
    }
  } catch {}
}

export function getAllLocalDecisions() {
  try {
    const raw = localStorage.getItem("pulao_local_decisions");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalDecision(decision) {
  try {
    const decs = getAllLocalDecisions();
    decs.push(decision);
    localStorage.setItem("pulao_local_decisions", JSON.stringify(decs));
  } catch {}
}

export function getLocalAuditLogs() {
  try {
    const raw = localStorage.getItem("pulao_audit_vault");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function listPriceIndex() {
  let remote = [];
  try {
    const { data, error } = await supabase.from("market_price_index").select("*").order("item_category");
    if (!error && data) remote = data;
  } catch {}

  let local = [];
  try {
    const raw = localStorage.getItem("pulao_local_price_index");
    local = raw ? JSON.parse(raw) : DEFAULT_PRICE_INDEX;
  } catch {
    local = DEFAULT_PRICE_INDEX;
  }

  const map = new Map();
  for (const p of local) map.set(p.id, p);
  for (const p of remote) map.set(p.id, p);
  return Array.from(map.values());
}

export async function listBidsForTender(tenderId) {
  let remote = [];
  try {
    const { data, error } = await supabase
      .from("bid_submissions")
      .select("*")
      .eq("tender_id", tenderId)
      .order("submission_date", { ascending: true });
    if (!error && data) remote = data;
  } catch {}
  const local = getAllLocalBids().filter((b) => b.tender_id === tenderId);
  const map = new Map();
  for (const b of remote) map.set(b.id, b);
  for (const b of local) map.set(b.id, b);
  return Array.from(map.values());
}

export async function listMyBids(userId) {
  let remote = [];
  try {
    const { data, error } = await supabase
      .from("bid_submissions")
      .select("*, tenders_ocds(tender_number, title, procuring_entity, submission_deadline, status)")
      .eq("submitted_by", userId)
      .order("submission_date", { ascending: false });
    if (!error && data) remote = data;
  } catch {}
  const allLocal = getAllLocalBids();
  const matchingLocal = allLocal.filter(
    (b) => !userId || b.submitted_by === userId || b.submitted_by?.includes("supplier") || b.submitted_by?.includes("usr_"),
  );
  const allTenders = await listTenders().catch(() => []);
  const tenderMap = new Map(allTenders.map((t) => [t.id, t]));
  for (const b of matchingLocal) {
    if (!b.tenders_ocds && tenderMap.has(b.tender_id)) {
      b.tenders_ocds = tenderMap.get(b.tender_id);
    }
  }
  const map = new Map();
  for (const b of remote) map.set(b.id, b);
  for (const b of matchingLocal) map.set(b.id, b);
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.submission_date || 0).getTime() - new Date(a.submission_date || 0).getTime(),
  );
}

export async function listEvaluations(tenderId) {
  let remote = [];
  try {
    const { data, error } = await supabase
      .from("compliance_evaluations")
      .select("*, bid_submissions(bidder_name, registration_number, quoted_amount, line_items, metadata, document_urls, submission_date)")
      .eq("tender_id", tenderId)
      .order("evaluated_at", { ascending: true });
    if (!error && data) remote = data;
  } catch {}
  const local = getAllLocalEvaluations().filter((e) => e.tender_id === tenderId);
  const map = new Map();
  for (const e of remote) map.set(e.id, e);
  for (const e of local) map.set(e.id, e);
  return Array.from(map.values());
}

export async function listMyEvaluations(userId) {
  try {
    const myBids = await listMyBids(userId);
    if (!myBids || myBids.length === 0) return [];
    const bidIds = new Set(myBids.map((b) => b.id));
    let remote = [];
    try {
      const { data: evals } = await supabase
        .from("compliance_evaluations")
        .select("*")
        .in("bid_id", Array.from(bidIds));
      if (evals) remote = evals;
    } catch {}
    const local = getAllLocalEvaluations().filter((e) => bidIds.has(e.bid_id));
    const map = new Map();
    for (const e of remote) map.set(e.id, e);
    for (const e of local) map.set(e.id, e);
    return Array.from(map.values());
  } catch {
    return [];
  }
}

export async function listDecisions(tenderId) {
  let remote = [];
  try {
    const { data, error } = await supabase
      .from("committee_decisions")
      .select("*")
      .eq("tender_id", tenderId)
      .order("signed_at", { ascending: false });
    if (!error && data) remote = data;
  } catch {}
  const local = getAllLocalDecisions().filter((d) => d.tender_id === tenderId);
  const map = new Map();
  for (const d of remote) map.set(d.id, d);
  for (const d of local) map.set(d.id, d);
  return Array.from(map.values());
}

export async function listAuditLogs({ search = "", limit = 120 } = {}) {
  let remote = [];
  try {
    let query = supabase
      .from("immutable_audit_logs")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(limit);
    if (search) query = query.or(`action_performed.ilike.%${search}%,mcp_tool_called.ilike.%${search}%`);
    const { data, error } = await query;
    if (!error && data) remote = data;
  } catch {}
  const local = getLocalAuditLogs();
  const map = new Map();
  for (const l of remote) map.set(l.id, l);
  for (const l of local) map.set(l.id, l);
  let combined = Array.from(map.values()).sort(
    (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime(),
  );
  if (search) {
    const s = search.toLowerCase();
    combined = combined.filter(
      (l) =>
        (l.action_performed || "").toLowerCase().includes(s) ||
        (l.mcp_tool_called || "").toLowerCase().includes(s),
    );
  }
  return combined.slice(0, limit);
}

export async function listSystemSettings() {
  try {
    const { data, error } = await supabase.from("system_settings").select("*");
    if (!error && data) {
      const map = {};
      for (const row of data) map[row.key] = row.value;
      return map;
    }
  } catch {}
  return {
    enforce_mandatory_kra: "true",
    auto_benchmark_variance_threshold: "15",
    require_committee_quorum: "3",
    maintenance_mode: "false"
  };
}

export async function saveSystemSetting(key, value) {
  try {
    await supabase
      .from("system_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch {}
  try {
    const settings = await listSystemSettings();
    settings[key] = value;
    localStorage.setItem("pulao_system_settings", JSON.stringify(settings));
  } catch {}
}

export async function listTeamMembers() {
  try {
    const { data, error } = await supabase.from("users_roles").select("*").order("created_at");
    if (!error && data) return data;
  } catch {}
  return [
    { id: "usr_1", email: "calebnyakeyo2018@gmail.com", role: "superadmin", name: "Caleb Nyakeyo", created_at: new Date().toISOString() },
    { id: "usr_2", email: "evaluator@pulao.go.ke", role: "evaluator", name: "Procurement Committee Chair", created_at: new Date().toISOString() },
    { id: "usr_3", email: "admin@pulao.go.ke", role: "admin", name: "System Admin", created_at: new Date().toISOString() }
  ];
}

export async function updateMemberRole(id, role) {
  try {
    await supabase.from("users_roles").update({ role }).eq("id", id);
  } catch {}
}

export async function loadPortfolio() {
  const [tendersRes, evaluationsRes, decisionsRes, bidsRes] = await Promise.allSettled([
    supabase.from("tenders_ocds").select("*"),
    supabase.from("compliance_evaluations").select("*"),
    supabase.from("committee_decisions").select("*"),
    supabase.from("bid_submissions").select("*"),
  ]);
  const tenders = tendersRes.status === "fulfilled" && tendersRes.value.data && tendersRes.value.data.length > 0 ? tendersRes.value.data : await listTenders();
  let evaluations = evaluationsRes.status === "fulfilled" && evaluationsRes.value.data ? evaluationsRes.value.data : [];
  let decisions = decisionsRes.status === "fulfilled" && decisionsRes.value.data ? decisionsRes.value.data : [];
  let bids = bidsRes.status === "fulfilled" && bidsRes.value.data ? bidsRes.value.data : [];
  const localBids = getAllLocalBids();
  const localEvals = getAllLocalEvaluations();
  const localDecisions = getAllLocalDecisions();
  const bidMap = new Map(bids.map((b) => [b.id, b]));
  for (const b of localBids) bidMap.set(b.id, b);
  const evalMap = new Map(evaluations.map((e) => [e.id, e]));
  for (const e of localEvals) evalMap.set(e.id, e);
  const decMap = new Map(decisions.map((d) => [d.id, d]));
  for (const d of localDecisions) decMap.set(d.id, d);
  return {
    tenders,
    evaluations: Array.from(evalMap.values()),
    decisions: Array.from(decMap.values()),
    bids: Array.from(bidMap.values()),
  };
}

export async function createTender(tenderData) {
  const newId = "tender_" + Date.now();
  const payload = { id: newId, ...tenderData, created_at: new Date().toISOString() };
  try {
    await supabase.from("tenders_ocds").insert([payload]);
  } catch {}
  try {
    const raw = localStorage.getItem("pulao_local_tenders");
    const tenders = raw ? JSON.parse(raw) : DEFAULT_TENDERS;
    tenders.unshift(payload);
    localStorage.setItem("pulao_local_tenders", JSON.stringify(tenders));
  } catch {}
  return payload;
}

export async function updateTender(id, tenderData) {
  try {
    await supabase.from("tenders_ocds").update(tenderData).eq("id", id);
  } catch {}
  try {
    const raw = localStorage.getItem("pulao_local_tenders");
    const tenders = raw ? JSON.parse(raw) : DEFAULT_TENDERS;
    const idx = tenders.findIndex((t) => t.id === id);
    if (idx >= 0) {
      tenders[idx] = { ...tenders[idx], ...tenderData };
    } else {
      tenders.unshift({ id, ...tenderData });
    }
    localStorage.setItem("pulao_local_tenders", JSON.stringify(tenders));
  } catch {}
  return tenderData;
}

export async function deleteTender(id) {
  try {
    await supabase.from("tenders_ocds").delete().eq("id", id);
  } catch {}
  try {
    const raw = localStorage.getItem("pulao_local_tenders");
    if (raw) {
      let tenders = JSON.parse(raw);
      tenders = tenders.filter((t) => t.id !== id);
      localStorage.setItem("pulao_local_tenders", JSON.stringify(tenders));
    }
  } catch {}
  return true;
}

export async function createPriceItem(itemData) {
  const newId = "price_" + Date.now();
  const payload = { id: newId, ...itemData };
  try {
    await supabase.from("market_price_index").insert([payload]);
  } catch {}
  try {
    const raw = localStorage.getItem("pulao_local_price_index");
    const items = raw ? JSON.parse(raw) : DEFAULT_PRICE_INDEX;
    items.unshift(payload);
    localStorage.setItem("pulao_local_price_index", JSON.stringify(items));
  } catch {}
  return payload;
}

export async function updatePriceItem(id, itemData) {
  try {
    await supabase.from("market_price_index").update(itemData).eq("id", id);
  } catch {}
  try {
    const raw = localStorage.getItem("pulao_local_price_index");
    const items = raw ? JSON.parse(raw) : DEFAULT_PRICE_INDEX;
    const idx = items.findIndex((i) => i.id === id);
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...itemData };
    }
    localStorage.setItem("pulao_local_price_index", JSON.stringify(items));
  } catch {}
  return itemData;
}

export async function deletePriceItem(id) {
  try {
    await supabase.from("market_price_index").delete().eq("id", id);
  } catch {}
  try {
    const raw = localStorage.getItem("pulao_local_price_index");
    if (raw) {
      let items = JSON.parse(raw);
      items = items.filter((i) => i.id !== id);
      localStorage.setItem("pulao_local_price_index", JSON.stringify(items));
    }
  } catch {}
  return true;
}
