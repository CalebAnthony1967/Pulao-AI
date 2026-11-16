-- Pulao AI — PostgreSQL / Supabase Schema, RLS Policies & Audit Vault RPCs
-- Covers Public Sector (Kenya PPADA 2015 / OCDS) and Private Corporate RFP Governance

create extension if not exists pgcrypto;

-- 1. User Roles & Organization Mapping
create table if not exists public.users_roles (
  id text primary key,
  email text unique,
  full_name text,
  organization text,
  registration_number text,
  role text not null default 'supplier' check (role in ('supplier', 'committee', 'researcher', 'admin', 'superadmin')),
  created_at timestamptz not null default now()
);

-- 2. Published Tenders (OCDS Aligned)
create table if not exists public.tenders_ocds (
  id text primary key,
  tender_number text unique not null,
  title text not null,
  procuring_entity text not null,
  category text,
  region text,
  sector_mode text not null default 'public_ppada' check (sector_mode in ('public_ppada', 'corporate_rfp')),
  budget_allocation numeric(18,2),
  submission_deadline timestamptz,
  agpo_reserved boolean not null default false,
  status text not null default 'open',
  description text,
  created_at timestamptz not null default now()
);

-- 3. Published Market Price Index (PPRA / Enterprise Baseline)
create table if not exists public.market_price_index (
  id text primary key,
  item_category text not null,
  item_description text not null,
  benchmark_price numeric(18,2) not null,
  allowed_deviation_margin numeric(5,4) not null default 0.15,
  unit text default 'Unit',
  updated_at timestamptz not null default now()
);

-- 4. Supplier Bid Submissions
create table if not exists public.bid_submissions (
  id text primary key,
  tender_id text references public.tenders_ocds(id) on delete cascade,
  bidder_name text not null,
  registration_number text not null,
  quoted_amount numeric(18,2) not null,
  line_items jsonb not null default '[]'::jsonb,
  document_urls jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  submitted_by text,
  submission_date timestamptz not null default now(),
  status text not null default 'submitted'
);

-- 5. Compliance Evaluations (Prepared by Agents — Never Auto-Awarded)
create table if not exists public.compliance_evaluations (
  id text primary key,
  bid_id text references public.bid_submissions(id) on delete cascade,
  tender_id text references public.tenders_ocds(id) on delete cascade,
  kra_tax_status text,
  brs_status text,
  nssf_status text,
  sha_shif_status text,
  agpo_status text,
  price_variance_score numeric(6,2) default 0,
  collusion_risk_score numeric(6,2) default 0,
  verified_citations jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  summary text,
  overall_status text not null default 'pending' check (overall_status in ('compliant', 'warning', 'critical', 'pending', 'signed_off')),
  justification text,
  evaluated_at timestamptz not null default now()
);

-- 6. Human Evaluation Committee Decisions
create table if not exists public.committee_decisions (
  id text primary key,
  evaluation_id text references public.compliance_evaluations(id) on delete cascade,
  tender_id text references public.tenders_ocds(id) on delete cascade,
  reviewer_id text not null,
  reviewer_name text not null,
  decision_action text not null check (decision_action in ('approved', 'overridden', 'flagged')),
  finding_key text not null,
  written_justification text not null,
  signed_at timestamptz not null default now()
);

-- 7. Hash-Chained Append-Only Audit Logs
create table if not exists public.immutable_audit_logs (
  id text primary key default ('vault_' || encode(gen_random_bytes(8), 'hex')),
  timestamp timestamptz not null default now(),
  action_performed text not null,
  mcp_tool_called text,
  input_payload jsonb,
  output_payload jsonb,
  previous_hash text not null default 'GENESIS',
  tamper_proof_hash text not null
);

-- 8. Organization Rulebooks (Public PPADA vs Corporate RFP)
create table if not exists public.organization_rulebooks (
  org_id text primary key,
  sector_mode text not null default 'public_ppada' check (sector_mode in ('public_ppada', 'corporate_rfp')),
  allowed_price_variance_pct numeric(5,2) not null default 15.0,
  require_agpo_check boolean not null default true,
  require_kyb_insurance boolean not null default false,
  updated_at timestamptz not null default now()
);

-- 9. Agent Run Observability & Cost Ledger
create table if not exists public.agent_runs (
  run_id text primary key,
  tender_id text,
  tender_number text,
  sector_mode text not null,
  model_id text not null,
  execution_backend text not null,
  language_requested text,
  language_detected text,
  language_resolved text,
  status text not null,
  nodes_executed jsonb not null default '[]'::jsonb,
  retry_count integer not null default 0,
  human_escalations integer not null default 0,
  unverified_claims_suppressed integer not null default 0,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  thinking_tokens integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  estimated_cost_kes numeric(12,4) not null default 0,
  latency_ms integer not null default 0,
  created_at timestamptz not null default now()
);

