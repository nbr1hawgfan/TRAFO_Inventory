/*===========================================================
  SHARED CUSTOMER INVENTORY APP - backend (LWH Companion)
  One backend for every customer-facing inventory PWA.
  Additive only: new cust_app_* tables and functions.
  Nothing existing is changed, and the One Source (oneph_*)
  objects are left exactly as they are.

  Customer #1: TRAFO (Trane Technologies)
  Add a customer later: one insert into cust_app_customers,
  then copy the PWA repo and change config.js.
===========================================================*/

-- ---------- Tables ----------
create table if not exists public.cust_app_customers (
    code               text primary key,              -- WMS customer code, e.g. TRAFO
    display_name       text not null,                 -- shown in the app header
    active             boolean not null default true,
    exclude_warehouses text[] not null default '{WHSE99,1}',
    columns            jsonb not null,                -- ordered inventory columns [{key,label}]
    created_at         timestamptz not null default now()
);

create table if not exists public.cust_app_locations (
    code       text primary key,                      -- WHSE10
    name       text not null,
    short_name text,
    sort_order integer not null default 1000
);

create table if not exists public.cust_app_users (
    id            bigserial primary key,
    customer_code text not null references public.cust_app_customers(code),
    name          text not null,
    pin_salt      text not null,
    pin_hash      text not null,
    active        boolean not null default true,
    created_at    timestamptz not null default now(),
    last_login    timestamptz,
    unique (customer_code, name)
);

create table if not exists public.cust_app_sessions (
    token_hash    text primary key,
    user_id       bigint not null references public.cust_app_users(id) on delete cascade,
    customer_code text not null,
    expires_at    timestamptz not null
);

create table if not exists public.cust_app_login_failures (
    id            bigserial primary key,
    customer_code text not null,
    at            timestamptz not null default now()
);

create table if not exists public.cust_app_access_log (
    id            bigserial primary key,
    customer_code text not null,
    user_name     text not null,
    action        text not null,
    at            timestamptz not null default now()
);

create index if not exists cust_app_failures_idx on public.cust_app_login_failures (customer_code, at);
create index if not exists cust_app_log_idx      on public.cust_app_access_log (customer_code, at desc);

-- Locked down: RLS on, no policies, so the public keys can't read any of it.
alter table public.cust_app_customers      enable row level security;
alter table public.cust_app_locations      enable row level security;
alter table public.cust_app_users          enable row level security;
alter table public.cust_app_sessions       enable row level security;
alter table public.cust_app_login_failures enable row level security;
alter table public.cust_app_access_log     enable row level security;
revoke all on public.cust_app_customers, public.cust_app_locations, public.cust_app_users,
              public.cust_app_sessions, public.cust_app_login_failures, public.cust_app_access_log
       from anon, authenticated;

-- ---------- Seed ----------
insert into public.cust_app_locations (code, name, short_name, sort_order)
select code, name, short_name, sort_order from public.oneph_app_locations
on conflict (code) do nothing;

insert into public.cust_app_customers (code, display_name, columns) values
('TRAFO', 'Trane Technologies', '[
  {"key":"location",         "label":"Warehouse"},
  {"key":"bay",              "label":"Bay"},
  {"key":"item_number",      "label":"Item #"},
  {"key":"item_description", "label":"Item Description"},
  {"key":"lwh_id",           "label":"LWH ID"},
  {"key":"inv_receipt",      "label":"INV Receipt"},
  {"key":"bill_to_ref",      "label":"Bill-To Ref"},
  {"key":"lot_number",       "label":"Lot #"},
  {"key":"qty",              "label":"Qty"},
  {"key":"date_received",    "label":"Date Received"},
  {"key":"age_days",         "label":"Age (Days)"}
]'::jsonb)
on conflict (code) do nothing;

-- ---------- Inventory (standard toolkit field names) ----------
create or replace function public.cust_app_inventory(p_customer text)
returns table (
    location_code text, location text, location_sort integer, bay text,
    item_number text, item_description text, lwh_id bigint, customer_id text,
    inv_receipt bigint, bill_to_ref text, lot_number text, unique2 text, vendor text,
    qty numeric, date_received date, age_days integer, synced_at timestamptz)
