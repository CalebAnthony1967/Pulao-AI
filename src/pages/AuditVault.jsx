import React from "react";
import PortalShell from "@/components/layout/PortalShell";
import RoleGate from "@/components/common/RoleGate";
import VaultTable from "@/components/vault/VaultTable";

export default function AuditVault() {
  return (
    <PortalShell
      eyebrow="Audit & Security"
      title="Audit Trail Register"
      description="Every verification check, committee review, and formal decision is cryptographically logged with timestamps and verification checksums. Records are permanent and append-only."
    >
      <RoleGate roles={["admin", "superadmin"]}>
        <VaultTable />
      </RoleGate>
    </PortalShell>
  );
}