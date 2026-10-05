-- Commercial history. Existing references, statuses, counters and column grants stay intact.
begin;
alter table public.quotes
  add column contact_name text,
  add column contact_email text,
  add column contact_phone text,
  add column billing_name text,
  add column tax_id text,
  add column billing_address text,
  add column issue_date date not null default current_date,
  add column currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  add column prices_include_tax boolean not null default false,
  add column subtotal numeric(20,2) not null default 0,
  add column tax_total numeric(20,2) not null default 0,
  add column total numeric(20,2) not null default 0,
  add column current_version_id uuid,
  add column accepted_version_id uuid,
  add column sent_at timestamptz,
  add column accepted_at timestamptz,
  add column rejected_at timestamptz,
  add column expired_at timestamptz,
  add column cancelled_at timestamptz;

alter table public.quote_files add constraint quote_files_commercial_identity
  unique (tenant_id, quote_id, id);

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  quote_id uuid not null,
  version_number integer not null check (version_number > 0),
  state text not null default 'draft' check (state in ('draft','prepared','sent')),
  title text,
  description text not null default '',
  terms text,
  issue_date date not null default current_date,
  valid_until date,
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  prices_include_tax boolean not null default false,
  seller_snapshot jsonb not null default '{}' check (jsonb_typeof(seller_snapshot) = 'object'),
  client_snapshot jsonb not null default '{}' check (jsonb_typeof(client_snapshot) = 'object'),
  subtotal numeric(20,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(20,2) not null default 0 check (tax_total >= 0),
  total numeric(20,2) not null default 0 check (total >= 0),
  tax_breakdown jsonb not null default '[]' check (jsonb_typeof(tax_breakdown) = 'array'),
  pdf_file_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  row_version bigint not null default 0 check (row_version >= 0),
  constraint quote_versions_quote_fk foreign key (tenant_id,quote_id)
    references public.quotes(tenant_id,id),
  constraint quote_versions_identity unique (tenant_id,quote_id,id),
  constraint quote_versions_tenant_identity unique (tenant_id,id),
  constraint quote_versions_number unique (quote_id,version_number),
  constraint quote_versions_lock_shape check (
    (state = 'draft' and locked_at is null and sent_at is null) or
    (state = 'prepared' and locked_at is not null and sent_at is null) or
    (state = 'sent' and locked_at is not null)
  ),
  constraint quote_versions_pdf_fk foreign key (tenant_id,quote_id,pdf_file_id)
    references public.quote_files(tenant_id,quote_id,id)
);
create unique index quote_versions_one_draft on public.quote_versions(quote_id) where state='draft';
create index quote_versions_tenant_quote on public.quote_versions(tenant_id,quote_id,version_number desc);
alter table public.quotes
  add constraint quotes_current_version_fk foreign key (tenant_id,id,current_version_id)
    references public.quote_versions(tenant_id,quote_id,id),
  add constraint quotes_accepted_version_fk foreign key (tenant_id,id,accepted_version_id)
    references public.quote_versions(tenant_id,quote_id,id);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  quote_version_id uuid not null,
  position integer not null check (position > 0),
  concept text not null check (length(btrim(concept)) > 0),
  description text,
  quantity numeric(18,6) not null check (quantity > 0),
  unit text,
  unit_price numeric(18,6) not null check (unit_price >= 0),
  discount_percent numeric(9,6) not null default 0 check (discount_percent between 0 and 100),
  tax_rate numeric(9,6) not null default 0 check (tax_rate between 0 and 100),
  subtotal numeric(20,2) not null default 0 check (subtotal >= 0),
  tax_amount numeric(20,2) not null default 0 check (tax_amount >= 0),
  total numeric(20,2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  constraint quote_items_version_fk foreign key (tenant_id,quote_version_id)
    references public.quote_versions(tenant_id,id),
  constraint quote_items_position unique (quote_version_id,position)
);
-- Reject numeric NaN (which otherwise compares greater than finite values).
alter table public.quote_items add constraint quote_items_finite check (
  quantity <> 'NaN'::numeric and unit_price <> 'NaN'::numeric
);
alter table public.quote_versions enable row level security;
alter table public.quote_items enable row level security;
create policy quote_versions_operational_select on public.quote_versions for select to authenticated
using (public.has_tenant_role(tenant_id,array['owner','admin','manager','staff'])
  and public.tenant_has_feature(tenant_id,'quotes'));
create policy quote_items_operational_select on public.quote_items for select to authenticated
using (public.has_tenant_role(tenant_id,array['owner','admin','manager','staff'])
  and public.tenant_has_feature(tenant_id,'quotes'));
revoke all on public.quote_versions, public.quote_items from public,anon,authenticated,service_role;
grant select on public.quote_versions, public.quote_items to authenticated;
comment on column public.quote_versions.sent_at is
  'Legacy sent/accepted/rejected backfill may have unknown sending time (NULL). No send RPC in this block.';
commit;