language sql stable set search_path = public
as $$
    select trim(c.warehouse),
           coalesce(l.name || ' (' || trim(c.warehouse) || ')', trim(c.warehouse)),
           coalesce(l.sort_order, 1000),
           coalesce(nullif(trim(c.bay_name), ''), 'Not Assigned'),
           trim(c.item_number), trim(c.item_description), c.pallet_id,
           coalesce(trim(c.customer_id), ''), c.inventory_receipt,
           coalesce(lr.bill_to_reference, ''),
           coalesce(trim(c.lot_number), ''), coalesce(trim(c.unique2), ''), coalesce(trim(c.vendor), ''),
           c.quantity, c.received_on::date, c.inventory_age_days, c.synced_at
    from public.current_inventory c
    join public.cust_app_customers cu on cu.code = upper(trim(p_customer)) and cu.active
    left join public.cust_app_locations l on l.code = trim(c.warehouse)
    left join lateral (
        select ld.bill_to_reference from public.load_details ld
        where ld.pro_number = c.inventory_receipt::text and coalesce(ld.bill_to_reference, '') <> ''
        limit 1
    ) lr on true
    where upper(trim(c.customer)) = cu.code
      and coalesce(c.is_active_inventory, true)
      and coalesce(trim(c.warehouse), '') <> all (cu.exclude_warehouses);
$$;

-- ---------- Summary: config + totals + by-location + by-item ----------
create or replace function public.cust_app_summary(p_customer text)
returns jsonb language sql stable set search_path = public
as $$
    with r as (select * from public.cust_app_inventory(p_customer)),
    loc as (
        select location_code, location, min(location_sort) so,
               count(*) pallets, coalesce(sum(qty), 0) qty, count(distinct item_number) items
        from r group by location_code, location
    ),
    it as (
        select item_number, max(item_description) description, count(*) pallets,
               coalesce(sum(qty), 0) qty, count(distinct bay) bays,
               min(date_received) oldest, max(age_days) max_age
        from r group by item_number
    )
    select jsonb_build_object(
        'customer', (select jsonb_build_object('code', code, 'name', display_name, 'columns', columns)
                     from public.cust_app_customers where code = upper(trim(p_customer))),
        'as_of',       (select max(synced_at) from r),
        'total_pallets', (select count(*) from r),
        'total_qty',     (select coalesce(sum(qty), 0) from r),
        'total_items',   (select count(distinct item_number) from r),
        'locations', coalesce((select jsonb_agg(jsonb_build_object(
                         'code', location_code, 'label', location, 'pallets', pallets,
                         'qty', qty, 'items', items) order by so, location_code) from loc), '[]'::jsonb),
        'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'item_number', item_number, 'description', description, 'pallets', pallets,
                         'qty', qty, 'bays', bays, 'oldest', oldest, 'max_age', max_age)
                     order by pallets desc, item_number) from it), '[]'::jsonb)
    );
$$;

-- ---------- Search / export ----------
create or replace function public.cust_app_search(
    p_customer text, p_query text default '', p_location text default 'ALL',
    p_limit integer default 100, p_offset integer default 0)
returns jsonb language sql stable set search_path = public
as $$
    with q as (select upper(trim(coalesce(p_query, ''))) v, upper(trim(coalesce(p_location, 'ALL'))) loc),
    m as (
        select r.*,
            case when q.v = '' then ''
                 when strpos(upper(r.item_number), q.v) > 0       then 'Item #'
                 when strpos(r.lwh_id::text, q.v) > 0             then 'LWH ID'
                 when strpos(r.inv_receipt::text, q.v) > 0        then 'INV Receipt'
                 when strpos(upper(r.bill_to_ref), q.v) > 0       then 'Bill-To Ref'
                 when strpos(upper(r.customer_id), q.v) > 0       then 'Customer ID'
                 when strpos(upper(r.lot_number), q.v) > 0        then 'Lot #'
                 when strpos(upper(r.bay), q.v) > 0               then 'Bay'
                 when strpos(upper(r.item_description), q.v) > 0 then 'Item Description'
            end matched_on
        from public.cust_app_inventory(p_customer) r cross join q
        where q.loc = 'ALL' or upper(r.location_code) = q.loc
    ),
    f as (select * from m where matched_on is not null),
    pg as (select * from f order by location_sort, location_code, bay, inv_receipt, lwh_id
           limit greatest(p_limit, 1) offset greatest(p_offset, 0))
    select jsonb_build_object(
        'total', (select count(*) from f),
        'qty',   (select coalesce(sum(qty), 0) from f),
        'rows',  coalesce((select jsonb_agg(jsonb_build_object(
                    'location', location, 'location_code', location_code, 'bay', bay,
                    'item_number', item_number, 'item_description', item_description,
                    'lwh_id', lwh_id::text, 'customer_id', customer_id, 'inv_receipt', inv_receipt::text,
                    'bill_to_ref', bill_to_ref, 'lot_number', lot_number, 'unique2', unique2,
                    'vendor', vendor, 'qty', qty, 'date_received', date_received,
                    'age_days', age_days, 'matched_on', matched_on)
                 order by location_sort, location_code, bay, inv_receipt, lwh_id) from pg), '[]'::jsonb)
    );
