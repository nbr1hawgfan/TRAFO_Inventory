# Trane Technologies (TRAFO) Inventory - LWH customer PWA

PIN-protected inventory app for Trane, hosted on GitHub Pages.
Tabs: **Inventory** (search + Excel export), **Item summary** (rollup by item #), **Transactions** (loads, pallets, and a
**By shipper** rollup, up to 92 days; select a shipper to filter its loads and pallets; a quick-find box filters by item #, bill-to ref, INV receipt,
LWH ID, or shipper as you type).

Look: red/black LWH portal style, matching the One Source app, customer portal, and toolkit.

This is the first app on LWH's **shared customer-app backend** in the LWH Companion Supabase project
(`tjivcqxnkftujceumdtx`). The One Source (ONEPH) app is separate and untouched.

## What's already live in Supabase
- `supabase/cust_app_backend.sql`: `cust_app_*` tables and functions (already applied).
- `supabase/functions/customer-inventory`: the PIN-gated Edge Function (already deployed, `verify_jwt` off because it does its own PIN auth).
- The browser never holds a database key. The function only answers pages served from `nbr1hawgfan.github.io`.

## Publish
1. Create a GitHub repo named `LWH-Trane-Inventory` and upload everything in this folder **except** the `supabase/` folder (keep that in your own records; the repo is public).
2. Settings > Pages > Deploy from branch `main` / root.
3. App URL: `https://nbr1hawgfan.github.io/LWH-Trane-Inventory/`

## Manage PIN users (Supabase SQL editor)
```sql
select public.cust_app_add_user('TRAFO', 'Jane Smith - Trane', '12345678');  -- add, or reset a PIN
select public.cust_app_remove_user('TRAFO', 'Jane Smith - Trane');           -- revoke (ends their sessions)
select * from public.cust_app_list_users('TRAFO');                           -- who has access
select * from public.cust_app_activity('TRAFO', 50);                         -- sign-ins and exports
```
PINs are 6 to 8 digits, stored only as salted hashes, and must be unique within a customer.
Sessions last 8 hours. 10 wrong PINs in 15 minutes pauses that customer's sign-ins for 15 minutes.

## Change columns or labels
Inventory columns come from `cust_app_customers.columns` (ordered `{key, label}` list). Edit it in the
table editor; no redeploy needed. Available keys: `location, bay, item_number, item_description,
lwh_id, customer_id, inv_receipt, bill_to_ref, lot_number, unique2, vendor, qty, date_received, age_days`.

## Add another customer later
1. Insert a row in `cust_app_customers` (code = WMS customer code, display_name, columns).
2. Copy this repo, change only `config.js` and the names in `manifest.json`, and publish.
3. Add their PIN users with `cust_app_add_user`.
New warehouses: add a row to `cust_app_locations` (code, name, short_name, sort_order).
