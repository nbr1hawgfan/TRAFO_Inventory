/*===========================================================
  CUSTOMER INVENTORY - shared Edge Function (PIN gate)
  One function for every customer PWA. The PWA sends its
  customer code only at sign-in; after that the session
  decides which customer's data comes back, so one
  customer's PIN can never read another customer's data.

  POST JSON { action, ... }:
    login        { customer, pin }              -> { token, name, customer }
    logout       { token }
    summary      { token }                      -> config + totals + by-item
    search       { token, query, location, page }
    export       { token, query, location }     -> all matching rows
    transactions { token, from, to, direction } -> loads + pallets
  Deployed with verify_jwt = false: it does its own auth.
===========================================================*/
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://nbr1hawgfan.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:5500",
];
const SESSION_HOURS = 8;
const LOCKOUT_FAILS = 10;
const LOCKOUT_MINUTES = 15;
const PAGE_SIZE = 100;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function cors(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function log(customer: string, userName: string, action: string) {
  await db.from("cust_app_access_log").insert({ customer_code: customer, user_name: userName, action });
}

async function login(customerRaw: string, pinRaw: string) {
  const customer = String(customerRaw ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(customer)) return { status: 400, body: { error: "This app is not set up correctly." } };

  const { data: cu } = await db.from("cust_app_customers")
    .select("code, display_name").eq("code", customer).eq("active", true).maybeSingle();
  if (!cu) return { status: 400, body: { error: "This app is not set up correctly." } };

  const since = new Date(Date.now() - LOCKOUT_MINUTES * 60000).toISOString();
  const { count } = await db.from("cust_app_login_failures")
    .select("id", { count: "exact", head: true }).eq("customer_code", customer).gte("at", since);
  if ((count ?? 0) >= LOCKOUT_FAILS) {
    return { status: 429, body: { error: "Too many incorrect PINs. Sign-in is paused for 15 minutes." } };
  }

  const pin = String(pinRaw ?? "").trim();
  let user: { id: number; name: string } | null = null;
  if (/^\d{6,8}$/.test(pin)) {
    const { data, error } = await db.from("cust_app_users")
      .select("id, name, pin_salt, pin_hash").eq("customer_code", customer).eq("active", true);
    if (error) throw error;
    for (const u of data ?? []) {
      if (await sha256Hex(u.pin_salt + ":" + pin) === u.pin_hash) { user = { id: u.id, name: u.name }; break; }
    }
  }

  if (!user) {
    await db.from("cust_app_login_failures").insert({ customer_code: customer });
    await new Promise((r) => setTimeout(r, 1200)); // slows guessing
    return { status: 401, body: { error: "That PIN is not recognized. Check it and try again." } };
  }

  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
  await db.from("cust_app_sessions").insert({
    token_hash: await sha256Hex(token), user_id: user.id, customer_code: customer, expires_at: expires,
  });
  await db.from("cust_app_users").update({ last_login: new Date().toISOString() }).eq("id", user.id);
  await log(customer, user.name, "Signed in");

  await db.from("cust_app_sessions").delete().lt("expires_at", new Date().toISOString());
  await db.from("cust_app_login_failures").delete().lt("at", new Date(Date.now() - 86400000).toISOString());

  return { status: 200, body: { token, name: user.name, customer: cu.display_name } };
}

async function session(token: string): Promise<{ name: string; customer: string } | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const { data } = await db.from("cust_app_sessions")
    .select("expires_at, customer_code, cust_app_users!inner(name, active, customer_code)")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const u = (data as any)?.cust_app_users;
  if (!data || !u?.active || u.customer_code !== data.customer_code || new Date(data.expires_at) < new Date()) return null;
  return { name: u.name as string, customer: data.customer_code as string };
}

function direction(raw: unknown): string {
  const d = String(raw ?? "ALL").toUpperCase();
  return d === "INBOUND" ? "Inbound" : d === "OUTBOUND" ? "Outbound" : "ALL";
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "login") {
      const r = await login(body.customer, body.pin);
      return json(r.body, r.status, origin);
    }

    if (action === "logout") {
      if (body.token) await db.from("cust_app_sessions").delete().eq("token_hash", await sha256Hex(String(body.token)));
      return json({ ok: true }, 200, origin);
    }

    const s = await session(String(body.token ?? ""));
    if (!s) return json({ error: "SESSION_EXPIRED" }, 401, origin);

    if (action === "summary") {
      const { data, error } = await db.rpc("cust_app_summary", { p_customer: s.customer });
      if (error) throw error;
      return json(data, 200, origin);
    }

    if (action === "search" || action === "export") {
      const query = String(body.query ?? "").slice(0, 60);
      const location = String(body.location ?? "ALL").slice(0, 20);
      const isExport = action === "export";
      const page = Math.max(1, Number(body.page) || 1);
      const { data, error } = await db.rpc("cust_app_search", {
        p_customer: s.customer, p_query: query, p_location: location,
        p_limit: isExport ? 1000000 : PAGE_SIZE,
        p_offset: isExport ? 0 : (page - 1) * PAGE_SIZE,
      });
      if (error) throw error;
      if (isExport) {
        await log(s.customer, s.name, "Exported " + data.total + " pallets" +
          (query ? ` matching "${query}"` : "") + (location !== "ALL" ? " at " + location : ""));
        return json({ total: data.total, rows: data.rows }, 200, origin);
      }
      const total = Number(data.total) || 0;
      return json({ ...data, page, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) }, 200, origin);
    }

    if (action === "transactions") {
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      const from = String(body.from ?? ""), to = String(body.to ?? "");
      if (!iso.test(from) || !iso.test(to)) return json({ error: "Choose a valid date range." }, 400, origin);
      const { data, error } = await db.rpc("cust_app_transactions", {
        p_customer: s.customer, p_from: from, p_to: to, p_direction: direction(body.direction),
      });
      if (error) throw error;
      if (body.log) await log(s.customer, s.name, `Exported transactions ${data.from} to ${data.to}`);
      return json(data, 200, origin);
    }

    return json({ error: "Unknown action" }, 400, origin);
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong loading inventory. Please try again." }, 500, origin);
  }
});