$$;

-- ---------- Transactions (max 92 days per request) ----------
create or replace function public.cust_app_transactions(
    p_customer text, p_from date, p_to date, p_direction text default 'ALL')
returns jsonb language sql stable set search_path = public
as $$
    with cu as (select code from public.cust_app_customers where code = upper(trim(p_customer)) and active),
    d0 as (select least(p_from, p_to) f, greatest(p_from, p_to) t, upper(trim(coalesce(p_direction, 'ALL'))) dir),
    d  as (select greatest(f, t - 92) f, t, dir from d0),
    tx as (
        select th.transaction_date, th.transaction_type,
               split_part(trim(th.location), ' ', 1) code,
               th.lwh_id, coalesce(trim(th.customer_id), '') customer_id,
               coalesce(trim(th.lot_number), '') lot_number,
               trim(th.item_number) item_number, trim(th.item_description) item_description,
               th.quantity, th.inv_receipt, coalesce(th.bill_to_ref, '') bill_to_ref
        from public.transaction_history th, d, cu
        where upper(trim(th.customer)) = cu.code
          and th.transaction_date between d.f and d.t
          and (d.dir = 'ALL' or upper(th.transaction_type) = d.dir)
    ),
    txl as (
        select tx.*, coalesce(l.name || ' (' || tx.code || ')', tx.code) location
        from tx left join public.cust_app_locations l on l.code = tx.code
    ),
    ld_closed as (  -- loads closed out in the WMS
        select ld.pro_number, min(ld.load_date) load_date, max(ld.direction) direction,
               max(trim(ld.warehouse)) code, max(ld.bill_to_reference) bill_to_ref,
               string_agg(distinct trim(ld.item_number), ', ') items,
               sum(ld.total_pallets) pallets, sum(ld.total_qty) qty,
               max(ld.carrier) carrier, max(ld.trailer) trailer, max(ld.seal) seal,
               max(ld.shipper) shipper, max(ld.consignee) consignee, max(ld.load_status) status
        from public.load_details ld, d, cu
        where upper(trim(ld.customer)) = cu.code
          and ld.load_date between d.f and d.t
          and (d.dir = 'ALL' or upper(ld.direction) = d.dir)
        group by ld.pro_number
    ),
    ld_open as (    -- scanned pallets whose load isn't closed out yet
        select tx.inv_receipt::text, min(tx.transaction_date), max(tx.transaction_type), max(tx.code),
               max(nullif(tx.bill_to_ref, '')), string_agg(distinct tx.item_number, ', '),
               count(*)::bigint, sum(tx.quantity),
               '', '', '', '', '', 'Open'
        from tx, cu
        where tx.inv_receipt is not null
          and not exists (select 1 from public.load_details x
                          where x.pro_number = tx.inv_receipt::text and upper(trim(x.customer)) = cu.code)
        group by tx.inv_receipt
    ),
    ld  as (select * from ld_closed union all select * from ld_open),
    ldl as (select ld.*, coalesce(l.name || ' (' || ld.code || ')', ld.code) location
            from ld left join public.cust_app_locations l on l.code = ld.code)
    select jsonb_build_object(
        'from', (select f from d), 'to', (select t from d),
        'totals', jsonb_build_object(
            'inbound_loads',    (select count(*) from ld where direction = 'Inbound'),
            'outbound_loads',   (select count(*) from ld where direction = 'Outbound'),
            'open_loads',       (select count(*) from ld_open),
            'inbound_pallets',  (select count(*) from tx where transaction_type = 'Inbound'),
            'outbound_pallets', (select count(*) from tx where transaction_type = 'Outbound'),
            'inbound_qty',      (select coalesce(sum(quantity), 0) from tx where transaction_type = 'Inbound'),
            'outbound_qty',     (select coalesce(sum(quantity), 0) from tx where transaction_type = 'Outbound')),
        'loads', coalesce((select jsonb_agg(jsonb_build_object(
                    'date', load_date, 'direction', direction, 'location', location,
                    'inv_receipt', pro_number, 'bill_to_ref', coalesce(bill_to_ref, ''),
                    'items', coalesce(items, ''), 'pallets', pallets, 'qty', qty,
                    'carrier', coalesce(carrier, ''), 'trailer', coalesce(trailer, ''),
                    'seal', coalesce(seal, ''), 'shipper', coalesce(shipper, ''),
                    'consignee', coalesce(consignee, ''), 'status', coalesce(status, ''))
                 order by load_date desc, direction, pro_number) from ldl), '[]'::jsonb),
        'pallets', coalesce((select jsonb_agg(jsonb_build_object(
                    'date', transaction_date, 'direction', transaction_type, 'location', location,
                    'lwh_id', lwh_id::text, 'item_number', item_number, 'item_description', item_description,
                    'qty', quantity, 'lot_number', lot_number, 'customer_id', customer_id,
                    'inv_receipt', inv_receipt::text, 'bill_to_ref', bill_to_ref)
                 order by transaction_date desc, transaction_type, inv_receipt, lwh_id) from txl), '[]'::jsonb)
    );
