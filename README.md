# Trane Technologies (TRAFO) Inventory + Cycle Counts - LWH customer PWA

PIN-protected inventory app for Trane, hosted on GitHub Pages. This update moves Trane onto the same app as
Franklin (FRAWI_Inventory): same code, with Trane's own `config.js` and `manifest.json`.

## What's new for Trane
- **Dashboard**: one search box with type-ahead, totals, inventory age, last 14 days in/out, top items, cycle count summary.
  Time, temperature and today's forecast in the header.
- **Smart search**: several words, a pasted list of LWH IDs / INV receipts / item numbers / bays (with a "not found" list),
  `item:` `bay:` `rcv:` `ref:` `lot:` `desc:` prefixes, `bay:E0*` wildcards, `age>180`, "quotes" for item numbers with spaces.
- **Cycle counts**: request by item, bay or pallet; LWH or Trane counts; blind counting by scanner or phone camera;
  LWH review with recount and "WMS adjusted"; Trane sees results once closed; weekly/monthly schedules for January.
- **Barcode sheets**: bay labels, bay lists, bays with their pallets, item barcodes, pallet barcodes from a search,
  and blind count sheets. Scanning a bay label while counting jumps to that bay.
- **Transactions** and **Items** work as before.

## Pallet check vs. quantity count
Every count is a **pallet check** unless "Also record the quantity on each pallet" is ticked on the request or schedule.
A pallet check is the fast way: pick the bay, scan every pallet, and each scan saves on its own (no quantity box).
Results show **Found in place, Wrong bay, Missing, Found not on list** and an accuracy %. A found pallet is recorded at its
WMS quantity, so quantities never show as off. Tick the box when quantities matter: counters then enter what they see (blind)
and results add quantity accuracy and differences. Printed count sheets follow the same choice (a Found box vs. a qty box).

## January: Trane's own labels
Trane's labels get scanned into the WMS at receiving (Comments field), like Franklin and One Source. They sync to the
Customer ID field and the app picks them up with no code change: the Customer ID column, search by their label,
counting by scanning their label, and their barcode on printed sheets all appear automatically once the first ones exist.
Until then those stay hidden, so Trane's screens don't show an empty column.

## Publish (replaces the current Trane app)
1. In the TRAFO_Inventory repo, upload these files over the existing ones:
   `index.html`, `app.js`, `counts.js` (new), `print.js` (new), `styles.css`, `sw.js`, `config.js`, `README.md`.
   `manifest.json` and `icons/` are unchanged.
2. Same URL as today: `https://nbr1hawgfan.github.io/TRAFO_Inventory/`. The new service worker replaces the
   old one automatically; a hard refresh helps on any device that still shows the old screens.
3. Everyone signs in again once (the app now uses the new `customer-app` server function). Existing Trane PINs keep working.

**Roll back:** the previous version is in the repo's history (commit `a760095`). Re-upload its `index.html`, `app.js`,
`styles.css`, `sw.js` and `config.js`; the old `customer-inventory` server function is still running untouched.

## PIN users (Supabase SQL editor)
```sql
select public.cust_app_add_user_role('TRAFO', 'Tim - LWH', '87654321', 'lwh');          -- LWH counter / reviewer
select public.cust_app_add_user_role('TRAFO', 'Name - Trane', '12345678', 'customer');  -- Trane user
select * from public.cust_app_list_users('TRAFO');
select * from public.cust_app_activity('TRAFO', 50);
```
Existing Trane users are "customer" role. LWH users are per customer, so add yours for TRAFO separately from FRAWI.

## Suggested schedules
About 145 bays in use at the warehouses this app shows: a weekly bay rotation over 4 runs counts every bay about
once a month (about 37 bays per count). Add a monthly "busiest items" schedule if Trane wants their top movers checked more often.

The backend (tables, functions, server function) is documented in the FRAWI_Inventory package's `supabase/` folder;
it is shared by both apps.
