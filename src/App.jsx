import React, { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Minus, Trash2, X, Package, Wallet, Users, AlertTriangle, ArrowUpRight, ArrowDownRight, Sprout, Milk, Beef, Snowflake, Home, ShoppingBasket, Sparkles, KeyRound, MoreHorizontal, Search, Pencil, Check, Archive, ChevronDown, ChevronUp, ShoppingCart, Activity as ActivityIcon, HandCoins, HelpCircle, Lock, Eye, EyeOff, LayoutDashboard, Target, Moon, Sun, Settings, LogOut, ShieldCheck, Upload, Download, Copy, FileSpreadsheet } from "lucide-react";
import { supabase } from "./supabaseClient";

// ---- storage helpers ---------------------------------------------------
const KEYS = {
  members: "household:members",
  pantry: "household:pantry",
  tx: "household:transactions",
  permissions: "household:permissions",
  credentials: "household:credentials",
  history: "household:tx-history",
  shoppingExtra: "household:shopping-extra",
  activity: "household:activity",
};

async function loadKey(key, fallback) {
  try {
    const res = await window.storage.get(key, true);
    return res ? JSON.parse(res.value) : fallback;
  } catch {
    return fallback;
  }
}
async function saveKey(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value), true);
  } catch {
    // best effort
  }
}

// ---- theme ("Sage Mist" light / "Forest Night" dark) — same look as Money Manager ----
const PALETTES = {
  light: {
    bg: "#EDF1EA", card: "#F8FAF6", ink: "#26332A", text2: "#4F5C52", muted: "#68766C", faint: "#A3AFA5",
    line: "#D9E1D7", soft: "#E1E9DF", pos: "#4E8A63", neg: "#BF6455", warn: "#C79A3E",
    heroA: "#5A9477", heroB: "#3F7B6D", shadow: "0 2px 12px rgba(38,51,42,0.06)", scrim: "rgba(38,51,42,0.42)",
  },
  dark: {
    bg: "#111814", card: "#19221D", ink: "#DCE6DD", text2: "#B2C0B5", muted: "#8C9B90", faint: "#5E6C62",
    line: "#2A3730", soft: "#222D27", pos: "#58A06F", neg: "#D9776A", warn: "#D2A94F",
    heroA: "#2E5D49", heroB: "#244A47", shadow: "0 2px 14px rgba(0,0,0,0.30)", scrim: "rgba(0,0,0,0.55)",
  },
};
// T is read by every component while rendering; the root component swaps its values when the theme changes.
const T = { ...PALETTES.light };
let HIDE_AMOUNTS = false;
const applyTheme = (name, hide) => {
  Object.assign(T, PALETTES[name] || PALETTES.light);
  HIDE_AMOUNTS = !!hide;
};
const PREFS_KEY = "household_prefs"; // per-device (not synced)
const DEFAULT_PREFS = { theme: "auto", hide: false, autoLockMin: 0 };
const loadPrefs = () => {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return { ...DEFAULT_PREFS }; }
};

// ---- secrets (passwords & recovery code are stored as SHA-256 hashes) ----
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const hashPassword = (username, password) => sha256(`hh:${String(username).trim().toLowerCase()}:${password}`);
const RECOVERY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const genRecoveryCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => RECOVERY_CHARS[b % RECOVERY_CHARS.length]).join("").match(/.{4}/g).join("-");
};
const formatRecovery = (v) => (v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16).match(/.{1,4}/g) || []).join("-");
const hashRecovery = (code) => sha256("recovery:" + code.toUpperCase().replace(/[^A-Z0-9]/g, ""));

// Checks a password against a stored credential. Understands the old plaintext format
// ({ password }) as well as the new hashed one ({ passwordHash }); `legacy` tells the caller to upgrade it.
async function checkSecret(cred, username, password) {
  if (!cred) return { ok: false };
  if (cred.passwordHash) return { ok: (await hashPassword(username, password)) === cred.passwordHash };
  if (cred.password) return { ok: cred.password === password, legacy: cred.password === password };
  return { ok: false };
}
const adminCred = (c) => ({ passwordHash: c.adminPasswordHash, password: c.adminPassword });
const hasAdmin = (c) => !!(c.adminPasswordHash || c.adminPassword);

const uid = () => Math.random().toString(36).slice(2, 10);
const moneyRaw = (n) => (n < 0 ? "-₹" : "₹") + Math.abs(n).toFixed(2);
// money() honours the "hide amounts" privacy switch; moneyRaw() is for text that gets exported.
const money = (n) => (HIDE_AMOUNTS ? "₹ ••••" : moneyRaw(n));

const CATEGORIES = [
  { name: "Produce", color: "#4C8B5C", icon: Sprout },
  { name: "Dairy & Eggs", color: "#4A7FB5", icon: Milk },
  { name: "Meat & Fish", color: "#C05C4A", icon: Beef },
  { name: "Frozen", color: "#4CA0AE", icon: Snowflake },
  { name: "Pantry", color: "#C79A3E", icon: ShoppingBasket },
  { name: "Household", color: "#8D6CB0", icon: Home },
];
const catInfo = (name) => CATEGORIES.find(c => c.name === name) || CATEGORIES[4];

const UNITS = ["pcs", "kg", "gm", "ltr"];
const UNIT_STEP = { pcs: 1, kg: 0.5, gm: 50, ltr: 0.5 };
const round2 = (n) => Math.round(n * 100) / 100;

// Nets out all peer-paid expenses into simplified "A owes B" debts.
function computePeerDebts(tx) {
  const pairs = {};
  tx.filter(t => t.type === "peer").forEach(t => {
    const share = t.amount / t.splitWith.length;
    t.splitWith.forEach(ower => {
      if (ower === t.payer) return;
      const names = [ower, t.payer].sort();
      const key = names.join("|");
      if (!pairs[key]) pairs[key] = { names, net: 0 };
      // net > 0 means names[0] owes names[1]; ower paying toward payer moves it that way
      pairs[key].net += ower === names[0] ? share : -share;
    });
  });
  return Object.values(pairs)
    .map(p => {
      if (Math.abs(p.net) < 0.01) return null;
      return p.net > 0
        ? { from: p.names[0], to: p.names[1], amount: round2(p.net) }
        : { from: p.names[1], to: p.names[0], amount: round2(-p.net) };
    })
    .filter(Boolean);
}

const EXPENSE_CATEGORIES = [
  { name: "Groceries", color: "#4C8B5C", icon: ShoppingBasket },
  { name: "Rent", color: "#4A7FB5", icon: KeyRound },
  { name: "Maid", color: "#8D6CB0", icon: Sparkles },
  { name: "Household Items", color: "#C79A3E", icon: Package },
  { name: "Other", color: "#8A9186", icon: MoreHorizontal },
];
const expCatInfo = (name) => EXPENSE_CATEGORIES.find(c => c.name === name) || EXPENSE_CATEGORIES[4];

const IDENTITY_KEY = "household:my-identity";
async function loadIdentity() {
  try {
    const res = await window.storage.get(IDENTITY_KEY, false);
    return res ? JSON.parse(res.value) : null;
  } catch {
    return null;
  }
}
async function saveIdentity(value) {
  try {
    await window.storage.set(IDENTITY_KEY, JSON.stringify(value), false);
  } catch {
    // best effort
  }
}

const DEFAULT_PERMS = { budget: true, people: true };
const getPerms = (permissions, memberId) => (memberId && permissions[memberId]) ? permissions[memberId] : DEFAULT_PERMS;

