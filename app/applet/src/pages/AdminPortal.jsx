import React, { useEffect, useState } from "react";
import { ShieldCheck, Plus, Edit, Trash2, Database, DollarSign, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { listAuditLogs, createTender, updateTender, deleteTender, createPriceItem, updatePriceItem, deletePriceItem, listPriceIndex } from "@/lib/data";
import { recordAudit } from "@/lib/audit";
import PortalShell from "@/components/layout/PortalShell";
import RoleGate from "@/components/common/RoleGate";
import ToolHealthGrid from "@/components/admin/ToolHealthGrid";
import SettingsPanel from "@/components/admin/SettingsPanel";
import TeamRoles from "@/components/admin/TeamRoles";
import AccessRequests from "@/components/admin/AccessRequests";
import LoadingBlock from "@/components/common/LoadingBlock";
import StatusBadge from "@/components/common/StatusBadge";
import { Input } from "@/components/ui/input";

export default function AdminPortal() {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [tenders, setTenders] = useState([]);
  const [priceItems, setPriceItems] = useState([]);

  const [showTenderModal, setShowTenderModal] = useState(false);
  const [editingTender, setEditingTender] = useState(null);
  const [tenderForm, setTenderForm] = useState({
    tender_number: "",
    title: "",
    procuring_entity: "Ministry of Public Works",
    budget_allocation: 5000000,
    category: "Goods",
    region: "National",
    agpo_reserved: false,
    submission_deadline: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
    status: "Active"
  });

  const [showPriceModal, setShowPriceModal] = useState(false);
  const [editingPrice, setEditingPrice] = useState(null);
  const [priceForm, setPriceForm] = useState({
    item_category: "Construction Materials",
    item_name: "",
    benchmark_min: 1000,
    benchmark_max: 1500,
    unit: "pcs"
  });

  const loadAll = async () => {
    try {
      const [tRes, pRes, auditRes] = await Promise.all([
        supabase.from("tenders_ocds").select("*").order("submission_deadline", { ascending: false }),
        listPriceIndex(),
        listAuditLogs({ limit: 200 }).catch(() => []),
      ]);
      setTenders(tRes.data || []);
      setPriceItems(pRes || []);
      const [bidsCount, priceCount, auditCount] = await Promise.all([
        supabase.from("bid_submissions").select("id", { count: "exact", head: true }),
        supabase.from("market_price_index").select("id", { count: "exact", head: true }),
        supabase.from("immutable_audit_logs").select("id", { count: "exact", head: true }),
      ]);
      setData({
        counts: {
          tenders: tRes.data?.length || 0,
          bids: bidsCount.count || 0,
          priceItems: priceCount.count || 0,
          auditEntries: auditCount.count || 0,
        },
        logs: auditRes,
      });
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleSaveTender = async (e) => {
    e.preventDefault();
    if (editingTender) {
      await updateTender(editingTender.id, tenderForm);
      await recordAudit({
        action: "ADMIN_UPDATE_TENDER",
        tool: "tender_manager",
        input: { id: editingTender.id, ...tenderForm },
        output: { success: true }
      });
    } else {
      await createTender(tenderForm);
      await recordAudit({
        action: "ADMIN_CREATE_TENDER",
        tool: "tender_manager",
        input: tenderForm,
        output: { success: true }
      });
    }
    setShowTenderModal(false);
    setEditingTender(null);
    loadAll();
  };

  const handleDeleteTender = async (id) => {
    if (!confirm("Are you sure you want to delete this tender?")) return;
    await deleteTender(id);
    await recordAudit({
      action: "ADMIN_DELETE_TENDER",
      tool: "tender_manager",
      input: { tender_id: id },
      output: { success: true }
    });
    loadAll();
  };

  const handleSavePrice = async (e) => {
    e.preventDefault();
    if (editingPrice) {
      await updatePriceItem(editingPrice.id, priceForm);
      await recordAudit({
        action: "ADMIN_UPDATE_PRICE_INDEX",
        tool: "benchmark_engine",
        input: { id: editingPrice.id, ...priceForm },
        output: { success: true }
      });
    } else {
      await createPriceItem(priceForm);
      await recordAudit({
        action: "ADMIN_CREATE_PRICE_INDEX",
        tool: "benchmark_engine",
        input: priceForm,
        output: { success: true }
      });
    }
    setShowPriceModal(false);
    setEditingPrice(null);
    loadAll();
  };

  const handleDeletePrice = async (id) => {
    if (!confirm("Are you sure you want to delete this benchmark item?")) return;
    await deletePriceItem(id);
    await recordAudit({
      action: "ADMIN_DELETE_PRICE_INDEX",
      tool: "benchmark_engine",
      input: { item_id: id },
      output: { success: true }
    });
    loadAll();
  };

  return (
    <PortalShell
      eyebrow="System Administration"
      title="Admin Operations &amp; CRUD Control Center"
      description="Full administrative CRUD control over tenders, benchmarks, access requests, team roles, and system settings with immutable logging."
    >
      <RoleGate roles={["admin", "superadmin"]}>
        {!data ? (
          <LoadingBlock label="Loading admin system..." />
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2 border-b border-border pb-3">
              <button
                type="button"
                onClick={() => setActiveTab("overview")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === "overview" ? "bg-navy text-white shadow" : "bg-card text-foreground hover:bg-secondary"}`}
              >
                <ShieldCheck className="h-4 w-4" /> System Overview &amp; Health
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("tenders")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === "tenders" ? "bg-navy text-white shadow" : "bg-card text-foreground hover:bg-secondary"}`}
              >
                <Database className="h-4 w-4" /> Tender CRUD ({tenders.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("benchmarks")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === "benchmarks" ? "bg-navy text-white shadow" : "bg-card text-foreground hover:bg-secondary"}`}
              >
                <DollarSign className="h-4 w-4" /> Price Benchmarks ({priceItems.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("access")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === "access" ? "bg-navy text-white shadow" : "bg-card text-foreground hover:bg-secondary"}`}
              >
                <Users className="h-4 w-4" /> Access &amp; Roles
              </button>
            </div>

            {activeTab === "overview" && (
              <div className="space-y-6">
                <AccessRequests />
                <ToolHealthGrid logs={data.logs} counts={data.counts} />
                <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
                  <SettingsPanel />
                  <div className="space-y-5">
                    <TeamRoles />
                    <div className="rounded-xl border border-compliance/30 bg-compliance-soft p-5">
                      <div className="flex items-center gap-2 text-compliance">
                        <ShieldCheck className="h-4 w-4" />
                        <p className="text-sm font-semibold">Governance Policy: Full CRUD Audited</p>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-compliance/90">
                        All admin operations are cryptographically signed and logged in the immutable audit register.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "tenders" && (
              <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">Procurement Tenders Manager (Full CRUD)</h3>
                    <p className="text-sm text-muted-foreground">Add, edit, publish, or remove tenders from active portal.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTender(null);
                      setTenderForm({
                        tender_number: "TND-" + Math.floor(100000 + Math.random() * 900000),
                        title: "",
                        procuring_entity: "Ministry of Infrastructure",
                        budget_allocation: 10000000,
                        category: "Works",
                        region: "National",
                        agpo_reserved: false,
                        submission_deadline: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
                        status: "Active"
                      });
                      setShowTenderModal(true);
                    }}
                    className="flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90"
                  >
                    <Plus className="h-4 w-4" /> Create New Tender
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border bg-secondary/50 text-xs font-semibold uppercase text-muted-foreground">
                      <tr>
                        <th className="p-3">Tender Number</th>
                        <th className="p-3">Title</th>
                        <th className="p-3">Category</th>
                        <th className="p-3">Budget</th>
                        <th className="p-3">Deadline</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {tenders.map((t) => (
                        <tr key={t.id} className="hover:bg-secondary/30">
                          <td className="p-3 font-mono font-medium text-foreground">{t.tender_number}</td>
                          <td className="p-3 font-medium text-foreground">{t.title}</td>
                          <td className="p-3 text-muted-foreground">{t.category}</td>
                          <td className="p-3 font-mono text-muted-foreground">KES {Number(t.budget_allocation || 0).toLocaleString()}</td>
                          <td className="p-3 text-muted-foreground">{t.submission_deadline}</td>
                          <td className="p-3">
                            <StatusBadge tone={t.status === "Active" ? "compliance" : "neutral"}>{t.status || "Active"}</StatusBadge>
                          </td>
                          <td className="p-3 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTender(t);
                                setTenderForm({
                                  tender_number: t.tender_number,
                                  title: t.title,
                                  procuring_entity: t.procuring_entity,
                                  budget_allocation: t.budget_allocation,
                                  category: t.category,
                                  region: t.region,
                                  agpo_reserved: t.agpo_reserved,
                                  submission_deadline: t.submission_deadline || "",
                                  status: t.status || "Active"
                                });
                                setShowTenderModal(true);
                              }}
                              className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTender(t.id)}
                              className="rounded p-1.5 text-critical hover:bg-critical-soft"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "benchmarks" && (
              <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">Market Price Index Benchmarks (CRUD)</h3>
                    <p className="text-sm text-muted-foreground">Configure item cost benchmarks used by AI agent.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPrice(null);
                      setPriceForm({
                        item_category: "Construction Materials",
                        item_name: "",
                        benchmark_min: 1000,
                        benchmark_max: 2000,
                        unit: "pcs"
                      });
                      setShowPriceModal(true);
                    }}
                    className="flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90"
                  >
                    <Plus className="h-4 w-4" /> Add Benchmark Item
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border bg-secondary/50 text-xs font-semibold uppercase text-muted-foreground">
                      <tr>
                        <th className="p-3">Category</th>
                        <th className="p-3">Item Name</th>
                        <th className="p-3">Benchmark Range (KES)</th>
                        <th className="p-3">Unit</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {priceItems.map((p) => (
                        <tr key={p.id} className="hover:bg-secondary/30">
                          <td className="p-3 font-medium text-foreground">{p.item_category}</td>
                          <td className="p-3 font-semibold text-foreground">{p.item_name}</td>
                          <td className="p-3 font-mono text-muted-foreground">KES {Number(p.benchmark_min).toLocaleString()} - {Number(p.benchmark_max).toLocaleString()}</td>
                          <td className="p-3 text-muted-foreground">{p.unit}</td>
                          <td className="p-3 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPrice(p);
                                setPriceForm({
                                  item_category: p.item_category,
                                  item_name: p.item_name,
                                  benchmark_min: p.benchmark_min,
                                  benchmark_max: p.benchmark_max,
                                  unit: p.unit
                                });
                                setShowPriceModal(true);
                              }}
                              className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePrice(p.id)}
                              className="rounded p-1.5 text-critical hover:bg-critical-soft"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "access" && (
              <div className="space-y-6">
                <AccessRequests />
                <TeamRoles />
              </div>
            )}

            {showTenderModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
                  <h3 className="text-lg font-bold text-foreground">
                    {editingTender ? "Edit Tender Record" : "Create New Tender"}
                  </h3>
                  <form onSubmit={handleSaveTender} className="mt-4 space-y-4">
                    <div>
                      <label className="text-xs font-semibold uppercase text-muted-foreground">Tender Number</label>
                      <Input
                        value={tenderForm.tender_number}
                        onChange={(e) => setTenderForm({ ...tenderForm, tender_number: e.target.value })}
                        required
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase text-muted-foreground">Title</label>
                      <Input
                        value={tenderForm.title}
                        onChange={(e) => setTenderForm({ ...tenderForm, title: e.target.value })}
                        required
                        placeholder="e.g. Supply and Delivery of ICT Equipment"
                        className="mt-1"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Category</label>
                        <select
                          value={tenderForm.category}
                          onChange={(e) => setTenderForm({ ...tenderForm, category: e.target.value })}
                          className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                        >
                          <option value="Goods">Goods</option>
                          <option value="Works">Works</option>
                          <option value="Services">Services</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Budget (KES)</label>
                        <Input
                          type="number"
                          value={tenderForm.budget_allocation}
                          onChange={(e) => setTenderForm({ ...tenderForm, budget_allocation: Number(e.target.value) })}
                          required
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Deadline</label>
                        <Input
                          type="date"
                          value={tenderForm.submission_deadline}
                          onChange={(e) => setTenderForm({ ...tenderForm, submission_deadline: e.target.value })}
                          required
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Status</label>
                        <select
                          value={tenderForm.status}
                          onChange={(e) => setTenderForm({ ...tenderForm, status: e.target.value })}
                          className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                        >
                          <option value="Active">Active</option>
                          <option value="Under Evaluation">Under Evaluation</option>
                          <option value="Awarded">Awarded</option>
                          <option value="Closed">Closed</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowTenderModal(false)}
                        className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90"
                      >
                        {editingTender ? "Update Tender" : "Publish Tender"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {showPriceModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
                  <h3 className="text-lg font-bold text-foreground">
                    {editingPrice ? "Edit Benchmark Item" : "Add Benchmark Item"}
                  </h3>
                  <form onSubmit={handleSavePrice} className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Category</label>
                        <Input
                          value={priceForm.item_category}
                          onChange={(e) => setPriceForm({ ...priceForm, item_category: e.target.value })}
                          required
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Item Name</label>
                        <Input
                          value={priceForm.item_name}
                          onChange={(e) => setPriceForm({ ...priceForm, item_name: e.target.value })}
                          required
                          placeholder="e.g. Portland Cement 50kg"
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Min (KES)</label>
                        <Input
                          type="number"
                          value={priceForm.benchmark_min}
                          onChange={(e) => setPriceForm({ ...priceForm, benchmark_min: Number(e.target.value) })}
                          required
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Max (KES)</label>
                        <Input
                          type="number"
                          value={priceForm.benchmark_max}
                          onChange={(e) => setPriceForm({ ...priceForm, benchmark_max: Number(e.target.value) })}
                          required
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Unit</label>
                        <Input
                          value={priceForm.unit}
                          onChange={(e) => setPriceForm({ ...priceForm, unit: e.target.value })}
                          required
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowPriceModal(false)}
                        className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90"
                      >
                        {editingPrice ? "Update Benchmark" : "Save Benchmark"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}
      </RoleGate>
    </PortalShell>
  );
}
