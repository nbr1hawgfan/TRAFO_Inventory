/* Customer Inventory PWA - shared app code. Customer-specific values live in config.js. */
(function () {
  "use strict";
  const C = window.APP_CONFIG;
  const KEY = "custinv_" + C.customer;
  const $ = (id) => document.getElementById(id);
  const S = { token: null, name: "", summary: null, page: 1, pages: 1, query: "", loc: "ALL",
              itemSort: { key: "pallets", asc: false }, tx: null, txView: "loads", party: null };

  /* ---------- helpers ---------- */
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } },
    clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
  };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => (v === null || v === undefined || v === "") ? "" : Number(v).toLocaleString("en-US");
  const plural = (n, w) => `${num(n)} ${w}${Number(n) === 1 ? "" : "s"}`;
  function fmtDate(v) {                     // 'YYYY-MM-DD' -> MM/DD/YYYY without timezone shifts
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ""); return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
  }
  function xlDate(v) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : ""; }
  function isoLocal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function busy(on, text) { $("busyText").textContent = text || "Loading"; $("busy").hidden = !on; }

  const NUM_KEYS = new Set(["qty", "age_days", "pallets", "bays", "max_age", "loads"]);
  const DATE_KEYS = new Set(["date_received", "date", "oldest", "first", "last"]);

  async function api(action, payload = {}) {
    let res;
    try {
      res = await fetch(C.api, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, token: S.token, ...payload }) });
    } catch {
      throw new Error("Can't reach the inventory server. Check your connection and try again.");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.error === "SESSION_EXPIRED") { signOut(true); throw new Error("SESSION_EXPIRED"); }
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  /* ---------- sign in / out ---------- */
  async function signIn() {
    const pin = $("pin").value.trim();
    $("loginMsg").textContent = "";
    if (!/^\d{6,8}$/.test(pin)) { $("loginMsg").textContent = "Your PIN is 6 to 8 digits."; return; }
    $("loginBtn").disabled = true; $("loginBtn").textContent = "Signing in";
    try {
      const r = await api("login", { customer: C.customer, pin });
      S.token = r.token; S.name = r.name;
      store.set({ token: r.token, name: r.name });
      $("pin").value = "";
      await openApp();
    } catch (e) {
      $("loginMsg").textContent = e.message;
    } finally {
      $("loginBtn").disabled = false; $("loginBtn").textContent = "Sign in";
    }
  }

  function signOut(expired) {
    if (S.token && !expired) api("logout").catch(() => {});
    S.token = null; store.clear();
    $("app").hidden = true; $("login").hidden = false;
    $("loginMsg").textContent = expired ? "Your session ended. Sign in again to continue." : "";
    $("pin").focus();
  }

  async function openApp() {
    $("login").hidden = true; $("app").hidden = false;
    $("userName").textContent = S.name;
    busy(true, "Loading inventory");
    try {
      S.summary = await api("summary");
      renderSummary();
      await search(1);
    } catch (e) { if (e.message !== "SESSION_EXPIRED") alert(e.message); }
    finally { busy(false); }
  }

  /* ---------- summary ---------- */
  function renderSummary() {
    const s = S.summary;
    $("tPallets").textContent = num(s.total_pallets);
    $("tQty").textContent = num(s.total_qty);
    $("tItems").textContent = num(s.total_items);
    $("tLocs").textContent = num(s.locations.length);
    if (s.as_of) {
      const d = new Date(s.as_of);
      $("asOf").textContent = "Updated " + d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    }
    const sel = $("loc");
    sel.innerHTML = '<option value="ALL">All warehouses</option>' +
      s.locations.map((l) => `<option value="${esc(l.code)}">${esc(l.label)} (${num(l.pallets)})</option>`).join("");
    sel.hidden = s.locations.length < 2;
    renderItems();
  }

  /* ---------- inventory ---------- */
  function columns() { return S.summary.customer.columns; }

  function cell(key, row) {
    const v = row[key];
    if (DATE_KEYS.has(key)) return `<td>${fmtDate(v)}</td>`;
    if (NUM_KEYS.has(key)) return `<td class="r">${num(v)}</td>`;
    if (key === "item_description") return `<td class="wrap">${esc(v)}</td>`;
    return `<td>${esc(v)}</td>`;
  }

  async function search(page) {
    S.query = $("q").value.trim(); S.loc = $("loc").value || "ALL";
    busy(true, "Searching");
    try {
      const r = await api("search", { query: S.query, location: S.loc, page });
      S.page = r.page; S.pages = r.pages;
      const cols = columns(), showMatch = !!S.query;
      $("invTable").querySelector("thead").innerHTML = "<tr>" +
        cols.map((c) => `<th${NUM_KEYS.has(c.key) ? ' class="r"' : ""}>${esc(c.label)}</th>`).join("") +
        (showMatch ? "<th>Matched on</th>" : "") + "</tr>";
      $("invTable").querySelector("tbody").innerHTML = r.rows.length
        ? r.rows.map((row) => "<tr>" + cols.map((c) => cell(c.key, row)).join("") +
            (showMatch ? `<td><span class="match">${esc(row.matched_on)}</span></td>` : "") + "</tr>").join("")
        : `<tr><td class="empty" colspan="${cols.length + 1}">No pallets match "${esc(S.query)}". Try part of an item number, LWH ID, or INV receipt.</td></tr>`;
      $("invInfo").textContent = S.query
        ? `${num(r.total)} pallets match "${S.query}" (qty ${num(r.qty)})`
        : `${num(r.total)} pallets on hand (qty ${num(r.qty)})`;
      $("pageInfo").textContent = `Page ${S.page} of ${S.pages}`;
      $("prevBtn").disabled = S.page <= 1; $("nextBtn").disabled = S.page >= S.pages;
    } catch (e) { if (e.message !== "SESSION_EXPIRED") alert(e.message); }
    finally { busy(false); }
  }

  /* ---------- items ---------- */
  function renderItems() {
    const f = $("itemFilter").value.trim().toUpperCase();
    const { key, asc } = S.itemSort;
    let rows = S.summary.items.filter((i) => !f || (i.item_number || "").toUpperCase().includes(f) ||
                                                   (i.description || "").toUpperCase().includes(f));
    rows = rows.slice().sort((a, b) => {
      const x = a[key] ?? "", y = b[key] ?? "";
      const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true });
      return asc ? c : -c;
    });
    $("itemTable").querySelectorAll("th[data-sort]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.sort === key);
      th.classList.toggle("asc", th.dataset.sort === key && asc);
    });
    $("itemTable").querySelector("tbody").innerHTML = rows.length ? rows.map((i) => `<tr>
        <td>${esc(i.item_number)}</td><td class="wrap">${esc(i.description)}</td>
        <td class="r">${num(i.pallets)}</td><td class="r">${num(i.qty)}</td><td class="r">${num(i.bays)}</td>
        <td>${fmtDate(i.oldest)}</td><td class="r">${num(i.max_age)}</td>
        <td><button class="btn link" data-item="${esc(i.item_number)}">View pallets</button></td></tr>`).join("")
      : `<tr><td class="empty" colspan="8">No items match "${esc(f)}".</td></tr>`;
    $("itemInfo").textContent = `${num(rows.length)} of ${num(S.summary.items.length)} item numbers`;
    S.itemRows = rows;
  }

  /* ---------- transactions ---------- */
  function setRange(days) {
    const to = new Date(), from = new Date();
    if (days === 1) { to.setDate(to.getDate() - 1); from.setDate(from.getDate() - 1); }
    else if (days > 1) from.setDate(from.getDate() - (days - 1));
    $("txFrom").value = isoLocal(from); $("txTo").value = isoLocal(to);
  }

  async function loadTx(log) {
    busy(true, "Loading transactions");
    try {
      S.party = null;
      S.tx = await api("transactions", { from: $("txFrom").value, to: $("txTo").value, direction: $("txDir").value, log: !!log });
      if (S.tx.from !== $("txFrom").value) $("txFrom").value = S.tx.from;
      renderTx();
      return S.tx;
    } catch (e) { if (e.message !== "SESSION_EXPIRED") alert(e.message); return null; }
    finally { busy(false); }
  }

  const LOAD_COLS = [["date", "Date"], ["direction", "Direction"], ["inv_receipt", "INV Receipt"], ["bill_to_ref", "Bill-To Ref"],
    ["pallets", "Pallets"], ["qty", "Qty"], ["items", "Item #s"], ["carrier", "Carrier"], ["trailer", "Trailer"],
    ["seal", "Seal"], ["shipper", "Shipper"], ["consignee", "Consignee"], ["location", "Warehouse"], ["status", "Status"]];
  const PALLET_COLS = [["date", "Date"], ["direction", "Direction"], ["inv_receipt", "INV Receipt"], ["bill_to_ref", "Bill-To Ref"],
    ["lwh_id", "LWH ID"], ["item_number", "Item #"], ["item_description", "Item Description"], ["lot_number", "Lot #"],
    ["qty", "Qty"], ["location", "Warehouse"]];

  /* Shipper for inbound loads, consignee for outbound. Loads not closed out yet have no shipper. */
  const OPEN_LABEL = "Not closed out yet";
  const partyOf = (l) => (l.direction === "Inbound" ? l.shipper : l.consignee) || (l.status === "Open" ? OPEN_LABEL : "Not recorded");
  const PARTY_COLS = [["party", "Shipper / Consignee"], ["direction", "Direction"], ["loads", "Loads"], ["pallets", "Pallets"],
    ["qty", "Qty"], ["first", "First Load"], ["last", "Last Load"]];

  function partners() {
    const m = new Map();
    S.tx.loads.forEach((l) => {
      const k = l.direction + "|" + partyOf(l);
      const p = m.get(k) || { party: partyOf(l), direction: l.direction, loads: 0, pallets: 0, qty: 0, first: l.date, last: l.date };
      p.loads++; p.pallets += Number(l.pallets) || 0; p.qty += Number(l.qty) || 0;
      if (l.date < p.first) p.first = l.date; if (l.date > p.last) p.last = l.date;
      m.set(k, p);
    });
    return [...m.values()].sort((a, b) => (a.direction === b.direction ? b.loads - a.loads || a.party.localeCompare(b.party)
                                            : a.direction === "Inbound" ? -1 : 1));
  }

  function filtered() {
    const t = S.tx, f = S.party;
    if (!f) return { loads: t.loads, pallets: t.pallets };
    const loads = t.loads.filter((l) => l.direction === f.direction && partyOf(l) === f.party);
    const ids = new Set(loads.map((l) => l.inv_receipt));
    return { loads, pallets: t.pallets.filter((p) => ids.has(p.inv_receipt)) };
  }

  function setView(v) {
    S.txView = v;
    document.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x.dataset.view === v));
    renderTx();
  }

  function renderTx() {
    const t = S.tx; if (!t) return;
    const T = t.totals;
    $("txTotals").innerHTML = `
      <div class="tx-box"><h3>Inbound</h3><p><strong>${num(T.inbound_loads)}</strong> loads &middot; <strong>${num(T.inbound_pallets)}</strong> pallets &middot; qty <strong>${num(T.inbound_qty)}</strong></p></div>
      <div class="tx-box out"><h3>Outbound</h3><p><strong>${num(T.outbound_loads)}</strong> loads &middot; <strong>${num(T.outbound_pallets)}</strong> pallets &middot; qty <strong>${num(T.outbound_qty)}</strong></p></div>`;

    const f = S.party, data = filtered();
    $("txFilter").hidden = !f || S.txView === "partners";
    if (f) $("txFilterText").textContent = `Showing ${f.direction.toLowerCase()} loads for ${f.party}: ${plural(data.loads.length, "load")}, ${plural(data.pallets.length, "pallet")}`;
    const range = `${fmtDate(t.from)} to ${fmtDate(t.to)}`;

    if (S.txView === "partners") {
      const rows = partners(), max = Math.max(1, ...rows.map((r) => r.loads));
      $("txTable").querySelector("thead").innerHTML = "<tr>" + PARTY_COLS.map(([k, l]) => `<th${NUM_KEYS.has(k) ? ' class="r"' : ""}>${l}</th>`).join("") + "<th></th></tr>";
      $("txTable").querySelector("tbody").innerHTML = rows.length ? rows.map((r, i) => `<tr class="clickable" data-i="${i}" tabindex="0" title="Show these loads">
          <td>${esc(r.party)}</td><td><span class="dir ${r.direction}">${r.direction}</span></td>
          <td class="r"><strong>${num(r.loads)}</strong></td><td class="r">${num(r.pallets)}</td><td class="r">${num(r.qty)}</td>
          <td>${fmtDate(r.first)}</td><td>${fmtDate(r.last)}</td>
          <td class="bar-cell"><div class="bar ${r.direction === "Inbound" ? "in" : ""}" style="width:${Math.round(r.loads / max * 100)}%"></div></td></tr>`).join("")
        : `<tr><td class="empty" colspan="8">No loads in this date range.</td></tr>`;
      S.partnerRows = rows;
      const nIn = rows.filter((r) => r.direction === "Inbound").length;
      $("txInfo").textContent = `${range}: ${num(nIn)} shippers sent inbound loads. Select a row to see those loads.`;
      return;
    }

    const loads = S.txView === "loads", cols = loads ? LOAD_COLS : PALLET_COLS, rows = loads ? data.loads : data.pallets;
    $("txTable").querySelector("thead").innerHTML = "<tr>" + cols.map(([k, l]) => `<th${NUM_KEYS.has(k) ? ' class="r"' : ""}>${l}</th>`).join("") + "</tr>";
    $("txTable").querySelector("tbody").innerHTML = rows.length ? rows.map((r) => "<tr>" + cols.map(([k]) => {
      if (k === "direction") return `<td><span class="dir ${esc(r[k])}">${esc(r[k])}</span></td>`;
      if (k === "status") return `<td class="${r[k] === "Open" ? "status-open" : ""}">${esc(r[k] === "Open" ? "Open (not closed out)" : r[k])}</td>`;
      if (k === "items") return `<td class="wrap">${esc(r[k])}</td>`;
      return cell(k, r);
    }).join("") + "</tr>").join("")
      : `<tr><td class="empty" colspan="${cols.length}">No ${loads ? "loads" : "pallets"} in this date range.</td></tr>`;
    $("txInfo").textContent = `${range}: ${num(rows.length)} ${loads ? "loads" : "pallets"}`;
  }

  /* ---------- Excel ---------- */
  function sheet(cols, rows) {
    const aoa = [cols.map((c) => c[1])].concat(rows.map((r) => cols.map(([k]) => {
      const v = r[k];
      if (DATE_KEYS.has(k)) return xlDate(v);
      if (NUM_KEYS.has(k)) return v === null || v === undefined || v === "" ? "" : Number(v);
      return v === null || v === undefined ? "" : String(v);   // IDs stay text
    })));
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "mm/dd/yyyy" });
    ws["!cols"] = cols.map(([k, l]) => ({ wch: Math.min(48, Math.max(l.length + 2,
      ...rows.slice(0, 300).map((r) => String(r[k] ?? "").length + 2))) }));
    if (aoa.length > 1) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: cols.length - 1 } }) };
    return ws;
  }
  const safeTab = (s) => String(s).replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
  const stamp = () => isoLocal(new Date());

  async function exportInventory() {
    if (!window.XLSX) return alert("The Excel tool didn't load. Refresh the page and try again.");
    busy(true, "Building Excel file");
    try {
      const r = await api("export", { query: $("q").value.trim(), location: $("loc").value || "ALL" });
      const cols = columns().map((c) => [c.key, c.label]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet(cols, r.rows), "All Warehouses");
      const byLoc = {};
      r.rows.forEach((row) => (byLoc[row.location_code] = byLoc[row.location_code] || []).push(row));
      if (Object.keys(byLoc).length > 1) {
        S.summary.locations.forEach((l) => { if (byLoc[l.code]) XLSX.utils.book_append_sheet(wb, sheet(cols, byLoc[l.code]), safeTab(l.label)); });
      }
      XLSX.writeFile(wb, `${C.fileBase} Inventory ${stamp()}.xlsx`);
    } catch (e) { if (e.message !== "SESSION_EXPIRED") alert(e.message); }
    finally { busy(false); }
  }

  function exportItems() {
    if (!window.XLSX) return alert("The Excel tool didn't load. Refresh the page and try again.");
    const cols = [["item_number", "Item #"], ["description", "Item Description"], ["pallets", "Pallets"], ["qty", "Qty"],
      ["bays", "Bays"], ["oldest", "Oldest Received"], ["max_age", "Oldest Age (Days)"]];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet(cols, S.itemRows || S.summary.items), "Item Summary");
    XLSX.writeFile(wb, `${C.fileBase} Item Summary ${stamp()}.xlsx`);
  }

  async function exportTx() {
    if (!window.XLSX) return alert("The Excel tool didn't load. Refresh the page and try again.");
    const keep = S.party;
    const t = await loadTx(true); if (!t) return;
    if (keep) { S.party = keep; renderTx(); }
    const data = filtered(), wb = XLSX.utils.book_new();
    if (!keep) XLSX.utils.book_append_sheet(wb, sheet(PARTY_COLS, partners()), "By Shipper");
    XLSX.utils.book_append_sheet(wb, sheet(LOAD_COLS, data.loads), "Loads");
    XLSX.utils.book_append_sheet(wb, sheet(PALLET_COLS, data.pallets), "Pallets");
    const who = keep ? " " + keep.party.replace(/[^\w\- ]/g, "").slice(0, 30) : "";
    XLSX.writeFile(wb, `${C.fileBase} Transactions${who} ${t.from} to ${t.to}.xlsx`);
  }

  /* ---------- wiring ---------- */
  function showTab(name) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    ["inventory", "items", "transactions"].forEach((t) => ($("tab-" + t).hidden = t !== name));
    if (name === "transactions" && !S.tx) loadTx(false);
  }

  document.title = C.title;
  $("loginTitle").textContent = C.title; $("appTitle").textContent = C.title;
  $("loginBtn").onclick = signIn;
  $("pin").addEventListener("keydown", (e) => { if (e.key === "Enter") signIn(); });
  $("logoutBtn").onclick = () => signOut(false);
  document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  $("searchBtn").onclick = () => search(1);
  $("q").addEventListener("keydown", (e) => { if (e.key === "Enter") search(1); });
  $("loc").onchange = () => search(1);
  $("prevBtn").onclick = () => search(S.page - 1);
  $("nextBtn").onclick = () => search(S.page + 1);
  $("exportBtn").onclick = exportInventory;
  $("itemFilter").addEventListener("input", renderItems);
  $("itemExportBtn").onclick = exportItems;
  $("itemTable").querySelectorAll("th[data-sort]").forEach((th) => (th.onclick = () => {
    const k = th.dataset.sort;
    S.itemSort = { key: k, asc: S.itemSort.key === k ? !S.itemSort.asc : ["item_number", "description", "oldest"].includes(k) };
    renderItems();
  }));
  $("itemTable").addEventListener("click", (e) => {
    const b = e.target.closest("[data-item]"); if (!b) return;
    $("q").value = b.dataset.item; showTab("inventory"); search(1);
  });
  $("txBtn").onclick = () => loadTx(false);
  $("txExportBtn").onclick = exportTx;
  document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => { setRange(+c.dataset.days); loadTx(false); }));
  document.querySelectorAll(".seg-btn").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  function pickParty(tr) {
    const r = S.partnerRows && S.partnerRows[+tr.dataset.i]; if (!r) return;
    S.party = { party: r.party, direction: r.direction }; setView("loads");
  }
  $("txTable").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-i]"); if (tr) pickParty(tr); });
  $("txTable").addEventListener("keydown", (e) => { const tr = e.target.closest("tr[data-i]"); if (tr && e.key === "Enter") pickParty(tr); });
  $("txFilterClear").onclick = () => { S.party = null; renderTx(); };
  setRange(7);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  const saved = store.get();
  if (saved && saved.token) { S.token = saved.token; S.name = saved.name; openApp(); }
  else { $("login").hidden = false; $("pin").focus(); }
})();