export default function PantryLedger() {
  const [tab, setTab] = useState("overview");
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [systemDark, setSystemDark] = useState(() => !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const [showSettings, setShowSettings] = useState(false);
  const [members, setMembers] = useState([]);
  const [pantry, setPantry] = useState([]);
  const [tx, setTx] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [credentials, setCredentials] = useState({ adminUsername: "", adminPassword: "", users: {} });
  const [history, setHistory] = useState([]);
  const [shoppingExtra, setShoppingExtra] = useState([]);
  const [activity, setActivity] = useState([]);
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [toasts, setToasts] = useState([]);
  const seenActivityIds = React.useRef(null);

  useEffect(() => {
    (async () => {
      const [m, p, t, perms, creds, hist, extra, act, id] = await Promise.all([
        loadKey(KEYS.members, []),
        loadKey(KEYS.pantry, []),
        loadKey(KEYS.tx, []),
        loadKey(KEYS.permissions, {}),
        loadKey(KEYS.credentials, { adminUsername: "", adminPassword: "", users: {} }),
        loadKey(KEYS.history, []),
        loadKey(KEYS.shoppingExtra, []),
        loadKey(KEYS.activity, []),
        loadIdentity(),
      ]);
      setMembers(m);
      setPantry(p);
      setTx(t);
      setPermissions(perms);
      setCredentials(creds);
      setHistory(hist);
      setShoppingExtra(extra);
      setActivity(act);
      seenActivityIds.current = new Set(act.map(a => a.id));
      setIdentity(id);
      setReady(true);
      setIdentityChecked(true);
    })();
  }, []);

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const n = { ...p, ...patch };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(n)); } catch { /* best effort */ }
      return n;
    });
  }, []);
  const resolvedTheme = prefs.theme === "auto" ? (systemDark ? "dark" : "light") : prefs.theme;
  applyTheme(resolvedTheme, prefs.hide); // swap the palette BEFORE any child renders

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const h = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  useEffect(() => {
    document.body.style.background = T.bg;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", T.bg);
  }, [resolvedTheme]);

  const chooseIdentity = (id) => {
    setIdentity(id);
    saveIdentity(id);
  };
  const switchIdentity = useCallback(() => {
    setShowSettings(false);
    setIdentity(null);
    saveIdentity(null);
  }, []);

  // Optional idle log-out (off by default)
  useEffect(() => {
    if (!identity || !prefs.autoLockMin) return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const evs = ["pointerdown", "keydown", "touchstart", "scroll"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => { if (Date.now() - last > prefs.autoLockMin * 60000) switchIdentity(); }, 10000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(iv); };
  }, [identity, prefs.autoLockMin, switchIdentity]);

  const persistMembers = useCallback((next) => { setMembers(next); saveKey(KEYS.members, next); }, []);
  const persistPantry = useCallback((next) => { setPantry(next); saveKey(KEYS.pantry, next); }, []);
  const persistTx = useCallback((next) => { setTx(next); saveKey(KEYS.tx, next); }, []);
  const persistPermissions = useCallback((next) => { setPermissions(next); saveKey(KEYS.permissions, next); }, []);
  const persistCredentials = useCallback((next) => { setCredentials(next); saveKey(KEYS.credentials, next); }, []);
  const persistHistory = useCallback((next) => { setHistory(next); saveKey(KEYS.history, next); }, []);
  const persistShoppingExtra = useCallback((next) => { setShoppingExtra(next); saveKey(KEYS.shoppingExtra, next); }, []);

  const reloadAll = useCallback(async () => {
    const [m, p, t, perms, creds, hist, extra, act] = await Promise.all([
      loadKey(KEYS.members, []),
      loadKey(KEYS.pantry, []),
      loadKey(KEYS.tx, []),
      loadKey(KEYS.permissions, {}),
      loadKey(KEYS.credentials, { adminUsername: "", adminPassword: "", users: {} }),
      loadKey(KEYS.history, []),
      loadKey(KEYS.shoppingExtra, []),
      loadKey(KEYS.activity, []),
    ]);
    setMembers(m);
    setPantry(p);
    setTx(t);
    setPermissions(perms);
    setCredentials(creds);
    setHistory(hist);
    setShoppingExtra(extra);
    setActivity(act);
  }, []);

  // Live sync: when anyone in the house changes data, pull the latest
  // into every other open device without needing a page refresh.
  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel("household_data_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "household_data" }, () => {
        reloadAll();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ready, reloadAll]);

  // Notification toasts: whenever the shared activity feed gets new pantry
  // entries of interest (item added, running low, out of stock), pop a
  // toast for everyone with the page open — from any device, any user.
  const NOTIFY_TYPES = ["added", "low_stock", "out_of_stock"];
  useEffect(() => {
    if (!ready || seenActivityIds.current === null) return;
    const fresh = activity.filter(a => !seenActivityIds.current.has(a.id));
    if (fresh.length === 0) return;
    fresh.forEach(a => seenActivityIds.current.add(a.id));
    const toastworthy = fresh.filter(a => NOTIFY_TYPES.includes(a.type));
    if (toastworthy.length > 0) {
      setToasts(prev => [...toastworthy.map(a => ({ ...a, toastId: uid() })), ...prev].slice(0, 6));
    }
  }, [activity, ready]);

  const dismissToast = useCallback((toastId) => {
    setToasts(prev => prev.filter(t => t.toastId !== toastId));
  }, []);

  const totalContributed = tx.filter(t => t.type === "contribution").reduce((s, t) => s + t.amount, 0);
  const totalSpent = tx.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const poolBalance = totalContributed - totalSpent;
  const lowStockCount = pantry.filter(i => i.qty <= i.lowThreshold).length;

  const isAdmin = identity?.role === "admin";
  const myPerms = identity?.role === "member" ? getPerms(permissions, identity.memberId) : DEFAULT_PERMS;
  const canSeeBudget = isAdmin || myPerms.budget;
  const canSeePeople = isAdmin || myPerms.people;
  const displayName = isAdmin ? (credentials.adminName || credentials.adminUsername || "Admin") : (identity?.name || "Housemate");
  const actorLabel = isAdmin ? (credentials.adminName || "Admin") : (identity?.name || "A housemate");

  const logActivity = useCallback((message, scope, type) => {
    setActivity(prev => {
      const next = [{ id: uid(), actor: actorLabel, message, scope, type: type || null, date: new Date().toISOString() }, ...prev].slice(0, 150);
      saveKey(KEYS.activity, next);
      return next;
    });
  }, [actorLabel]);

  const closeMonth = useCallback(() => {
    const now = new Date();
    const label = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const record = {
      id: uid(),
      label,
      closedAt: now.toISOString(),
      tx,
      totalContributed,
      totalSpent,
      perPerson: members.map(m => ({
        name: m.name,
        target: m.contribution,
        contributed: tx.filter(t => t.type === "contribution" && t.person === m.name).reduce((s, t) => s + t.amount, 0),
      })),
    };
    persistHistory([record, ...history]);
    persistTx([]);
    logActivity(`closed out ${label} (${tx.length} entries archived)`, "budget");
  }, [tx, members, history, totalContributed, totalSpent, persistHistory, persistTx, logActivity]);

  useEffect(() => {
    if (tab === "budget" && !canSeeBudget) setTab("pantry");
    if (tab === "people" && !canSeePeople) setTab("pantry");
    if (tab === "history" && !canSeeBudget) setTab("pantry");
    if (tab === "shopping" && !isAdmin) setTab("pantry");
  }, [tab, canSeeBudget, canSeePeople, isAdmin]);

  // ---- Settings handlers
  const saveName = (name) => persistCredentials({ ...credentials, adminName: name.trim().slice(0, 30) });
  const changePassword = async (current, next) => {
    if (isAdmin) {
      const r = await checkSecret(adminCred(credentials), credentials.adminUsername, current);
      if (!r.ok) return "Current password is incorrect.";
      const { adminPassword, ...rest } = credentials;
      persistCredentials({ ...rest, adminPasswordHash: await hashPassword(credentials.adminUsername, next) });
      return "";
    }
    const mine = credentials.users?.[identity.memberId];
    const r = await checkSecret(mine, mine?.username, current);
    if (!r.ok) return "Current password is incorrect.";
    const { password: _old, ...clean } = mine;
    persistCredentials({ ...credentials, users: { ...credentials.users, [identity.memberId]: { ...clean, passwordHash: await hashPassword(mine.username, next) } } });
    return "";
  };
  const createRecovery = async () => {
    const code = genRecoveryCode();
    persistCredentials({ ...credentials, adminRecoveryHash: await hashRecovery(code) });
    return code;
  };
  const downloadFile = (name, text, type) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const isoToday = () => new Date().toISOString().slice(0, 10);
  const exportBackup = () =>
    downloadFile(
      `household-backup_${isoToday()}.json`,
      JSON.stringify({ app: "household-goods", version: 1, exportedAt: new Date().toISOString(), data: { members, pantry, tx, permissions, history, shoppingExtra, activity } }, null, 2),
      "application/json"
    );
  const restoreBackup = async (file) => {
    try {
      const d = JSON.parse(await file.text())?.data;
      const lists = ["members", "pantry", "tx", "history", "shoppingExtra", "activity"];
      if (!d || !lists.every((k) => Array.isArray(d[k])) || typeof d.permissions !== "object") {
        return { ok: false, text: "That doesn't look like a Household Goods backup." };
      }
      if (!window.confirm(`Replace the current data with this backup (${d.members.length} housemates, ${d.pantry.length} pantry items)?`)) {
        return { ok: false, text: "Restore cancelled." };
      }
      persistMembers(d.members); persistPantry(d.pantry); persistTx(d.tx); persistPermissions(d.permissions || {});
      persistHistory(d.history); persistShoppingExtra(d.shoppingExtra);
      setActivity(d.activity); saveKey(KEYS.activity, d.activity);
      return { ok: true, text: "Backup restored." };
    } catch {
      return { ok: false, text: "Couldn't read that file." };
    }
  };
  const exportCsv = () => {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = tx.map((t) => [t.date?.slice(0, 10), t.type, t.category || "", t.person || t.payer || "", t.splitWith?.join("; ") || "", t.amount, q(t.note)]);
    const csv = [["Date", "Type", "Category", "Person/Payer", "Split with", "Amount", "Note"].join(","), ...rows.map((r) => r.join(","))].join("\n");
    downloadFile(`household-ledger_${isoToday()}.csv`, csv, "text/csv;charset=utf-8;");
  };
  const eraseAll = async () => {
    for (const k of Object.values(KEYS)) {
      try { await window.storage.delete(k, true); } catch { /* best effort */ }
    }
    saveIdentity(null);
    localStorage.removeItem("household_login_fails");
    window.location.reload();
  };

  if (!ready || !identityChecked) {
    return (
      <div style={{ background: T.bg, minHeight: "100vh" }} className="flex items-center justify-center">
        <GlobalStyle />
        <div style={{ color: T.muted, fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (!hasAdmin(credentials)) {
    return <AdminSetup credentials={credentials} setCredentials={persistCredentials} onDone={() => chooseIdentity({ role: "admin" })} />;
  }

  if (!identity) {
    return (
      <LoginScreen
        credentials={credentials}
        setCredentials={persistCredentials}
        members={members}
        onLogin={chooseIdentity}
        onErase={eraseAll}
      />
    );
  }

  return (
    <div style={{ background: T.bg, minHeight: "100vh" }}>
      <GlobalStyle />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-24 pt-8 sm:pt-10">
        <Header
          lowStockCount={lowStockCount}
          poolBalance={poolBalance}
          tab={tab}
          setTab={setTab}
          identity={identity}
          canSeeBudget={canSeeBudget}
          canSeePeople={canSeePeople}
          displayName={displayName}
          prefs={prefs}
          setPrefs={setPrefs}
          resolvedTheme={resolvedTheme}
          onSettings={() => setShowSettings(true)}
          onLogout={switchIdentity}
        />
        <div key={tab} className="fade-up">
        {tab === "overview" && (
          <OverviewTab pantry={pantry} shoppingExtra={shoppingExtra} tx={tx} activity={activity} members={members} poolBalance={poolBalance} totalContributed={totalContributed} totalSpent={totalSpent} canSeeBudget={canSeeBudget} canSeePeople={canSeePeople} setTab={setTab} />
        )}
        {tab === "pantry" && <PantryTab pantry={pantry} setPantry={persistPantry} isAdmin={isAdmin} logActivity={logActivity} />}
        {tab === "shopping" && isAdmin && (
          <ShoppingTab pantry={pantry} setPantry={persistPantry} shoppingExtra={shoppingExtra} setShoppingExtra={persistShoppingExtra} actorLabel={actorLabel} logActivity={logActivity} />
        )}
        {tab === "budget" && canSeeBudget && (
          <BudgetTab members={members} setMembers={persistMembers} tx={tx} setTx={persistTx} poolBalance={poolBalance} totalContributed={totalContributed} totalSpent={totalSpent} isAdmin={isAdmin} closeMonth={closeMonth} logActivity={logActivity} />
        )}
        {tab === "people" && canSeePeople && (
          <PeopleTab members={members} setMembers={persistMembers} tx={tx} isAdmin={isAdmin} permissions={permissions} setPermissions={persistPermissions} credentials={credentials} setCredentials={persistCredentials} logActivity={logActivity} />
        )}
        {tab === "history" && canSeeBudget && <HistoryTab history={history} />}
        {tab === "activity" && <ActivityTab activity={activity} canSeeBudget={canSeeBudget} canSeePeople={canSeePeople} />}
        {tab === "help" && <HelpTab isAdmin={isAdmin} />}
        </div>
      </div>
      {showSettings && (
        <SettingsModal
          prefs={prefs}
          setPrefs={setPrefs}
          isAdmin={isAdmin}
          displayName={displayName}
          onSaveName={saveName}
          hasRecovery={!!credentials.adminRecoveryHash}
          canExport={canSeeBudget}
          onChangePassword={changePassword}
          onCreateRecovery={createRecovery}
          onBackup={exportBackup}
          onRestore={restoreBackup}
          onExportCsv={exportCsv}
          onErase={eraseAll}
          onLogout={switchIdentity}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ---- shared chrome ---------------------------------------------------

function GlobalStyle() {
  const dark = T.bg === PALETTES.dark.bg;
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap');
      :root { color-scheme: ${dark ? "dark" : "light"}; }
      * { font-family: 'Inter', sans-serif; box-sizing: border-box; }
      html, body { background: ${T.bg}; transition: background-color .25s ease; }
      body { color: ${T.ink}; -webkit-font-smoothing: antialiased; }
      .font-display { font-family: 'Manrope', sans-serif; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important; }
      input, select, textarea { outline: none; }
      input:focus, select:focus { box-shadow: 0 0 0 3px ${T.pos}33; border-color: ${T.pos} !important; }
      input::placeholder { color: ${T.faint}; }
      button { cursor: pointer; transition: transform .12s ease, opacity .15s ease, background-color .2s ease, border-color .2s ease; }
      button:active:not(:disabled) { transform: scale(.97); }
      button:disabled { cursor: not-allowed; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 4px; }
      .card-hover { transition: box-shadow .2s ease, transform .2s ease; }
      .card-hover:hover { box-shadow: 0 8px 24px ${dark ? "rgba(0,0,0,0.35)" : "rgba(38,51,42,0.09)"}; transform: translateY(-1px); }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @keyframes shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-8px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
      @keyframes sheetIn { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
      .fade-up { animation: fadeUp .35s ease both; }
      .shake { animation: shake .35s ease; }
      .sheet-in { animation: sheetIn .28s ease both; }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }

      /* Re-colour the few Tailwind utility classes used around the app so they follow the theme */
      .bg-white { background-color: ${T.card} !important; }
      .bg-slate-50, .hover\\:bg-slate-50:hover { background-color: ${T.bg} !important; }
      .bg-slate-100, .hover\\:bg-slate-100\\/70:hover, .hover\\:bg-slate-200:hover { background-color: ${T.soft} !important; }
      .bg-slate-900 { background-color: ${T.ink} !important; color: ${T.bg} !important; }
      .hover\\:bg-slate-800:hover { background-color: ${T.text2} !important; }
      .border-slate-200, .border-slate-100 { border-color: ${T.line} !important; }
      .border-slate-900 { border-color: ${T.ink} !important; }
      .text-slate-400 { color: ${T.faint} !important; }
      .text-slate-500, .text-slate-600, .hover\\:text-slate-600:hover { color: ${T.muted} !important; }
      .text-slate-700 { color: ${T.text2} !important; }
      .text-slate-800, .text-slate-900, .hover\\:text-slate-800:hover { color: ${T.ink} !important; }
      .bg-emerald-50, .bg-emerald-100\\/70, .hover\\:bg-emerald-100:hover { background-color: ${T.pos}22 !important; }
      .bg-rose-50, .hover\\:bg-rose-100:hover { background-color: ${T.neg}22 !important; }
      .text-emerald-600, .text-emerald-700, .text-emerald-800, .hover\\:text-emerald-800:hover { color: ${T.pos} !important; }
      .text-rose-700, .text-rose-800, .hover\\:text-rose-600:hover { color: ${T.neg} !important; }
      .bg-emerald-600 { background-color: ${T.pos} !important; }
      .bg-rose-600 { background-color: ${T.neg} !important; }
      .border-emerald-600 { border-color: ${T.pos} !important; }
    `}</style>
  );
}


function BrandMark({ size = 40 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.32, background: `linear-gradient(135deg, ${T.heroA}, ${T.heroB})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: T.shadow, flexShrink: 0 }}>
      <Home size={size * 0.5} color="#fff" />
    </div>
  );
}

// ---- Settings ---------------------------------------------------------------

function AuthShell({ children }) {
  return (
    <div style={{ background: `radial-gradient(900px 420px at 50% -8%, ${T.soft}, ${T.bg})`, minHeight: "100vh" }} className="flex items-center justify-center px-4 py-8">
      <GlobalStyle />
      <div className="fade-up" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 22, padding: 26, maxWidth: 380, width: "100%", boxShadow: T.shadow }}>
        {children}
      </div>
    </div>
  );
}

function PrimaryButton({ children, style, ...rest }) {
  return (
    <button {...rest} className="w-full" style={{ background: T.pos, color: "#fff", borderRadius: 12, padding: "12px 16px", fontWeight: 700, fontSize: 13.5, opacity: rest.disabled ? 0.5 : 1, ...style }}>
      {children}
    </button>
  );
}
function LinkButton({ children, ...rest }) {
  return <button {...rest} style={{ color: T.muted, fontSize: 12.5, textDecoration: "underline", ...rest.style }}>{children}</button>;
}



function IconButton({ children, label, onClick, active }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} style={{ width: 36, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: active ? T.soft : T.card, color: active ? T.pos : T.text2, border: `1px solid ${T.line}`, boxShadow: T.shadow }}>
      {children}
    </button>
  );
}