$$;

-- ---------- PIN admin (run from the Supabase SQL editor) ----------
-- PIN hash = sha256(salt || ':' || pin), same scheme as the One Source app.
create or replace function public.cust_app_add_user(p_customer text, p_name text, p_pin text)
returns text language plpgsql set search_path = public
as $$
declare v_code text := upper(trim(p_customer)); v_salt text; u record;
begin
    if not exists (select 1 from cust_app_customers where code = v_code) then
        raise exception 'Unknown customer %', v_code; end if;
    if coalesce(p_pin, '') !~ '^\d{6,8}$' then raise exception 'PIN must be 6 to 8 digits'; end if;
    for u in select pin_salt, pin_hash from cust_app_users
             where customer_code = v_code and active and name <> trim(p_name) loop
        if encode(sha256(convert_to(u.pin_salt || ':' || p_pin, 'UTF8')), 'hex') = u.pin_hash then
            raise exception 'That PIN is already used by another % user. Pick a different one.', v_code;
        end if;
    end loop;
    v_salt := replace(gen_random_uuid()::text, '-', '');
    insert into cust_app_users (customer_code, name, pin_salt, pin_hash)
    values (v_code, trim(p_name), v_salt, encode(sha256(convert_to(v_salt || ':' || p_pin, 'UTF8')), 'hex'))
    on conflict (customer_code, name) do update
       set pin_salt = excluded.pin_salt, pin_hash = excluded.pin_hash, active = true;
    return 'Saved ' || trim(p_name) || ' for ' || v_code;
end $$;

create or replace function public.cust_app_remove_user(p_customer text, p_name text)
returns text language plpgsql set search_path = public
as $$
declare n integer;
begin
    update cust_app_users set active = false
     where customer_code = upper(trim(p_customer)) and name = trim(p_name) and active;
    get diagnostics n = row_count;
    delete from cust_app_sessions s using cust_app_users u
     where s.user_id = u.id and u.customer_code = upper(trim(p_customer)) and u.name = trim(p_name);
    return case when n > 0 then 'Removed ' || trim(p_name) else 'No active user named ' || trim(p_name) end;
end $$;

create or replace function public.cust_app_list_users(p_customer text)
returns table (name text, active boolean, created_at timestamptz, last_login timestamptz)
language sql stable set search_path = public
as $$ select name, active, created_at, last_login from cust_app_users
      where customer_code = upper(trim(p_customer)) order by active desc, name; $$;

create or replace function public.cust_app_activity(p_customer text, p_limit integer default 25)
returns table (at timestamptz, user_name text, action text)
language sql stable set search_path = public
as $$ select at, user_name, action from cust_app_access_log
      where customer_code = upper(trim(p_customer)) order by at desc limit p_limit; $$;

-- Only the service role (Edge Function) and the SQL editor can call these.
revoke execute on function
    public.cust_app_inventory(text), public.cust_app_summary(text),
    public.cust_app_search(text, text, text, integer, integer),
    public.cust_app_transactions(text, date, date, text),
    public.cust_app_add_user(text, text, text), public.cust_app_remove_user(text, text),
    public.cust_app_list_users(text), public.cust_app_activity(text, integer)
from public, anon, authenticated;
