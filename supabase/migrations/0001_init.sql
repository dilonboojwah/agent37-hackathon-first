-- v1 Supabase store: aggregate rows as JSONB, matching src/core/types.ts.
-- The normalized target schema is in docs/PRD.md (Data model).
-- The app uses the service role key server-side; RLS stays on with no policies,
-- so the anon key can read nothing.

create table if not exists workflows (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists runs (
  id text primary key,
  workflow_id text not null references workflows(id) on delete cascade,
  kind text not null check (kind in ('practice', 'scheduled', 'manual', 'baseline')),
  status text not null,
  started_at timestamptz not null,
  data jsonb not null
);
create index if not exists runs_workflow_started on runs (workflow_id, started_at desc);

create table if not exists agent_memory (
  workflow_id text not null references workflows(id) on delete cascade,
  key text not null,
  value jsonb not null,
  primary key (workflow_id, key)
);

alter table workflows enable row level security;
alter table runs enable row level security;
alter table agent_memory enable row level security;