function Header({ lowStockCount, poolBalance, tab, setTab, identity, canSeeBudget, canSeePeople, displayName, prefs, setPrefs, resolvedTheme, onSettings, onLogout }) {
  const isAdmin = identity?.role === "admin";
  const tabs = [
    { id: "overview", label: "Home", icon: LayoutDashboard, show: true },
    { id: "pantry", label: "Pantry", icon: Package, badge: lowStockCount, show: true },
    { id: "shopping", label: "Shopping", icon: ShoppingCart, show: isAdmin },
    { id: "budget", label: "Budget", icon: Wallet, show: canSeeBudget },
    { id: "history", label: "History", icon: Archive, show: canSeeBudget },
    { id: "people", label: "Household", icon: Users, show: canSeePeople },
    { id: "activity", label: "Activity", icon: ActivityIcon, show: true },
    { id: "help", label: "Help", icon: HelpCircle, show: true },
  ].filter((t) => t.show);
  const hr = new Date().getHours();
  const greeting = hr < 5 ? "Still up?" : hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : hr < 21 ? "Good evening" : "Good night";
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
          <BrandMark size={42} />
          <div style={{ minWidth: 0 }}>
            <h1 className="font-display" style={{ color: T.ink, fontSize: 21, fontWeight: 800, letterSpacing: -0.4, lineHeight: 1.15 }}>Household Goods</h1>
            <div style={{ color: T.muted, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {greeting}, <strong style={{ color: T.ink, fontWeight: 700 }}>{displayName}</strong>
              {isAdmin && <span style={{ background: T.pos + "22", color: T.pos, fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "1px 6px", marginLeft: 6 }}>ADMIN</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <IconButton label={prefs.hide ? "Show amounts" : "Hide amounts"} active={prefs.hide} onClick={() => setPrefs({ hide: !prefs.hide })}>
            {prefs.hide ? <EyeOff size={16} /> : <Eye size={16} />}
          </IconButton>
          <IconButton label={resolvedTheme === "dark" ? "Switch to light" : "Switch to dark"} onClick={() => setPrefs({ theme: resolvedTheme === "dark" ? "light" : "dark" })}>
            {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
          <IconButton label="Settings" onClick={onSettings}><Settings size={16} /></IconButton>
          <IconButton label="Log out" onClick={onLogout}><LogOut size={16} /></IconButton>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {tabs.map(({ id, label, icon: Icon, badge }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-3.5 py-2 flex-shrink-0"
              style={{ background: active ? T.pos : T.card, color: active ? "#fff" : T.text2, border: `1px solid ${active ? T.pos : T.line}`, borderRadius: 999, fontSize: 13, fontWeight: 600, boxShadow: active ? "none" : T.shadow }}
            >
              <Icon size={14} />
              {label}
              {badge > 0 && (
                <span style={{ background: active ? "#fff" : T.neg, color: active ? T.pos : "#fff", fontSize: 10, borderRadius: 8, padding: "1px 5px", fontWeight: 700 }}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TOAST_STYLE = {
  added: { color: "#4C8B5C", icon: Plus },
  low_stock: { color: "#C79A3E", icon: AlertTriangle },
  out_of_stock: { color: "#C05C4A", icon: AlertTriangle },
};

function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-2"
      style={{ position: "fixed", top: 16, right: 16, left: 16, zIndex: 1000, maxWidth: 360, marginLeft: "auto" }}
    >
      {toasts.map(t => <Toast key={t.toastId} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
}

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.toastId), 6000);
    return () => clearTimeout(timer);
  }, [toast.toastId, onDismiss]);

  const style = TOAST_STYLE[toast.type] || { color: T.text2, icon: ActivityIcon };
  const Icon = style.icon;

  return (
    <div
      className="flex items-start gap-2.5"
      style={{ background: T.card, border: `1px solid ${T.line}`, borderLeft: `4px solid ${style.color}`, borderRadius: 10, padding: "10px 12px", boxShadow: T.shadow }}
    >
      <div style={{ width: 22, height: 22, borderRadius: 7, background: style.color + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
        <Icon size={12} color={style.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
        <span style={{ color: T.ink, fontWeight: 600 }}>{toast.actor}</span>{" "}
        <span style={{ color: T.text2 }}>{toast.message}</span>
      </div>
      <button onClick={() => onDismiss(toast.toastId)} style={{ color: T.faint, flexShrink: 0 }}>
        <X size={13} />
      </button>
    </div>
  );
}


function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", background: T.soft, borderRadius: 10, padding: 3, gap: 2 }}>
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{ flex: 1, padding: "6px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: value === o.id ? T.card : "transparent", color: value === o.id ? T.ink : T.muted, boxShadow: value === o.id ? T.shadow : "none" }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onChange }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} style={{ width: 42, height: 24, borderRadius: 99, background: on ? T.pos : T.faint, position: "relative", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: 99, background: "#fff", transition: "left .18s ease" }} />
    </button>
  );
}

function SettingsSection({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: T.muted, marginBottom: 8 }}>{title}</div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
function SettingsRow({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 1 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}
function SoftButton({ children, danger, ...rest }) {
  return (
    <button {...rest} className="flex items-center justify-center gap-2" style={{ background: T.soft, color: danger ? T.neg : T.ink, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 600, ...rest.style }}>
      {children}
    </button>
  );
}


// ---- auth screens ------------------------------------------------------------

const FAIL_KEY = "household_login_fails"; // per-device wrong-password counter
const readFails = () => { try { return JSON.parse(localStorage.getItem(FAIL_KEY)) || { count: 0, until: 0 }; } catch { return { count: 0, until: 0 }; } };

function PasswordField({ value, onChange, placeholder = "Password", onKeyDown, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <FieldInput autoFocus={autoFocus} type={show ? "text" : "password"} placeholder={placeholder} value={value} onChange={onChange} onKeyDown={onKeyDown} style={{ width: "100%", paddingRight: 38 }} />
      <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)} style={{ position: "absolute", right: 8, top: 0, bottom: 0, color: T.muted }}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

function AuthHeading({ title, subtitle }) {
  return (
    <div className="flex items-center gap-3 mb-4"><BrandMark /><div>
      <h1 className="font-display" style={{ color: T.ink, fontSize: 20, fontWeight: 800 }}>{title}</h1>
      {subtitle && <div style={{ color: T.muted, fontSize: 12.5 }}>{subtitle}</div>}
    </div></div>
  );
}

function AdminSetup({ credentials, setCredentials, onDone }) {
  const [step, setStep] = useState("form");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [code] = useState(genRecoveryCode);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const next = () => {
    if (!username.trim() || !password) return setError("Enter a username and password.");
    if (password.length < 4) return setError("Use at least 4 characters for the password.");
    if (password !== confirm) return setError("Passwords don't match.");
    setError("");
    setStep("code");
  };
  const finish = async (withCode) => {
    setBusy(true);
    const { adminPassword, ...rest } = credentials; // never keep a plaintext password
    setCredentials({
      ...rest,
      adminName: name.trim(),
      adminUsername: username.trim(),
      adminPasswordHash: await hashPassword(username, password),
      ...(withCode ? { adminRecoveryHash: await hashRecovery(code) } : {}),
    });
    onDone();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* best effort */ }
  };

  if (step === "code") {
    return (
      <AuthShell>
        <AuthHeading title="Save your recovery code" />
        <div style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, marginBottom: 14 }}>
          If you forget the admin password, this code is the only way back in without erasing the household's data. It won't be shown again.
        </div>
        <div className="mono" style={{ background: T.soft, border: `1px dashed ${T.faint}`, borderRadius: 12, padding: "14px 10px", textAlign: "center", fontSize: 17, fontWeight: 700, letterSpacing: 1.5, color: T.ink, userSelect: "all" }}>{code}</div>
        <button onClick={copy} className="flex items-center justify-center gap-2 w-full" style={{ marginTop: 10, background: T.soft, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>
          <Copy size={14} /> {copied ? "Copied!" : "Copy code"}
        </button>
        <label className="flex items-center gap-2" style={{ margin: "14px 0", fontSize: 12.5, color: T.text2, cursor: "pointer" }}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved my recovery code
        </label>
        <PrimaryButton disabled={!saved || busy} onClick={() => finish(true)}>Finish setup</PrimaryButton>
        <div className="text-center mt-3"><LinkButton onClick={() => finish(false)}>Skip for now (you can create one in Settings)</LinkButton></div>
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <AuthHeading title="Welcome 👋" subtitle="Set up the admin login" />
      <div style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, marginBottom: 14 }}>
        You're the first one here. You'll use this to give your housemates their own logins.
      </div>
      <div className="flex flex-col gap-2 mb-3">
        <FieldInput placeholder="Your name (shown in the greeting)" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        <FieldInput placeholder="Admin username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordField placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && next()} />
      </div>
      <div style={{ minHeight: 20, color: T.neg, fontSize: 12.5, marginBottom: 6 }}>{error}</div>
      <PrimaryButton onClick={next}>Continue</PrimaryButton>
    </AuthShell>
  );
}

function LoginScreen({ credentials, setCredentials, members, onLogin, onErase }) {
  const [view, setView] = useState("login"); // login | forgot | newpass | erase
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [fails, setFails] = useState(readFails);
  const [now, setNow] = useState(Date.now());
  const [forgotAs, setForgotAs] = useState("admin");
  const [codeInput, setCodeInput] = useState("");
  const [np, setNp] = useState({ next: "", confirm: "" });
  const [eraseText, setEraseText] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = fails.until > now;
  const secsLeft = Math.max(0, Math.ceil((fails.until - now) / 1000));

  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [locked]);

  const go = (v) => { setView(v); setError(""); };
  const fail = () => {
    const count = fails.count + 1;
    const until = count % 5 === 0 ? Date.now() + Math.min(30 * 2 ** (count / 5 - 1), 900) * 1000 : 0;
    const next = { count, until };
    localStorage.setItem(FAIL_KEY, JSON.stringify(next));
    setFails(next); setNow(Date.now()); setPassword("");
    setShake(true); setTimeout(() => setShake(false), 400);
    const left = 5 - (count % 5);
    setError(until ? "Too many wrong attempts." : left <= 2 ? `Incorrect username or password · ${left} ${left === 1 ? "try" : "tries"} left before a short lock` : "Incorrect username or password.");
  };
  const ok = (identity) => { localStorage.removeItem(FAIL_KEY); onLogin(identity); };

  const submit = async () => {
    if (locked || !username.trim() || !password) return;
    setBusy(true);
    try {
      const u = username.trim();
      if (u === credentials.adminUsername) {
        const r = await checkSecret(adminCred(credentials), u, password);
        if (r.ok) {
          if (r.legacy) { // silently upgrade the old plaintext password to a hash
            const { adminPassword, ...rest } = credentials;
            setCredentials({ ...rest, adminPasswordHash: await hashPassword(u, password) });
          }
          return ok({ role: "admin" });
        }
      }
      for (const [memberId, cred] of Object.entries(credentials.users || {})) {
        if (cred.username !== u) continue;
        const r = await checkSecret(cred, u, password);
        const member = members.find((m) => m.id === memberId);
        if (r.ok && member) {
          if (r.legacy) {
            const { password: _old, ...clean } = cred;
            setCredentials({ ...credentials, users: { ...credentials.users, [memberId]: { ...clean, passwordHash: await hashPassword(u, password) } } });
          }
          return ok({ role: "member", memberId: member.id, name: member.name });
        }
      }
      fail();
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setBusy(true);
    const good = credentials.adminRecoveryHash && (await hashRecovery(codeInput)) === credentials.adminRecoveryHash;
    setBusy(false);
    if (good) { setError(""); go("newpass"); } else setError("That recovery code doesn't match.");
  };
  const saveNewPassword = async () => {
    if (np.next.length < 4) return setError("Use at least 4 characters.");
    if (np.next !== np.confirm) return setError("Passwords don't match.");
    setBusy(true);
    const { adminPassword, ...rest } = credentials;
    setCredentials({ ...rest, adminPasswordHash: await hashPassword(credentials.adminUsername, np.next) });
    localStorage.removeItem(FAIL_KEY);
    onLogin({ role: "admin" });
  };

  if (view === "newpass") {
    return (
      <AuthShell>
        <AuthHeading title="Choose a new password" subtitle={`For admin “${credentials.adminUsername}”`} />
        <div className="flex flex-col gap-2 mb-2">
          <PasswordField autoFocus placeholder="New password" value={np.next} onChange={(e) => { setNp({ ...np, next: e.target.value }); setError(""); }} />
          <PasswordField placeholder="Confirm new password" value={np.confirm} onChange={(e) => { setNp({ ...np, confirm: e.target.value }); setError(""); }} onKeyDown={(e) => e.key === "Enter" && saveNewPassword()} />
        </div>
        <div style={{ minHeight: 20, color: T.neg, fontSize: 12.5, marginBottom: 6 }}>{error}</div>
        <PrimaryButton disabled={busy} onClick={saveNewPassword}>Save &amp; log in</PrimaryButton>
        <div className="text-center mt-3"><LinkButton onClick={() => go("login")}>Cancel</LinkButton></div>
      </AuthShell>
    );
  }

  if (view === "forgot") {
    return (
      <AuthShell>
        <AuthHeading title="Forgot your password?" />
        <Segmented value={forgotAs} onChange={(v) => { setForgotAs(v); setError(""); }} options={[{ id: "admin", label: "I'm the admin" }, { id: "member", label: "I'm a housemate" }]} />
        <div style={{ height: 14 }} />
        {forgotAs === "member" ? (
          <div style={{ background: T.soft, borderRadius: 12, padding: 12, color: T.text2, fontSize: 12.5, lineHeight: 1.55 }}>
            Ask your house admin to set a new password for you: <strong>Household tab → your card → Login → Save</strong>. You can then change it yourself in Settings.
          </div>
        ) : credentials.adminRecoveryHash ? (
          <>
            <div style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, marginBottom: 10 }}>Enter the recovery code you saved when you set up the admin login.</div>
            <FieldInput autoFocus className="mono" placeholder="XXXX-XXXX-XXXX-XXXX" value={codeInput} onChange={(e) => { setCodeInput(formatRecovery(e.target.value)); setError(""); }} onKeyDown={(e) => e.key === "Enter" && verifyCode()} style={{ width: "100%", textAlign: "center", letterSpacing: 1.5, fontSize: 15, padding: "12px 10px" }} />
            <div style={{ minHeight: 22, color: T.neg, fontSize: 12.5, margin: "8px 0" }}>{error}</div>
            <PrimaryButton disabled={busy || codeInput.length < 19} onClick={verifyCode}>Verify code</PrimaryButton>
          </>
        ) : (
          <div style={{ background: T.soft, borderRadius: 12, padding: 12, color: T.text2, fontSize: 12.5, lineHeight: 1.55 }}>
            No recovery code was created for the admin login, so it can't be reset. Your only option is to erase everything and start fresh.
          </div>
        )}
        <div className="flex justify-between mt-4">
          <LinkButton onClick={() => go("login")}>Back</LinkButton>
          {forgotAs === "admin" && <LinkButton onClick={() => go("erase")} style={{ color: T.neg }}>Erase data &amp; start over</LinkButton>}
        </div>
      </AuthShell>
    );
  }

  if (view === "erase") {
    return (
      <AuthShell>
        <AuthHeading title="Erase everything?" />
        <div style={{ color: T.text2, fontSize: 12.5, lineHeight: 1.55, marginBottom: 12 }}>
          This permanently deletes the pantry, shopping list, budget, history, housemates and all logins for everyone, then lets you set up a new admin. It can't be undone.
        </div>
        <FieldInput placeholder="Type ERASE to confirm" value={eraseText} onChange={(e) => setEraseText(e.target.value)} style={{ width: "100%", marginBottom: 12 }} />
        <PrimaryButton disabled={eraseText !== "ERASE" || busy} style={{ background: T.neg }} onClick={async () => { setBusy(true); await onErase(); }}>{busy ? "Erasing…" : "Erase all data"}</PrimaryButton>
        <div className="text-center mt-3"><LinkButton onClick={() => go("forgot")}>Cancel</LinkButton></div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHeading title="Welcome back" subtitle="Log in to your household" />
      <div className={`flex flex-col gap-2 mb-2 ${shake ? "shake" : ""}`}>
        <FieldInput autoFocus placeholder="Username" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => { setUsername(e.target.value); setError(""); }} />
        <PasswordField value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
      <div style={{ minHeight: 22, color: T.neg, fontSize: 12.5, margin: "6px 0" }}>{locked ? `Locked for ${secsLeft}s — try again soon.` : error}</div>
      <PrimaryButton disabled={locked || busy || !username.trim() || !password} onClick={submit}>Log in</PrimaryButton>
      <div className="text-center mt-3"><LinkButton onClick={() => go("forgot")}>Forgot password?</LinkButton></div>
      <div style={{ color: T.faint, fontSize: 11.5, textAlign: "center", marginTop: 10 }}>Need a login? Ask your house admin.</div>
    </AuthShell>
  );
}

function SettingsModal({ prefs, setPrefs, isAdmin, displayName, onSaveName, hasRecovery, canExport, onChangePassword, onCreateRecovery, onBackup, onRestore, onExportCsv, onErase, onLogout, onClose }) {
  const [nameDraft, setNameDraft] = useState(isAdmin ? displayName : "");
  const [nameSaved, setNameSaved] = useState(false);
  const [pw, setPw] = useState({ cur: "", next: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState(null);
  const [newCode, setNewCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState(null);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [eraseText, setEraseText] = useState("");
  const fileRef = useRef(null);

  const savePw = async () => {
    if (pw.next.length < 4) return setPwMsg({ ok: false, text: "New password needs at least 4 characters." });
    if (pw.next !== pw.confirm) return setPwMsg({ ok: false, text: "New passwords don't match." });
    const err = await onChangePassword(pw.cur, pw.next);
    if (err) return setPwMsg({ ok: false, text: err });
    setPw({ cur: "", next: "", confirm: "" });
    setPwMsg({ ok: true, text: "Password updated." });
  };
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(newCode); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* best effort */ }
  };
  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setRestoreMsg(await onRestore(file));
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: T.scrim, zIndex: 1200, display: "flex", alignItems: "flex-end", justifyContent: "center" }} className="sm:items-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()} className="sheet-in" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: "22px 22px 0 0", padding: 20, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto", boxShadow: T.shadow }}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-display" style={{ fontWeight: 800, fontSize: 18, color: T.ink }}>Settings</div>
          <button onClick={onClose} aria-label="Close" style={{ color: T.muted }}><X size={18} /></button>
        </div>

        {isAdmin && (
          <SettingsSection title="Profile">
            <div className="flex gap-2">
              <FieldInput placeholder="Your name" value={nameDraft} maxLength={30} onChange={(e) => { setNameDraft(e.target.value); setNameSaved(false); }} onKeyDown={(e) => e.key === "Enter" && (onSaveName(nameDraft), setNameSaved(true))} style={{ flex: 1, minWidth: 0 }} />
              <SoftButton onClick={() => { onSaveName(nameDraft); setNameSaved(true); }} disabled={!nameDraft.trim() || nameDraft.trim() === displayName}>{nameSaved ? "Saved" : "Save"}</SoftButton>
            </div>
          </SettingsSection>
        )}

        <SettingsSection title="Appearance & privacy">
          <Segmented value={prefs.theme} onChange={(theme) => setPrefs({ theme })} options={[{ id: "auto", label: "Auto" }, { id: "light", label: "Sage light" }, { id: "dark", label: "Forest night" }]} />
          <SettingsRow label="Hide amounts" hint="Masks money values on this device"><Switch on={prefs.hide} onChange={(hide) => setPrefs({ hide })} /></SettingsRow>
          <SettingsRow label="Auto log-out" hint="Log out after you've been idle">
            <FieldSelect value={prefs.autoLockMin} onChange={(e) => setPrefs({ autoLockMin: Number(e.target.value) })} style={{ width: 110 }}>
              <option value={0}>Never</option><option value={5}>5 min</option><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>1 hour</option>
            </FieldSelect>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Security">
          <div className="flex flex-col gap-2">
            <PasswordField placeholder="Current password" value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <PasswordField placeholder="New password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              <PasswordField placeholder="Confirm" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </div>
            {pwMsg && <div style={{ fontSize: 12.5, color: pwMsg.ok ? T.pos : T.neg }}>{pwMsg.text}</div>}
            <SoftButton onClick={savePw} disabled={!pw.cur || !pw.next}><KeyRound size={14} /> Change password</SoftButton>
          </div>
          {isAdmin && (
            <>
              <SettingsRow label="Admin recovery code" hint={hasRecovery ? "Set — lets you reset a forgotten password" : "Not set — a forgotten admin password can't be reset"}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: hasRecovery ? T.pos : T.warn }}>{hasRecovery ? "Active" : "Missing"}</span>
              </SettingsRow>
              {newCode ? (
                <div style={{ background: T.soft, borderRadius: 12, padding: 12 }}>
                  <div className="mono" style={{ textAlign: "center", fontSize: 16, fontWeight: 700, letterSpacing: 1.5, color: T.ink, userSelect: "all" }}>{newCode}</div>
                  <div style={{ fontSize: 11.5, color: T.muted, margin: "8px 0", lineHeight: 1.45 }}>Save this now — it won't be shown again, and any older code no longer works.</div>
                  <SoftButton onClick={copyCode} style={{ width: "100%" }}><Copy size={14} /> {copied ? "Copied!" : "Copy code"}</SoftButton>
                </div>
              ) : (
                <SoftButton onClick={async () => setNewCode(await onCreateRecovery())}><ShieldCheck size={14} /> {hasRecovery ? "Generate a new recovery code" : "Create recovery code"}</SoftButton>
              )}
            </>
          )}
          <SoftButton onClick={onLogout}><LogOut size={14} /> Log out</SoftButton>
        </SettingsSection>

        {(isAdmin || canExport) && (
          <SettingsSection title="Your data">
            {isAdmin && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <SoftButton onClick={onBackup}><Download size={14} /> Backup</SoftButton>
                  <SoftButton onClick={() => fileRef.current?.click()}><Upload size={14} /> Restore</SoftButton>
                </div>
                <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} style={{ display: "none" }} />
                {restoreMsg && <div style={{ fontSize: 12.5, color: restoreMsg.ok ? T.pos : T.neg }}>{restoreMsg.text}</div>}
              </>
            )}
            {canExport && <SoftButton onClick={onExportCsv}><FileSpreadsheet size={14} /> Export budget ledger (CSV)</SoftButton>}
            {isAdmin && <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.45 }}>Backups are plain JSON files — keep them private. Restoring replaces the pantry, budget and housemates; logins are kept.</div>}
          </SettingsSection>
        )}

        {isAdmin && (
          <SettingsSection title="Danger zone">
            {!eraseOpen ? (
              <SoftButton danger onClick={() => setEraseOpen(true)}><Trash2 size={14} /> Erase all data…</SoftButton>
            ) : (
              <div className="flex flex-col gap-2">
                <div style={{ fontSize: 12.5, color: T.text2, lineHeight: 1.5 }}>This deletes everything for the whole household, including all logins. Download a backup first.</div>
                <FieldInput placeholder="Type ERASE to confirm" value={eraseText} onChange={(e) => setEraseText(e.target.value)} />
                <SoftButton danger disabled={eraseText !== "ERASE"} onClick={onErase}>Erase everything</SoftButton>
              </div>
            )}
          </SettingsSection>
        )}
      </div>
    </div>
  );
}

