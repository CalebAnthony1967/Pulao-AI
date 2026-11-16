import React from "react";
import PortalShell from "@/components/layout/PortalShell";
import RoleGate from "@/components/common/RoleGate";
import VaultTable from "@/components/vault/VaultTable";
import ObservabilityEvalPanel from "@/components/vault/ObservabilityEvalPanel";

export default function AuditVault() {
  return (
    <PortalShell
      eyebrow="Audit & Security"
      title="Audit Trail, Observability & Benchmarks"
      description="Every verification check, multi-agent cost ledger, reliability benchmark, committee review, and formal decision is logged with timestamps and cryptographic SHA-256 verification checksums."
    >
      <RoleGate roles={["admin", "superadmin"]}>
        <div className="space-y-8">
          <ObservabilityEvalPanel />
          <VaultTable />
        </div>
      </RoleGate>
    </PortalShell>
  );
}