-- 10. System Settings & RPCs
create table if not exists public.system_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- 11. Dynamic System Control & Governance Parameters
create table if not exists public.system_control_parameters (
  param_key text primary key,
  param_name text not null,
  param_value jsonb not null,
  category text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Relational foreign keys for interconnectivity
alter table public.agent_runs 
  drop constraint if exists fk_agent_runs_tender;
alter table public.agent_runs 
  add constraint fk_agent_runs_tender 
  foreign key (tender_id) references public.tenders_ocds(id) on delete cascade;

alter table public.immutable_audit_logs 
  add column if not exists tender_id text references public.tenders_ocds(id) on delete set null,
  add column if not exists run_id text references public.agent_runs(run_id) on delete set null;

create or replace function public.append_audit_log(
  p_action text,
  p_tool text default null,
  p_input jsonb default null,
  p_output jsonb default null
) returns text
language plpgsql
security definer
as $$
declare
  v_prev text := 'GENESIS';
  v_ts timestamptz := now();
  v_hash text;
begin
  select tamper_proof_hash into v_prev
  from public.immutable_audit_logs
  order by timestamp desc
  limit 1;

  if v_prev is null then
    v_prev := 'GENESIS';
  end if;

  v_hash := encode(digest(
    v_prev || '|' || p_action || '|' || coalesce(p_input::text, 'null') || '|' || coalesce(p_output::text, 'null') || '|' || v_ts::text,
    'sha256'
  ), 'hex');

  insert into public.immutable_audit_logs (timestamp, action_performed, mcp_tool_called, input_payload, output_payload, previous_hash, tamper_proof_hash)
  values (v_ts, p_action, p_tool, p_input, p_output, v_prev, v_hash);

  return v_hash;
end;
$$;

create or replace function public.sign_off_evaluation(
  p_evaluation_id text,
  p_justification text,
  p_reviewer_name text,
  p_action text default 'approved'
) returns void
language plpgsql
security definer
as $$
begin
  update public.compliance_evaluations
  set overall_status = 'signed_off',
      justification = p_justification
  where id = p_evaluation_id;

  perform public.append_audit_log(
    'Human Committee Sign-Off Executed',
    'HumanSignOffGate',
    jsonb_build_object('evaluation_id', p_evaluation_id, 'reviewer', p_reviewer_name, 'action', p_action),
    jsonb_build_object('overall_status', 'signed_off')
  );
end;
$$;

create or replace function public.get_system_governance_overview()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_tenders int;
  v_bids int;
  v_runs int;
  v_audits int;
  v_params jsonb;
begin
  select count(*) into v_tenders from public.tenders_ocds;
  select count(*) into v_bids from public.bid_submissions;
  select count(*) into v_runs from public.agent_runs;
  select count(*) into v_audits from public.immutable_audit_logs;
  
  select json_object_agg(param_key, param_value) into v_params from public.system_control_parameters;
  if v_params is null then
    v_params := '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'tenders_count', v_tenders,
    'bids_count', v_bids,
    'agent_runs_count', v_runs,
    'audit_logs_count', v_audits,
    'parameters', v_params,
    'status', 'healthy'
  );
end;
$$;

create or replace function public.update_system_control_param(
  p_key text,
  p_value jsonb,
  p_admin text,
  p_name text default 'Governance Parameter'
) returns void
language plpgsql
security definer
as $$
begin
  insert into public.system_control_parameters (param_key, param_name, param_value, updated_by, updated_at)
  values (p_key, p_name, p_value, p_admin, now())
  on conflict (param_key) do update
  set param_value = excluded.param_value,
      updated_by = excluded.updated_by,
      updated_at = now();

  perform public.append_audit_log(
    'System Control Parameter Updated: ' || p_key,
    'SystemControlPortal',
    jsonb_build_object('key', p_key, 'value', p_value, 'admin', p_admin),
    jsonb_build_object('status', 'updated')
  );
end;
$$;

-- Enable Row-Level Security
alter table public.tenders_ocds enable row level security;
alter table public.market_price_index enable row level security;
alter table public.bid_submissions enable row level security;
alter table public.compliance_evaluations enable row level security;
alter table public.committee_decisions enable row level security;
alter table public.immutable_audit_logs enable row level security;
alter table public.organization_rulebooks enable row level security;
alter table public.agent_runs enable row level security;
alter table public.system_control_parameters enable row level security;

create policy "Public read open tenders" on public.tenders_ocds for select using (true);
create policy "Public read price index" on public.market_price_index for select using (true);
create policy "Authenticated read evaluations" on public.compliance_evaluations for select using (auth.role() = 'authenticated');
create policy "Authenticated read audit logs" on public.immutable_audit_logs for select using (auth.role() = 'authenticated');
create policy "Authenticated read control params" on public.system_control_parameters for select using (auth.role() = 'authenticated');