// ---- Overview (Home) tab -------------------------------------------------------

function OverviewTab({ pantry, shoppingExtra, tx, activity, members, poolBalance, totalContributed, totalSpent, canSeeBudget, canSeePeople, setTab }) {
  const lowItems = pantry.filter((i) => i.qty <= i.lowThreshold).sort((a, b) => (a.qty - a.lowThreshold) - (b.qty - b.lowThreshold));
  const outCount = pantry.filter((i) => i.qty <= 0).length;
  const toBuy = lowItems.length + shoppingExtra.length;
  const debts = canSeeBudget ? computePeerDebts(tx) : [];
  const recent = activity.filter((a) => (a.scope === "budget" ? canSeeBudget : a.scope === "people" ? canSeePeople : true)).slice(0, 5);
  const pct = totalContributed > 0 ? Math.max(0, Math.min(100, Math.round((poolBalance / totalContributed) * 100))) : 0;
  const targetTotal = members.reduce((s, m) => s + (m.contribution || 0), 0);

  const heroChips = canSeeBudget
    ? [{ label: "Paid in", value: money(totalContributed) }, { label: "Spent", value: money(totalSpent) }, { label: "Left", value: `${pct}%` }]
    : [{ label: "Items", value: pantry.length }, { label: "Low", value: lowItems.length }, { label: "Out", value: outCount }];

  const tiles = [
    { label: "Running low", value: lowItems.length, hint: lowItems.length ? "need restocking" : "all stocked", icon: AlertTriangle, tone: lowItems.length ? T.warn : T.pos, go: "pantry" },
    { label: "Out of stock", value: outCount, hint: outCount ? "none left" : "nothing missing", icon: Package, tone: outCount ? T.neg : T.pos, go: "pantry" },
    { label: "To buy", value: toBuy, hint: shoppingExtra.length ? `${shoppingExtra.length} extra on list` : "from low stock", icon: ShoppingCart, go: "shopping" },
    ...(canSeeBudget && targetTotal > 0 ? [{ label: "Monthly goal", value: `${Math.min(999, Math.round((totalContributed / targetTotal) * 100))}%`, hint: `of ${money(targetTotal)} collected`, icon: Target, go: "budget" }] : [{ label: "Pantry items", value: pantry.length, hint: "tracked", icon: ShoppingBasket, go: "pantry" }]),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="fade-up" style={{ background: `linear-gradient(135deg, ${T.heroA}, ${T.heroB})`, borderRadius: 20, padding: 20, color: "#fff", boxShadow: T.shadow }}>
        <div style={{ fontSize: 11.5, opacity: 0.8, letterSpacing: 0.8, textTransform: "uppercase" }}>{canSeeBudget ? "Pool balance" : "Pantry today"}</div>
        <div className="font-display" style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8, margin: "2px 0 14px" }}>
          {canSeeBudget ? money(poolBalance) : lowItems.length === 0 ? "All stocked 🎉" : `${lowItems.length} running low`}
        </div>
        {canSeeBudget && (
          <div style={{ background: "rgba(255,255,255,0.18)", borderRadius: 99, height: 6, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ width: `${pct}%`, background: "#fff", height: "100%", borderRadius: 99, transition: "width .4s ease" }} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {heroChips.map(({ label, value }) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.14)", borderRadius: 12, padding: "9px 10px", minWidth: 0 }}>
              <div style={{ fontSize: 10.5, opacity: 0.85, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
              <div className="font-display" style={{ fontSize: 14.5, fontWeight: 700, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map(({ label, value, hint, icon: Icon, tone, go }) => (
          <button key={label} onClick={() => setTab(go)} className="card-hover fade-up" style={{ textAlign: "left", background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, padding: 12, boxShadow: T.shadow, minWidth: 0 }}>
            <div className="flex items-center gap-1.5" style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}><Icon size={12} /> {label}</div>
            <div className="font-display" style={{ color: tone || T.ink, fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
            <div style={{ color: T.muted, fontSize: 11.5, marginTop: 1 }}>{hint}</div>
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, padding: 16, boxShadow: T.shadow }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>Needs attention</div>
            <button onClick={() => setTab("pantry")} style={{ fontSize: 11.5, color: T.muted, textDecoration: "underline" }}>open pantry</button>
          </div>
          {lowItems.length === 0 ? (
            <div style={{ color: T.faint, fontSize: 12.5 }}>Nothing is running low. Nice.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {lowItems.slice(0, 6).map((i) => {
                const out = i.qty <= 0;
                return (
                  <div key={i.id} className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
                    <span style={{ color: T.ink }}>{i.name}</span>
                    <span style={{ color: out ? T.neg : T.warn, fontWeight: 700 }}>{out ? "out of stock" : `${i.qty} ${i.unit} left`}</span>
                  </div>
                );
              })}
              {lowItems.length > 6 && <div style={{ color: T.muted, fontSize: 11.5 }}>+{lowItems.length - 6} more</div>}
            </div>
          )}
        </div>

        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, padding: 16, boxShadow: T.shadow }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>{canSeeBudget ? "Who owes whom" : "Latest activity"}</div>
            <button onClick={() => setTab(canSeeBudget ? "budget" : "activity")} style={{ fontSize: 11.5, color: T.muted, textDecoration: "underline" }}>{canSeeBudget ? "open budget" : "see all"}</button>
          </div>
          {canSeeBudget ? (
            debts.length === 0 ? (
              <div style={{ color: T.faint, fontSize: 12.5 }}>Everyone is square.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {debts.slice(0, 5).map((d, i) => (
                  <div key={i} className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
                    <span style={{ color: T.ink }}>{d.from} <span style={{ color: T.muted }}>owes</span> {d.to}</span>
                    <span style={{ color: T.neg, fontWeight: 700 }}>{money(d.amount)}</span>
                  </div>
                ))}
              </div>
            )
          ) : recent.length === 0 ? (
            <div style={{ color: T.faint, fontSize: 12.5 }}>No activity yet.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {recent.map((a) => (
                <div key={a.id} style={{ fontSize: 12.5 }}><span style={{ color: T.ink, fontWeight: 600 }}>{a.actor}</span> <span style={{ color: T.text2 }}>{a.message}</span></div>
              ))}
            </div>
          )}
        </div>
      </div>

      {canSeeBudget && recent.length > 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, padding: 16, boxShadow: T.shadow }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-display" style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>Latest activity</div>
            <button onClick={() => setTab("activity")} style={{ fontSize: 11.5, color: T.muted, textDecoration: "underline" }}>see all</button>
          </div>
          <div className="flex flex-col gap-2">
            {recent.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3" style={{ fontSize: 12.5 }}>
                <span style={{ minWidth: 0 }}><span style={{ color: T.ink, fontWeight: 600 }}>{a.actor}</span> <span style={{ color: T.text2 }}>{a.message}</span></span>
                <span style={{ color: T.faint, fontSize: 11, whiteSpace: "nowrap" }}>{timeAgo(a.date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function StatCard({ label, value, color }) {
  return (<div>
      <div style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div className="font-display" style={{ color: color || T.ink, fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: T.faint, gridColumn: "1 / -1" }}>
      <Icon size={24} />
      <div style={{ fontSize: 13 }}>{text}</div>
    </div>
  );
}

function FieldInput(props) {
  return (
    <input
      {...props}
      style={{ background: T.bg, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 8, fontSize: 13, padding: "8px 10px", ...props.style }}
    />
  );
}
function FieldSelect(props) {
  return (
    <select
      {...props}
      style={{ background: T.bg, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 8, fontSize: 13, padding: "8px 10px", ...props.style }}
    />
  );
}

// ---- Pantry tab: card grid ---------------------------------------------

function PantryTab({ pantry, setPantry, isAdmin, logActivity }) {
  const [form, setForm] = useState({ name: "", category: CATEGORIES[0].name, qty: 1, unit: "pcs", lowThreshold: 1 });
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const addItem = () => {
    if (!form.name.trim()) return;
    const name = form.name.trim();
    const qty = Number(form.qty);
    const lowThreshold = Number(form.lowThreshold);
    setPantry([...pantry, { id: uid(), ...form, name, qty, lowThreshold }]);
    logActivity?.(`added "${name}" to the pantry (${qty} ${form.unit})`, "pantry", "added");
    if (qty <= lowThreshold) {
      const msg = qty === 0 ? `"${name}" was added out of stock` : `"${name}" was added already running low (${qty} ${form.unit})`;
      logActivity?.(msg, "pantry", qty === 0 ? "out_of_stock" : "low_stock");
    }
    setForm({ name: "", category: CATEGORIES[0].name, qty: 1, unit: "pcs", lowThreshold: 1 });
    setAdding(false);
  };
  const adjustQty = (item, dir) => {
    const step = UNIT_STEP[item.unit] || 1;
    const newQty = Math.max(0, round2(item.qty + dir * step));
    if (newQty === item.qty) return;
    setPantry(pantry.map(i => i.id === item.id ? { ...i, qty: newQty } : i));
    logActivity?.(
      `${dir > 0 ? "added" : "used"} ${step} ${item.unit} of "${item.name}" (now ${newQty} ${item.unit})`,
      "pantry"
    );
    const wasLow = item.qty <= item.lowThreshold;
    const isLow = newQty <= item.lowThreshold;
    if (!wasLow && isLow) {
      const msg = newQty === 0 ? `"${item.name}" is out of stock` : `"${item.name}" is running low (${newQty} ${item.unit} left)`;
      logActivity?.(msg, "pantry", newQty === 0 ? "out_of_stock" : "low_stock");
    } else if (newQty === 0 && item.qty > 0) {
      logActivity?.(`"${item.name}" is out of stock`, "pantry", "out_of_stock");
    }
  };
  const removeItem = (item) => {
    setPantry(pantry.filter(i => i.id !== item.id));
    logActivity?.(`removed "${item.name}" from the pantry`, "pantry");
  };

  const startEdit = (item) => { setEditingId(item.id); setEditForm({ ...item }); };
  const cancelEdit = () => { setEditingId(null); setEditForm(null); };
  const saveEdit = () => {
    if (!editForm.name.trim()) return;
    const prevItem = pantry.find(i => i.id === editingId);
    const newQty = Number(editForm.qty);
    const newThreshold = Number(editForm.lowThreshold);
    setPantry(pantry.map(i => i.id === editingId ? { ...editForm, qty: newQty, lowThreshold: newThreshold } : i));
    logActivity?.(`edited "${editForm.name.trim()}"`, "pantry");
    if (prevItem) {
      const wasLow = prevItem.qty <= prevItem.lowThreshold;
      const isLow = newQty <= newThreshold;
      if (!wasLow && isLow) {
        const msg = newQty === 0 ? `"${editForm.name.trim()}" is out of stock` : `"${editForm.name.trim()}" is running low (${newQty} ${editForm.unit} left)`;
        logActivity?.(msg, "pantry", newQty === 0 ? "out_of_stock" : "low_stock");
      } else if (newQty === 0 && prevItem.qty > 0) {
        logActivity?.(`"${editForm.name.trim()}" is out of stock`, "pantry", "out_of_stock");
      }
    }
    cancelEdit();
  };

  const q = search.trim().toLowerCase();
  const filtered = pantry.filter(i =>
    (categoryFilter === "All" || i.category === categoryFilter) &&
    (!q || i.name.toLowerCase().includes(q))
  );
  const lowItems = [...filtered.filter(i => i.qty <= i.lowThreshold)].sort((a, b) => (a.qty - a.lowThreshold) - (b.qty - b.lowThreshold));
  const grouped = CATEGORIES.map(c => ({ cat: c.name, items: filtered.filter(i => i.category === c.name) })).filter(g => g.items.length > 0);
  const usedCategories = [...new Set(pantry.map(i => i.category))];

  const renderCard = (item) => {
    const cat = catInfo(item.category);
    const Icon = cat.icon;
    const low = item.qty <= item.lowThreshold;
    const editing = editingId === item.id;

    if (editing) {
      return (
        <div key={item.id} style={{ background: T.card, border: `1px solid ${T.pos}`, borderRadius: 14, overflow: "hidden", boxShadow: T.shadow }}>
          <div style={{ height: 5, background: cat.color }} />
          <div style={{ padding: "12px 14px" }} className="flex flex-col gap-1.5">
            <FieldInput value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} style={{ fontSize: 13 }} />
            <FieldSelect value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} style={{ fontSize: 12 }}>
              {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </FieldSelect>
            <div className="flex gap-1.5">
              <FieldInput type="number" min="0" step="any" value={editForm.qty} onChange={e => setEditForm({ ...editForm, qty: e.target.value })} style={{ fontSize: 12, flex: 1 }} />
              <FieldSelect value={editForm.unit} onChange={e => setEditForm({ ...editForm, unit: e.target.value })} style={{ fontSize: 12, flex: 1 }}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </FieldSelect>
            </div>
            <div className="flex items-center gap-1.5">
              <label style={{ color: T.muted, fontSize: 11 }}>Alert below</label>
              <FieldInput type="number" min="0" step="any" className="w-16" value={editForm.lowThreshold} onChange={e => setEditForm({ ...editForm, lowThreshold: e.target.value })} style={{ fontSize: 12 }} />
            </div>
            <div className="flex gap-1.5 mt-1">
              <button onClick={saveEdit} className="flex-1 flex items-center justify-center gap-1" style={{ background: T.pos, color: "#fff", borderRadius: 8, padding: "6px 0", fontSize: 12, fontWeight: 600 }}>
                <Check size={12} /> Save
              </button>
              <button onClick={cancelEdit} style={{ background: T.bg, border: `1px solid ${T.line}`, color: T.text2, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={item.id} className="card-hover" style={{ background: T.card, border: `1px solid ${low ? T.neg + "55" : T.line}`, borderRadius: 14, overflow: "hidden", boxShadow: T.shadow }}>
        <div style={{ height: 5, background: cat.color }} />
        <div style={{ padding: "12px 14px" }}>
          <div className="flex items-start justify-between mb-2">
            <div style={{ width: 30, height: 30, borderRadius: 8, background: cat.color + "1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={15} color={cat.color} />
            </div>
            {isAdmin && (
              <div className="flex items-center gap-0.5">
                <button onClick={() => startEdit(item)} style={{ color: T.faint, padding: 2 }}>
                  <Pencil size={12} />
                </button>
                <button onClick={() => removeItem(item)} style={{ color: T.faint, padding: 2 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
          <div style={{ color: T.ink, fontSize: 14, fontWeight: 600, marginBottom: 1 }}>{item.name}</div>
          <div style={{ color: T.muted, fontSize: 11, marginBottom: 10 }}>{item.category}</div>
          {low && (
            <div className="flex items-center gap-1 mb-2" style={{ color: T.neg, fontSize: 11, fontWeight: 600 }}>
              <AlertTriangle size={11} /> {item.qty === 0 ? "Out of stock" : "Running low"}
            </div>
          )}
          <div className="flex items-center justify-between">
            <button onClick={() => adjustQty(item, -1)} style={{ background: T.bg, border: `1px solid ${T.line}`, borderRadius: 7, padding: 5 }}>
              <Minus size={12} color={T.text2} />
            </button>
            <span className="font-display" style={{ color: low ? T.neg : T.ink, fontSize: 14, fontWeight: 700 }}>
              {item.qty} <span style={{ fontSize: 11, fontWeight: 500, color: T.muted }}>{item.unit}</span>
            </span>
            <button onClick={() => adjustQty(item, 1)} style={{ background: T.bg, border: `1px solid ${T.line}`, borderRadius: 7, padding: 5 }}>
              <Plus size={12} color={T.text2} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div style={{ color: T.text2, fontSize: 13 }}>{pantry.length} item{pantry.length !== 1 ? "s" : ""} on the shelf</div>
        {isAdmin && (
          <button
            onClick={() => setAdding(a => !a)}
            className="flex items-center gap-1.5 px-3.5 py-2"
            style={{ background: T.pos, color: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 600 }}
          >
            {adding ? <X size={14} /> : <Plus size={14} />}
            {adding ? "Cancel" : "Add item"}
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.faint }} />
          <FieldInput
            placeholder="Search pantry…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", paddingLeft: 30 }}
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {["All", ...usedCategories].map(c => {
            const active = categoryFilter === c;
            return (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className="px-2.5 py-1.5"
                style={{
                  background: active ? T.ink : T.card,
                  color: active ? "#fff" : T.text2,
                  border: `1px solid ${active ? T.ink : T.line}`,
                  borderRadius: 8, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
                }}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {adding && isAdmin && (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, marginBottom: 20, boxShadow: T.shadow }}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <FieldInput className="col-span-2 sm:col-span-2" placeholder="Item name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <FieldSelect value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </FieldSelect>
            <FieldInput type="number" min="0" step="any" placeholder="Qty" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
            <FieldSelect value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </FieldSelect>
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <label style={{ color: T.muted, fontSize: 12 }}>Alert when below</label>
            <FieldInput type="number" min="0" step="any" className="w-16" value={form.lowThreshold} onChange={e => setForm({ ...form, lowThreshold: e.target.value })} />
            <button onClick={addItem} className="ml-auto px-4 py-2" style={{ background: T.pos, color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
              Add to shelf
            </button>
          </div>
        </div>
      )}

      {lowItems.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-1.5 mb-2" style={{ color: T.neg, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
            <AlertTriangle size={12} /> Running low ({lowItems.length})
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {lowItems.map(renderCard)}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={pantry.length === 0 ? Package : Search} text={pantry.length === 0 ? "The shelf is empty — add your first item." : "No items match your search."} />
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(({ cat, items }) => (
            <div key={cat}>
              <div className="font-mono mb-2" style={{ color: T.faint, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" }}>
                {cat}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {items.map(renderCard)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Budget tab ------------------------------------------------------

// ---- Shopping tab -----------------------------------------------------------

function ShoppingTab({ pantry, setPantry, shoppingExtra, setShoppingExtra, actorLabel, logActivity }) {
  const [restockAmounts, setRestockAmounts] = useState({});
  const [extraText, setExtraText] = useState("");

  const lowItems = [...pantry.filter(i => i.qty <= i.lowThreshold)].sort((a, b) => (a.qty - a.lowThreshold) - (b.qty - b.lowThreshold));

  const suggestedRestock = (item) => {
    const target = item.lowThreshold * 2 || UNIT_STEP[item.unit] || 1;
    return Math.max(round2(target - item.qty), UNIT_STEP[item.unit] || 1);
  };
  const amountFor = (item) => restockAmounts[item.id] ?? suggestedRestock(item);
  const setAmount = (id, val) => setRestockAmounts({ ...restockAmounts, [id]: val });

  const markBought = (item) => {
    const add = Number(amountFor(item)) || 0;
    if (add <= 0) return;
    setPantry(pantry.map(i => i.id === item.id ? { ...i, qty: round2(i.qty + add) } : i));
    logActivity?.(`bought ${add} ${item.unit} of "${item.name}"`, "pantry");
    const next = { ...restockAmounts };
    delete next[item.id];
    setRestockAmounts(next);
  };

  const addExtra = () => {
    if (!extraText.trim()) return;
    setShoppingExtra([{ id: uid(), name: extraText.trim(), addedBy: actorLabel, date: new Date().toISOString() }, ...shoppingExtra]);
    logActivity?.(`added "${extraText.trim()}" to the shopping list`, "pantry");
    setExtraText("");
  };
  const removeExtra = (item) => {
    setShoppingExtra(shoppingExtra.filter(e => e.id !== item.id));
  };
  const boughtExtra = (item) => {
    setShoppingExtra(shoppingExtra.filter(e => e.id !== item.id));
    logActivity?.(`bought "${item.name}"`, "pantry");
  };

  return (
    <div>
      <div style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        From your pantry ({lowItems.length})
      </div>
      {lowItems.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, marginBottom: 24, color: T.muted, fontSize: 13 }}>
          Nothing running low right now — the pantry's in good shape.
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-7">
          {lowItems.map(item => {
            const cat = catInfo(item.category);
            const Icon = cat.icon;
            return (
              <div key={item.id} className="card-hover flex items-center gap-3 flex-wrap" style={{ background: T.card, border: `1px solid ${T.neg}55`, borderRadius: 12, padding: "10px 12px", boxShadow: T.shadow }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: cat.color + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={15} color={cat.color} />
                </div>
                <div style={{ flex: 1, minWidth: 100 }}>
                  <div style={{ color: T.ink, fontSize: 13.5, fontWeight: 600 }}>{item.name}</div>
                  <div style={{ color: T.neg, fontSize: 11 }}>{item.qty === 0 ? "Out of stock" : `${item.qty} ${item.unit} left`}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <FieldInput type="number" min="0" step="any" value={amountFor(item)} onChange={e => setAmount(item.id, e.target.value)} className="w-16" style={{ padding: "5px 8px", fontSize: 12 }} />
                  <span style={{ color: T.muted, fontSize: 11 }}>{item.unit}</span>
                  <button onClick={() => markBought(item)} className="flex items-center gap-1" style={{ background: T.pos, color: "#fff", borderRadius: 7, padding: "6px 10px", fontSize: 11.5, fontWeight: 600 }}>
                    <Check size={12} /> Bought
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        Other items to pick up
      </div>
      <div className="flex gap-2 mb-3">
        <FieldInput placeholder="e.g. birthday candles" value={extraText} onChange={e => setExtraText(e.target.value)} onKeyDown={e => e.key === "Enter" && addExtra()} style={{ flex: 1 }} />
        <button onClick={addExtra} className="px-3.5 py-2" style={{ background: T.pos, color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          Add
        </button>
      </div>
      {shoppingExtra.length === 0 ? (
        <EmptyState icon={ShoppingCart} text="No extra items on the list." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {shoppingExtra.map(item => (
            <div key={item.id} className="flex items-center gap-3" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: T.ink, fontSize: 13 }}>{item.name}</div>
                <div style={{ color: T.faint, fontSize: 10.5 }}>added by {item.addedBy}</div>
              </div>
              <button onClick={() => boughtExtra(item)} className="flex items-center gap-1" style={{ background: T.pos, color: "#fff", borderRadius: 7, padding: "5px 9px", fontSize: 11, fontWeight: 600 }}>
                <Check size={11} /> Bought
              </button>
              <button onClick={() => removeExtra(item)} style={{ color: T.faint, padding: 3 }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetTab({ members, setMembers, tx, setTx, poolBalance, totalContributed, totalSpent, isAdmin, closeMonth, logActivity }) {
  const [form, setForm] = useState({ type: "expense", category: "Groceries", paidBy: "pool", person: "", contribPaidBy: "", amount: "", note: "" });
  const [splitWith, setSplitWith] = useState([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

  useEffect(() => {
    if (!form.person && members.length) setForm(f => ({ ...f, person: members[0].name }));
  }, [members]);

  const toggleSplit = (id) => {
    setSplitWith(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };

  const addTx = () => {
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return;
    if (form.type === "contribution" && !form.person) return;

    // A contribution credited to one person's target, but the cash actually
    // came from someone else — the pool sees it as paid, and the covered
    // person owes the payer directly (shows up in Who owes whom).
    if (form.type === "contribution") {
      const payer = form.contribPaidBy || form.person;
      const entries = [{
        id: uid(), type: "contribution", category: null, person: form.person,
        amount: amt, note: form.note, date: new Date().toISOString(),
      }];
      if (payer !== form.person) {
        entries.push({
          id: uid(), type: "peer", category: "Other", payer,
          splitWith: [form.person], amount: amt, note: form.note || "Covered contribution",
          date: new Date().toISOString(),
        });
      }
      setTx([...entries, ...tx]);
      logActivity?.(
        payer !== form.person
          ? `logged ${money(amt)} contribution for ${form.person}, covered by ${payer}`
          : `logged ${money(amt)} contribution from ${form.person}`,
        "budget"
      );
      setForm({ ...form, amount: "", note: "", contribPaidBy: "" });
      return;
    }

    // Paid personally by someone (not the shared pool) — creates a direct
    // debt from each split housemate to whoever paid, tracked separately
    // from the pool balance and monthly targets.
    if (form.type === "expense" && form.paidBy !== "pool") {
      if (splitWith.length === 0) return;
      const splitNames = members.filter(m => splitWith.includes(m.id)).map(m => m.name);
      setTx([{
        id: uid(), type: "peer", category: form.category, payer: form.paidBy,
        splitWith: splitNames, amount: amt, note: form.note, date: new Date().toISOString(),
      }, ...tx]);
      logActivity?.(`${form.paidBy} paid ${money(amt)} (${form.category}) for ${splitNames.join(", ")}`, "budget");
      setForm({ ...form, amount: "", note: "" });
      setSplitWith([]);
      return;
    }

    let splitNames = null;
    if (form.type === "expense" && splitWith.length > 0) {
      const share = amt / splitWith.length;
      setMembers(members.map(m => splitWith.includes(m.id) ? { ...m, contribution: Math.round((m.contribution + share) * 100) / 100 } : m));
      splitNames = members.filter(m => splitWith.includes(m.id)).map(m => m.name);
    }

    setTx([{
      id: uid(), type: form.type, category: form.type === "expense" ? form.category : null,
      person: form.type === "expense" ? "Household" : form.person, amount: amt, note: form.note,
      splitWith: splitNames, date: new Date().toISOString(),
    }, ...tx]);
    logActivity?.(
      form.type === "expense"
        ? `logged a ${money(amt)} ${form.category} expense${splitNames ? ` split with ${splitNames.join(", ")}` : ""}`
        : `logged ${money(amt)} contribution from ${form.person}`,
      "budget"
    );
    setForm({ ...form, amount: "", note: "" });
    setSplitWith([]);
  };
  const removeTx = (t) => {
    setTx(tx.filter(x => x.id !== t.id));
    logActivity?.(`deleted a ${money(t.amount)} ${t.type === "expense" ? (t.category || "expense") : t.type === "peer" ? `payment by ${t.payer}` : "contribution"} entry`, "budget");
  };
  const settleUp = (member) => {
    const remaining = round2(member.contribution - tx.filter(t => t.type === "contribution" && t.person === member.name).reduce((s, t) => s + t.amount, 0));
    if (remaining <= 0) return;
    setTx([{ id: uid(), type: "contribution", category: null, person: member.name, amount: remaining, note: "Settled up", date: new Date().toISOString() }, ...tx]);
    logActivity?.(`settled up ${member.name}'s ${money(remaining)} balance`, "budget");
  };
  const settlePeerDebt = (debt) => {
    setTx([{
      id: uid(), type: "peer", category: "Other", payer: debt.to,
      splitWith: [debt.from], amount: debt.amount, note: "Settled up", date: new Date().toISOString(),
    }, ...tx]);
    logActivity?.(`settled: ${debt.from} paid ${debt.to} back ${money(debt.amount)}`, "budget");
  };

  const spendByCategory = EXPENSE_CATEGORIES.map(c => ({
    ...c,
    total: tx.filter(t => t.type === "expense" && (t.category || "Other") === c.name).reduce((s, t) => s + t.amount, 0),
  })).filter(c => c.total > 0);

  const perPerson = members.map(m => {
    const contributed = tx.filter(t => t.type === "contribution" && t.person === m.name).reduce((s, t) => s + t.amount, 0);
    return { ...m, contributed, remaining: round2(m.contribution - contributed) };
  }).sort((a, b) => b.remaining - a.remaining);

  const peerDebts = computePeerDebts(tx);

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-2 mb-5">
        <div className="grid grid-cols-3 gap-3 flex-1">
          <StatCard label="Contributed" value={money(totalContributed)} color={T.pos} />
          <StatCard label="Spent" value={money(totalSpent)} color={T.neg} />
          <StatCard label="Balance" value={money(poolBalance)} color={T.warn} />
        </div>
      </div>

      {isAdmin && tx.length > 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 14, marginBottom: 20 }}>
          {!confirmClose ? (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div style={{ color: T.text2, fontSize: 12.5 }}>Done with {monthLabel}? Archive it and start a fresh ledger.</div>
              <button onClick={() => setConfirmClose(true)} className="flex items-center gap-1.5 px-3 py-1.5" style={{ background: T.bg, border: `1px solid ${T.line}`, color: T.text2, borderRadius: 8, fontSize: 12.5, fontWeight: 600 }}>
                <Archive size={13} /> Close out {monthLabel}
              </button>
            </div>
          ) : (
            <div>
              <div style={{ color: T.ink, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Archive {monthLabel} and start over?</div>
              <div style={{ color: T.muted, fontSize: 12, marginBottom: 10 }}>
                All {tx.length} entries move to History. Monthly targets stay the same for next month — only what's been paid resets to ₹0.
              </div>
              <div className="flex gap-2">
                <button onClick={() => { closeMonth(); setConfirmClose(false); }} className="px-3 py-1.5" style={{ background: T.neg, color: "#fff", borderRadius: 8, fontSize: 12.5, fontWeight: 600 }}>
                  Yes, archive it
                </button>
                <button onClick={() => setConfirmClose(false)} className="px-3 py-1.5" style={{ background: T.bg, border: `1px solid ${T.line}`, color: T.text2, borderRadius: 8, fontSize: 12.5, fontWeight: 600 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {members.length === 0 ? (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, marginBottom: 20, color: T.text2, fontSize: 13 }}>
          Add housemates in the Household tab first — then you can log who paid what.
        </div>
      ) : (
        <>
          {isAdmin ? (
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, marginBottom: 20, boxShadow: T.shadow }}>
            <div className="flex gap-2 mb-3">
              {["expense", "contribution"].map(t => (
                <button
                  key={t}
                  onClick={() => setForm({ ...form, type: t })}
                  className="px-3 py-1.5"
                  style={{
                    background: form.type === t ? (t === "expense" ? T.neg : T.pos) : T.bg,
                    color: form.type === t ? "#fff" : T.text2,
                    border: "1px solid " + (form.type === t ? "transparent" : T.line),
                    borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                  }}
                >
                  {t === "expense" ? "Expense" : "Contribution"}
                </button>
              ))}
            </div>
            {form.type === "expense" && (
              <div className="flex gap-1.5 mb-3 flex-wrap">
                {EXPENSE_CATEGORIES.map(c => {
                  const Icon = c.icon;
                  const active = form.category === c.name;
                  return (
                    <button
                      key={c.name}
                      onClick={() => setForm({ ...form, category: c.name })}
                      className="flex items-center gap-1 px-2.5 py-1.5"
                      style={{
                        background: active ? c.color + "1A" : T.bg,
                        color: active ? c.color : T.muted,
                        border: `1px solid ${active ? c.color : T.line}`,
                        borderRadius: 8, fontSize: 12, fontWeight: 600,
                      }}
                    >
                      <Icon size={12} /> {c.name}
                    </button>
                  );
                })}
              </div>
            )}
            {form.type === "expense" && (
              <div className="mb-3">
                <div style={{ color: T.muted, fontSize: 11, marginBottom: 6 }}>Who paid?</div>
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    onClick={() => setForm({ ...form, paidBy: "pool" })}
                    className="px-2.5 py-1.5"
                    style={{
                      background: form.paidBy === "pool" ? T.ink : T.bg,
                      color: form.paidBy === "pool" ? "#fff" : T.text2,
                      border: `1px solid ${form.paidBy === "pool" ? T.ink : T.line}`,
                      borderRadius: 8, fontSize: 12, fontWeight: 600,
                    }}
                  >
                    Household pool
                  </button>
                  {members.map(m => {
                    const active = form.paidBy === m.name;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setForm({ ...form, paidBy: m.name })}
                        className="px-2.5 py-1.5"
                        style={{
                          background: active ? "#4A7FB5" : T.bg,
                          color: active ? "#fff" : T.text2,
                          border: `1px solid ${active ? "#4A7FB5" : T.line}`,
                          borderRadius: 8, fontSize: 12, fontWeight: 600,
                        }}
                      >
                        {m.name} (personally)
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {form.type === "expense" && (
              <div className="mb-3">
                <div style={{ color: T.muted, fontSize: 11, marginBottom: 6 }}>
                  {form.paidBy === "pool"
                    ? "Split with specific housemates? (optional — adds their share to their monthly target)"
                    : `Who does this cover? (they'll owe ${form.paidBy || "the payer"} directly)`}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {members.map(m => {
                    const active = splitWith.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggleSplit(m.id)}
                        className="px-2.5 py-1.5"
                        style={{
                          background: active ? T.ink : T.bg,
                          color: active ? "#fff" : T.text2,
                          border: `1px solid ${active ? T.ink : T.line}`,
                          borderRadius: 8, fontSize: 12, fontWeight: 600,
                        }}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
                {splitWith.length > 0 && Number(form.amount) > 0 && (
                  <div style={{ color: form.paidBy === "pool" ? T.pos : "#4A7FB5", fontSize: 11.5, marginTop: 6, fontWeight: 600 }}>
                    {form.paidBy === "pool"
                      ? `→ ${money(Number(form.amount) / splitWith.length)} added to each of ${splitWith.length} housemate${splitWith.length > 1 ? "s'" : "'s"} target`
                      : `→ each owes ${form.paidBy} ${money(Number(form.amount) / splitWith.length)}`}
                  </div>
                )}
              </div>
            )}
            {form.type === "contribution" && (
              <div className="mb-3">
                <div style={{ color: T.muted, fontSize: 11, marginBottom: 6 }}>For</div>
                <FieldSelect value={form.person} onChange={e => setForm({ ...form, person: e.target.value })} style={{ marginBottom: 8, width: "100%" }}>
                  {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </FieldSelect>
                <div style={{ color: T.muted, fontSize: 11, marginBottom: 6 }}>Actually paid by (optional — if someone covered it for them)</div>
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    onClick={() => setForm({ ...form, contribPaidBy: "" })}
                    className="px-2.5 py-1.5"
                    style={{
                      background: !form.contribPaidBy ? T.ink : T.bg,
                      color: !form.contribPaidBy ? "#fff" : T.text2,
                      border: `1px solid ${!form.contribPaidBy ? T.ink : T.line}`,
                      borderRadius: 8, fontSize: 12, fontWeight: 600,
                    }}
                  >
                    {form.person || "Same person"}
                  </button>
                  {members.filter(m => m.name !== form.person).map(m => {
                    const active = form.contribPaidBy === m.name;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setForm({ ...form, contribPaidBy: m.name })}
                        className="px-2.5 py-1.5"
                        style={{
                          background: active ? "#4A7FB5" : T.bg,
                          color: active ? "#fff" : T.text2,
                          border: `1px solid ${active ? "#4A7FB5" : T.line}`,
                          borderRadius: 8, fontSize: 12, fontWeight: 600,
                        }}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
                {form.contribPaidBy && form.contribPaidBy !== form.person && Number(form.amount) > 0 && (
                  <div style={{ color: "#4A7FB5", fontSize: 11.5, marginTop: 6, fontWeight: 600 }}>
                    → {form.person}'s target is marked paid, and they'll owe {form.contribPaidBy} {money(Number(form.amount))}
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <FieldInput type="number" min="0" step="0.01" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={form.type === "expense" ? "col-span-2 sm:col-span-1" : "col-span-2 sm:col-span-3"} />
              <FieldInput className="col-span-2 sm:col-span-1" placeholder={form.type === "expense" ? "Note (e.g. Costco run)" : "Note (optional)"} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
              <button onClick={addTx} className="px-3 py-2" style={{ background: T.pos, color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                Log it
              </button>
            </div>
          </div>
          ) : (
            <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, marginBottom: 20, color: T.muted, fontSize: 13 }}>
              Only the house admin can log contributions and expenses. You can view balances and the ledger below.
            </div>
          )}

          <div style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Settle up</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-7">
            {perPerson.map(m => (
              <div key={m.id} className="card-hover" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: "12px 14px", boxShadow: T.shadow }}>
                <div style={{ color: T.ink, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{m.name}</div>
                <div style={{ color: T.muted, fontSize: 12, marginBottom: 4 }}>{money(m.contributed)} of {money(m.contribution)}</div>
                <div style={{ background: T.soft, borderRadius: 6, height: 6, overflow: "hidden" }}>
                  <div style={{ width: `${m.contribution > 0 ? Math.min(100, (m.contributed / m.contribution) * 100) : 0}%`, background: m.remaining > 0 ? T.warn : T.pos, height: "100%" }} />
                </div>
                <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
                  <span style={{ color: m.remaining > 0 ? T.warn : T.pos, fontSize: 11.5, fontWeight: 600 }}>
                    {m.remaining > 0 ? `Owes ${money(m.remaining)}` : "Settled up"}
                  </span>
                  {isAdmin && m.remaining > 0 && (
                    <button onClick={() => settleUp(m)} className="flex items-center gap-1" style={{ color: T.pos, fontSize: 11, fontWeight: 600 }}>
                      <HandCoins size={12} /> Settle
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {peerDebts.length > 0 && (
        <>
          <div style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Who owes whom</div>
          <div className="flex flex-col gap-2 mb-7">
            {peerDebts.map((d, i) => (
              <div key={i} className="card-hover flex items-center gap-3" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: "10px 14px", boxShadow: T.shadow }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: "#4A7FB51A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <HandCoins size={14} color="#4A7FB5" />
                </div>
                <div style={{ flex: 1, fontSize: 13, color: T.ink }}>
                  <span style={{ fontWeight: 700 }}>{d.from}</span> owes <span style={{ fontWeight: 700 }}>{d.to}</span>
                </div>
                <div className="font-mono" style={{ color: "#4A7FB5", fontSize: 13.5, fontWeight: 700 }}>{money(d.amount)}</div>
                {isAdmin && (
                  <button onClick={() => settlePeerDebt(d)} className="px-2.5 py-1" style={{ background: T.bg, border: `1px solid ${T.line}`, color: T.text2, borderRadius: 7, fontSize: 11, fontWeight: 600 }}>
                    Settle
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {spendByCategory.length > 0 && (
        <>
          <div style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Spending by category</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-7">
            {spendByCategory.map(c => {
              const Icon = c.icon;
              return (
                <div key={c.name} className="card-hover" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: "12px 14px", boxShadow: T.shadow }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: c.color + "1A", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                    <Icon size={13} color={c.color} />
                  </div>
                  <div style={{ color: T.muted, fontSize: 11 }}>{c.name}</div>
                  <div className="font-display" style={{ color: T.ink, fontSize: 15, fontWeight: 700 }}>{money(c.total)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Ledger</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {tx.length === 0 && <EmptyState icon={Wallet} text="No entries yet." />}
        {tx.map(t => {
          const cat = (t.type === "expense" || t.type === "peer") ? expCatInfo(t.category || "Other") : null;
          const CatIcon = cat ? cat.icon : ArrowDownRight;
          const iconColor = t.type === "expense" ? cat.color : t.type === "peer" ? "#4A7FB5" : T.pos;
          return (
            <div key={t.id} className="card-hover flex items-center gap-3" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: "10px 12px", boxShadow: T.shadow }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: iconColor + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <CatIcon size={14} color={iconColor} />
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ color: T.ink, fontSize: 13, fontWeight: 500 }}>
                  {t.type === "expense" ? <>Household <span style={{ color: T.muted, fontWeight: 400 }}>· {cat.name}</span></>
                    : t.type === "peer" ? <>{t.payer} paid <span style={{ color: T.muted, fontWeight: 400 }}>· {cat?.name}</span></>
                    : `${t.person} contributed`}
                </div>
                <div style={{ color: T.faint, fontSize: 11 }}>
                  {t.note ? `${t.note} · ` : ""}{t.splitWith ? `${t.type === "peer" ? "owed by" : "split with"} ${t.splitWith.join(", ")} · ` : ""}{new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </div>
              </div>
              <div className="font-display" style={{ color: t.type === "expense" ? T.neg : t.type === "peer" ? "#4A7FB5" : T.pos, fontSize: 13, fontWeight: 700 }}>
                {t.type === "expense" ? "-" : t.type === "peer" ? "" : "+"}{money(t.amount)}
              </div>
              <button onClick={() => removeTx(t)} style={{ color: T.faint, padding: 3, visibility: isAdmin ? "visible" : "hidden" }}>
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- History tab -----------------------------------------------------------

function HistoryTab({ history }) {
  const [expanded, setExpanded] = useState(null);

  if (history.length === 0) {
    return <EmptyState icon={Archive} text="No archived months yet — closed-out months will show up here." />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {history.map(rec => {
        const balance = rec.totalContributed - rec.totalSpent;
        const open = expanded === rec.id;
        return (
          <div key={rec.id} style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, boxShadow: T.shadow, overflow: "hidden" }}>
            <button
              onClick={() => setExpanded(open ? null : rec.id)}
              className="w-full flex items-center justify-between"
              style={{ padding: "14px 16px" }}
            >
              <div className="text-left">
                <div className="font-display" style={{ color: T.ink, fontSize: 15, fontWeight: 700 }}>{rec.label}</div>
                <div style={{ color: T.muted, fontSize: 11.5 }}>{rec.tx.length} entries</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div style={{ color: T.muted, fontSize: 10.5 }}>contributed / spent</div>
                  <div className="font-mono" style={{ fontSize: 12.5 }}>
                    <span style={{ color: T.pos }}>{money(rec.totalContributed)}</span>
                    {" / "}
                    <span style={{ color: T.neg }}>{money(rec.totalSpent)}</span>
                  </div>
                </div>
                {open ? <ChevronUp size={16} color={T.muted} /> : <ChevronDown size={16} color={T.muted} />}
              </div>
            </button>

            {open && (
              <div style={{ borderTop: `1px solid ${T.soft}`, padding: "14px 16px" }}>
                <div style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Per person</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                  {rec.perPerson.map(p => (
                    <div key={p.name} style={{ background: T.bg, borderRadius: 10, padding: "8px 10px" }}>
                      <div style={{ color: T.ink, fontSize: 12.5, fontWeight: 600 }}>{p.name}</div>
                      <div style={{ color: T.muted, fontSize: 11 }}>{money(p.contributed)} of {money(p.target)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Entries</div>
                <div className="flex flex-col gap-1">
                  {rec.tx.map(t => (
                    <div key={t.id} className="flex items-center justify-between" style={{ fontSize: 12, padding: "5px 0", borderBottom: `1px solid ${T.bg}` }}>
                      <span style={{ color: T.text2 }}>
                        {t.type === "expense" ? `Household · ${t.category || "Other"}`
                          : t.type === "peer" ? `${t.payer} paid for ${(t.splitWith || []).join(", ")}`
                          : `${t.person} contributed`}
                        {t.note && <span style={{ color: T.faint }}> — {t.note}</span>}
                      </span>
                      <span className="font-mono" style={{ color: t.type === "expense" ? T.neg : t.type === "peer" ? "#4A7FB5" : T.pos, fontWeight: 600 }}>
                        {t.type === "expense" ? "-" : t.type === "peer" ? "" : "+"}{money(t.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- Activity tab -----------------------------------------------------------

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const SCOPE_ICON = { pantry: Package, budget: Wallet, people: Users };

function ActivityTab({ activity, canSeeBudget, canSeePeople }) {
  const visible = activity.filter(a =>
    a.scope === "pantry" ? true : a.scope === "budget" ? canSeeBudget : a.scope === "people" ? canSeePeople : true
  );

  if (visible.length === 0) {
    return <EmptyState icon={ActivityIcon} text="No activity yet — actions across the house will show up here." />;
  }

  return (
    <div className="flex flex-col gap-1">
      {visible.map(a => {
        const Icon = SCOPE_ICON[a.scope] || ActivityIcon;
        return (
          <div key={a.id} className="flex items-center gap-3" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 12px" }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon size={13} color={T.muted} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ color: T.ink, fontWeight: 600 }}>{a.actor}</span>{" "}
              <span style={{ color: T.text2 }}>{a.message}</span>
            </div>
            <div style={{ color: T.faint, fontSize: 11, whiteSpace: "nowrap" }}>{timeAgo(a.date)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Help tab -----------------------------------------------------------

function GuideSection({ title, icon: Icon, color, items }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, marginBottom: 12, boxShadow: T.shadow }}>
      <div className="flex items-center gap-2 mb-3">
        <div style={{ width: 26, height: 26, borderRadius: 8, background: color + "1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={13} color={color} />
        </div>
        <div style={{ color: T.ink, fontSize: 14, fontWeight: 700 }}>{title}</div>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            <span style={{ color: T.ink, fontWeight: 600 }}>{item.t}</span>{" "}
            <span style={{ color: T.text2 }}>{item.d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HelpTab({ isAdmin }) {
  const adminGuide = [
    {
      title: "Getting people set up", icon: Users, color: "#4A7FB5",
      items: [
        { t: "Add housemates", d: "in the Household tab, give each one a monthly contribution target." },
        { t: "Assign logins", d: "on each housemate's card — set a username and password so they can log in as themselves." },
        { t: "Control visibility", d: "toggle whether each housemate can see the Budget or Household tabs. Pantry, Shopping, and Activity are always theirs to use." },
      ],
    },
    {
      title: "Pantry & Shopping", icon: Package, color: T.pos,
      items: [
        { t: "Add, edit, or remove items", d: "with the pencil and trash icons — only admin can do this; housemates can only adjust quantities." },
        { t: "Set a low-stock threshold", d: "per item so it shows up under Running Low and on the Shopping list automatically." },
        { t: "Shopping tab", d: "is admin-only — restock straight from there and it updates pantry quantities." },
      ],
    },
    {
      title: "Money", icon: Wallet, color: T.warn,
      items: [
        { t: "Contribution", d: "logs money going into the shared pool for one person's monthly target." },
        { t: "Expense", d: "logs money leaving the pool — pick a category (Groceries, Rent, Maid, etc)." },
        { t: "\"Who paid?\"", d: "on an expense — leave it as Household pool for normal shared spending, or pick a person if they paid out of their own pocket for others (this creates a debt instead of touching the pool)." },
        { t: "\"Actually paid by\"", d: "on a contribution — use this if one housemate covered another's contribution. The pool credits the covered person, and they owe the payer directly." },
        { t: "Settle up / Who owes whom", d: "one-tap buttons to clear a pool debt or a person-to-person debt once it's paid back in real life." },
        { t: "Close out a month", d: "archives the current ledger to History and resets — monthly targets carry over, only what's paid resets to ₹0." },
      ],
    },
  ];

  const memberGuide = [
    {
      title: "Pantry", icon: Package, color: T.pos,
      items: [
        { t: "Search or filter by category", d: "to find an item fast." },
        { t: "Use the +/− buttons", d: "to update quantity as things get used up or restocked — that's the one thing you can always do here." },
        { t: "Running Low", d: "at the top shows what needs restocking soonest." },
      ],
    },
    {
      title: "Money (if your admin's given you access)", icon: Wallet, color: T.warn,
      items: [
        { t: "View-only", d: "you can see pool balance, who owes what, and the full ledger, but only the admin can log new money or delete entries." },
        { t: "Who owes whom", d: "shows any personal debts between housemates, separate from the shared pool." },
      ],
    },
    {
      title: "Everything else", icon: ActivityIcon, color: "#4A7FB5",
      items: [
        { t: "Activity", d: "shows a running feed of what's changed across the house." },
        { t: "Household tab", d: "(if visible to you) shows the housemate list — only admin can edit it." },
      ],
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ background: isAdmin ? T.ink : T.soft, color: isAdmin ? T.bg : T.text2, fontSize: 11, fontWeight: 700, borderRadius: 7, padding: "3px 8px" }}>
          {isAdmin ? "Admin guide" : "Housemate guide"}
        </span>
      </div>
      <div style={{ color: T.muted, fontSize: 12.5, marginBottom: 16 }}>
        {isAdmin ? "What you can do as the house admin." : "What you can do as a housemate — ask your admin if you need access to more."}
      </div>
      {(isAdmin ? adminGuide : memberGuide).map((section, i) => (
        <GuideSection key={i} title={section.title} icon={section.icon} color={section.color} items={section.items} />
      ))}
    </div>
  );
}

// ---- People tab -----------------------------------------------------------

const AVATAR_COLORS = ["#4C8B5C", "#4A7FB5", "#C05C4A", "#C79A3E", "#8D6CB0", "#4CA0AE"];

function PeopleTab({ members, setMembers, tx, isAdmin, permissions, setPermissions, credentials, setCredentials, logActivity }) {
  const [form, setForm] = useState({ name: "", contribution: "" });
  const [loginDrafts, setLoginDrafts] = useState({});

  const addMember = () => {
    if (!form.name.trim()) return;
    setMembers([...members, { id: uid(), name: form.name.trim(), contribution: Number(form.contribution) || 0 }]);
    logActivity?.(`added ${form.name.trim()} as a housemate`, "people");
    setForm({ name: "", contribution: "" });
  };
  const removeMember = (member) => {
    setMembers(members.filter(m => m.id !== member.id));
    logActivity?.(`removed ${member.name} from the household`, "people");
  };
  const updateTarget = (id, value) => setMembers(members.map(m => m.id === id ? { ...m, contribution: Number(value) || 0 } : m));
  const togglePerm = (memberId, key) => {
    const current = getPerms(permissions, memberId);
    setPermissions({ ...permissions, [memberId]: { ...current, [key]: !current[key] } });
  };
  const draftFor = (id) => loginDrafts[id] || { username: credentials.users?.[id]?.username || "", password: "" };
  const setDraft = (id, field, value) => setLoginDrafts({ ...loginDrafts, [id]: { ...draftFor(id), [field]: value } });
  const saveLogin = async (id, memberName) => {
    const d = draftFor(id);
    if (!d.username?.trim() || !d.password) return;
    const username = d.username.trim();
    setCredentials({ ...credentials, users: { ...credentials.users, [id]: { username, passwordHash: await hashPassword(username, d.password) } } });
    setLoginDrafts((prev) => ({ ...prev, [id]: { username, password: "" } }));
    logActivity?.(`set login credentials for ${memberName}`, "people");
  };

  return (
    <div>
      {isAdmin ? (
      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, marginBottom: 20, boxShadow: T.shadow }}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <FieldInput className="col-span-2 sm:col-span-1" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <FieldInput type="number" min="0" placeholder="Monthly target (₹)" value={form.contribution} onChange={e => setForm({ ...form, contribution: e.target.value })} />
          <button onClick={addMember} className="px-3 py-2" style={{ background: T.pos, color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            Add housemate
          </button>
        </div>
      </div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, marginBottom: 20, color: T.muted, fontSize: 13 }}>
          Only the house admin can add housemates or change contribution targets.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {members.length === 0 && <EmptyState icon={Users} text="No housemates added yet." />}
        {members.map((m, i) => {
          const contributed = tx.filter(t => t.type === "contribution" && t.person === m.name).reduce((s, t) => s + t.amount, 0);
          const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
          const perms = getPerms(permissions, m.id);
          return (
            <div key={m.id} className="card-hover" style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 14, boxShadow: T.shadow }}>
              <div className="flex items-center justify-between mb-3">
                <div style={{ width: 34, height: 34, borderRadius: 10, background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>
                  {m.name.charAt(0).toUpperCase()}
                </div>
                {isAdmin && (
                  <button onClick={() => removeMember(m)} style={{ color: T.faint, padding: 3 }}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div style={{ color: T.ink, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{m.name}</div>
              <div className="flex items-center gap-1.5 mb-2">
                <label style={{ color: T.muted, fontSize: 11 }}>Target</label>
                {isAdmin ? (
                  <FieldInput type="number" min="0" className="w-20" style={{ padding: "4px 8px" }} value={m.contribution} onChange={e => updateTarget(m.id, e.target.value)} />
                ) : (
                  <span style={{ color: T.ink, fontSize: 12, fontWeight: 600 }}>{money(m.contribution)}</span>
                )}
              </div>
              <div style={{ color: T.muted, fontSize: 11.5, marginBottom: isAdmin ? 10 : 0 }}>Paid {money(contributed)}</div>

              {isAdmin && (
                <div className="flex flex-col gap-1.5 pt-2.5 mb-2.5" style={{ borderTop: `1px solid ${T.soft}` }}>
                  <div style={{ color: T.muted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>Login</div>
                  <FieldInput placeholder="Username" style={{ padding: "5px 8px", fontSize: 12 }} value={draftFor(m.id).username} onChange={e => setDraft(m.id, "username", e.target.value)} />
                  <div className="flex gap-1.5">
                    <FieldInput type="password" placeholder={credentials.users?.[m.id] ? "New password" : "Password"} style={{ padding: "5px 8px", fontSize: 12, flex: 1 }} value={draftFor(m.id).password} onChange={e => setDraft(m.id, "password", e.target.value)} />
                    <button onClick={() => saveLogin(m.id, m.name)} style={{ background: T.pos, color: "#fff", borderRadius: 7, padding: "0 10px", fontSize: 11.5, fontWeight: 600 }}>Save</button>
                  </div>
                  {credentials.users?.[m.id] && <div style={{ color: T.pos, fontSize: 10.5 }}>Login set ✓</div>}
                </div>
              )}

              {isAdmin && (
                <div className="flex flex-col gap-1.5 pt-2.5" style={{ borderTop: `1px solid ${T.soft}` }}>
                  <div style={{ color: T.muted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>Can see</div>
                  <PermToggle label="Budget" checked={perms.budget} onChange={() => togglePerm(m.id, "budget")} />
                  <PermToggle label="Household" checked={perms.people} onChange={() => togglePerm(m.id, "people")} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PermToggle({ label, checked, onChange }) {
  return (
    <button onClick={onChange} className="flex items-center justify-between" style={{ fontSize: 12, color: T.text2 }}>
      <span>{label}</span>
      <span
        style={{
          width: 30, height: 17, borderRadius: 9, background: checked ? T.pos : T.line,
          position: "relative", transition: "background .15s ease", flexShrink: 0,
        }}
      >
        <span style={{ position: "absolute", top: 2, left: checked ? 15 : 2, width: 13, height: 13, borderRadius: "50%", background: "#fff", transition: "left .15s ease" }} />
      </span>
    </button>
  );
}
