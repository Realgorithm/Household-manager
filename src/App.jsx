import React, { useState, useEffect, useCallback } from "react";
import { Plus, Minus, Trash2, X, Package, Wallet, Users, AlertTriangle, ArrowUpRight, ArrowDownRight, Sprout, Milk, Beef, Snowflake, Home, ShoppingBasket, Sparkles, KeyRound, MoreHorizontal, Search, Pencil, Check, Archive, ChevronDown, ChevronUp, ShoppingCart, Activity as ActivityIcon, HandCoins, HelpCircle, Lock, Eye } from "lucide-react";
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

const uid = () => Math.random().toString(36).slice(2, 10);
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);

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
  const [tab, setTab] = useState("pantry");
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

  const chooseIdentity = (id) => {
    setIdentity(id);
    saveIdentity(id);
  };
  const switchIdentity = () => {
    setIdentity(null);
    saveIdentity(null);
  };

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
  const actorLabel = isAdmin ? "Admin" : (identity?.name || "A housemate");

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

  if (!ready || !identityChecked) {
    return (
      <div style={{ background: "#F7F8F5", minHeight: "100vh" }} className="flex items-center justify-center">
        <GlobalStyle />
        <div style={{ color: "#8A9186", fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (!credentials.adminPassword) {
    return <AdminSetup credentials={credentials} setCredentials={persistCredentials} onDone={() => chooseIdentity({ role: "admin" })} />;
  }

  if (!identity) {
    return (
      <LoginScreen
        credentials={credentials}
        members={members}
        onLogin={chooseIdentity}
      />
    );
  }

  return (
    <div style={{ background: "#F7F8F5", minHeight: "100vh" }}>
      <GlobalStyle />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-24 pt-8 sm:pt-10">
        <Header
          lowStockCount={lowStockCount}
          poolBalance={poolBalance}
          tab={tab}
          setTab={setTab}
          identity={identity}
          switchIdentity={switchIdentity}
          canSeeBudget={canSeeBudget}
          canSeePeople={canSeePeople}
        />
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
  );
}

// ---- shared chrome ---------------------------------------------------

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap');
      * { font-family: 'Inter', sans-serif; box-sizing: border-box; }
      .font-display { font-family: 'Manrope', sans-serif; }
      input, select { outline: none; }
      input:focus, select:focus { box-shadow: 0 0 0 3px rgba(76,139,92,0.15); border-color: #4C8B5C !important; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: #DCE0D6; border-radius: 4px; }
      .card-hover { transition: box-shadow .15s ease, transform .15s ease; }
      .card-hover:hover { box-shadow: 0 6px 20px rgba(31,42,29,0.08); transform: translateY(-1px); }
    `}</style>
  );
}

function Header({ lowStockCount, poolBalance, tab, setTab, identity, switchIdentity, canSeeBudget, canSeePeople }) {
  const isAdmin = identity?.role === "admin";
  const tabs = [
    { id: "pantry", label: "Pantry", icon: Package, badge: lowStockCount, show: true },
    { id: "shopping", label: "Shopping", icon: ShoppingCart, show: isAdmin },
    { id: "budget", label: "Budget", icon: Wallet, show: canSeeBudget },
    { id: "history", label: "History", icon: Archive, show: canSeeBudget },
    { id: "people", label: "Household", icon: Users, show: canSeePeople },
    { id: "activity", label: "Activity", icon: ActivityIcon, show: true },
    { id: "help", label: "Help", icon: HelpCircle, show: true },
  ].filter(t => t.show);
  const label = isAdmin ? "Admin" : (identity?.name || "Housemate");
  return (
    <div className="mb-7">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
        <div>
          <h1 className="font-display" style={{ color: "#1F2A1D", fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>
            Household Goods
          </h1>
          <div style={{ color: "#8A9186", fontSize: 13, marginTop: 2 }}>Shared pantry stock &amp; grocery budget</div>
        </div>
        <div
          className="card-hover"
          style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: "10px 18px", boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}
        >
          <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Pool balance</div>
          <div className="font-display" style={{ color: poolBalance < 0 ? "#C05C4A" : "#1F2A1D", fontSize: 20, fontWeight: 700 }}>
            {money(poolBalance)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-5">
        <span style={{ background: isAdmin ? "#1F2A1D" : "#EDEFEA", color: isAdmin ? "#F7F8F5" : "#4A5247", fontSize: 11, fontWeight: 700, borderRadius: 7, padding: "3px 8px" }}>
          {label} {!isAdmin && "· Housemate"}
        </span>
        <button onClick={switchIdentity} style={{ color: "#8A9186", fontSize: 11.5, textDecoration: "underline" }}>
          switch
        </button>
      </div>
      <div className="flex gap-2 flex-wrap">
        {tabs.map(({ id, label, icon: Icon, badge }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-4 py-2"
              style={{
                background: active ? "#1F2A1D" : "#FFFFFF",
                color: active ? "#F7F8F5" : "#4A5247",
                border: `1px solid ${active ? "#1F2A1D" : "#E7E9E2"}`,
                borderRadius: 10,
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              <Icon size={15} />
              {label}
              {badge > 0 && (
                <span style={{ background: active ? "#F7F8F5" : "#C05C4A", color: active ? "#1F2A1D" : "#fff", fontSize: 10, borderRadius: 8, padding: "1px 6px", fontWeight: 700 }}>
                  {badge}
                </span>
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

  const style = TOAST_STYLE[toast.type] || { color: "#4A5247", icon: ActivityIcon };
  const Icon = style.icon;

  return (
    <div
      className="flex items-start gap-2.5"
      style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderLeft: `4px solid ${style.color}`, borderRadius: 10, padding: "10px 12px", boxShadow: "0 6px 20px rgba(31,42,29,0.12)" }}
    >
      <div style={{ width: 22, height: 22, borderRadius: 7, background: style.color + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
        <Icon size={12} color={style.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
        <span style={{ color: "#1F2A1D", fontWeight: 600 }}>{toast.actor}</span>{" "}
        <span style={{ color: "#4A5247" }}>{toast.message}</span>
      </div>
      <button onClick={() => onDismiss(toast.toastId)} style={{ color: "#B4BAAD", flexShrink: 0 }}>
        <X size={13} />
      </button>
    </div>
  );
}

function AuthShell({ children }) {
  return (
    <div style={{ background: "#F7F8F5", minHeight: "100vh" }} className="flex items-center justify-center px-4">
      <GlobalStyle />
      <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 16, padding: 28, maxWidth: 380, width: "100%", boxShadow: "0 4px 16px rgba(31,42,29,0.06)" }}>
        {children}
      </div>
    </div>
  );
}

function AdminSetup({ credentials, setCredentials, onDone }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    if (!username.trim() || !password) { setError("Enter a username and password."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setCredentials({ ...credentials, adminUsername: username.trim(), adminPassword: password });
    onDone();
  };

  return (
    <AuthShell>
      <h1 className="font-display" style={{ color: "#1F2A1D", fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Set up admin login</h1>
      <div style={{ color: "#8A9186", fontSize: 13, marginBottom: 18 }}>
        You're the first one here — set an admin username and password. You'll use this to assign logins to your housemates.
      </div>
      <div className="flex flex-col gap-2 mb-3">
        <FieldInput placeholder="Admin username" value={username} onChange={e => setUsername(e.target.value)} />
        <FieldInput type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        <FieldInput type="password" placeholder="Confirm password" value={confirm} onChange={e => setConfirm(e.target.value)} />
      </div>
      {error && <div style={{ color: "#C05C4A", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <button onClick={submit} className="w-full" style={{ background: "#1F2A1D", color: "#F7F8F5", borderRadius: 10, padding: "12px 16px", fontWeight: 700, fontSize: 13.5 }}>
        Create admin account
      </button>
      <div style={{ color: "#B4BAAD", fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
        Note: this is a simple household-level login, not encrypted bank-grade security — good for keeping casual housemates out, not for protecting sensitive data.
      </div>
    </AuthShell>
  );
}

function LoginScreen({ credentials, members, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    if (username.trim() === credentials.adminUsername && password === credentials.adminPassword) {
      onLogin({ role: "admin" });
      return;
    }
    const entry = Object.entries(credentials.users || {}).find(
      ([, cred]) => cred.username === username.trim() && cred.password === password
    );
    if (entry) {
      const [memberId] = entry;
      const member = members.find(m => m.id === memberId);
      if (member) {
        onLogin({ role: "member", memberId: member.id, name: member.name });
        return;
      }
    }
    setError("Incorrect username or password.");
  };

  return (
    <AuthShell>
      <h1 className="font-display" style={{ color: "#1F2A1D", fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Log in</h1>
      <div style={{ color: "#8A9186", fontSize: 13, marginBottom: 18 }}>
        Ask your admin for a username and password if you don't have one yet.
      </div>
      <div className="flex flex-col gap-2 mb-3">
        <FieldInput placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
        <FieldInput type="password" placeholder="Password" value={password} onChange={e => { setPassword(e.target.value); setError(""); }} onKeyDown={e => e.key === "Enter" && submit()} />
      </div>
      {error && <div style={{ color: "#C05C4A", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <button onClick={submit} className="w-full" style={{ background: "#1F2A1D", color: "#F7F8F5", borderRadius: 10, padding: "12px 16px", fontWeight: 700, fontSize: 13.5 }}>
        Log in
      </button>
    </AuthShell>
  );
}

function StatCard({ label, value, color }) {
  return (<div>
      <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div className="font-display" style={{ color: color || "#1F2A1D", fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: "#B4BAAD", gridColumn: "1 / -1" }}>
      <Icon size={24} />
      <div style={{ fontSize: 13 }}>{text}</div>
    </div>
  );
}

function FieldInput(props) {
  return (
    <input
      {...props}
      style={{ background: "#F7F8F5", color: "#1F2A1D", border: "1px solid #E7E9E2", borderRadius: 8, fontSize: 13, padding: "8px 10px", ...props.style }}
    />
  );
}
function FieldSelect(props) {
  return (
    <select
      {...props}
      style={{ background: "#F7F8F5", color: "#1F2A1D", border: "1px solid #E7E9E2", borderRadius: 8, fontSize: 13, padding: "8px 10px", ...props.style }}
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
        <div key={item.id} style={{ background: "#FFFFFF", border: "1px solid #4C8B5C", borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 8px rgba(31,42,29,0.06)" }}>
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
              <label style={{ color: "#8A9186", fontSize: 11 }}>Alert below</label>
              <FieldInput type="number" min="0" step="any" className="w-16" value={editForm.lowThreshold} onChange={e => setEditForm({ ...editForm, lowThreshold: e.target.value })} style={{ fontSize: 12 }} />
            </div>
            <div className="flex gap-1.5 mt-1">
              <button onClick={saveEdit} className="flex-1 flex items-center justify-center gap-1" style={{ background: "#4C8B5C", color: "#fff", borderRadius: 8, padding: "6px 0", fontSize: 12, fontWeight: 600 }}>
                <Check size={12} /> Save
              </button>
              <button onClick={cancelEdit} style={{ background: "#F7F8F5", border: "1px solid #E7E9E2", color: "#4A5247", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={item.id} className="card-hover" style={{ background: "#FFFFFF", border: `1px solid ${low ? "#F0C4B8" : "#E7E9E2"}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
        <div style={{ height: 5, background: cat.color }} />
        <div style={{ padding: "12px 14px" }}>
          <div className="flex items-start justify-between mb-2">
            <div style={{ width: 30, height: 30, borderRadius: 8, background: cat.color + "1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={15} color={cat.color} />
            </div>
            {isAdmin && (
              <div className="flex items-center gap-0.5">
                <button onClick={() => startEdit(item)} style={{ color: "#B4BAAD", padding: 2 }}>
                  <Pencil size={12} />
                </button>
                <button onClick={() => removeItem(item)} style={{ color: "#C6CBC0", padding: 2 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
          <div style={{ color: "#1F2A1D", fontSize: 14, fontWeight: 600, marginBottom: 1 }}>{item.name}</div>
          <div style={{ color: "#8A9186", fontSize: 11, marginBottom: 10 }}>{item.category}</div>
          {low && (
            <div className="flex items-center gap-1 mb-2" style={{ color: "#C05C4A", fontSize: 11, fontWeight: 600 }}>
              <AlertTriangle size={11} /> {item.qty === 0 ? "Out of stock" : "Running low"}
            </div>
          )}
          <div className="flex items-center justify-between">
            <button onClick={() => adjustQty(item, -1)} style={{ background: "#F7F8F5", border: "1px solid #E7E9E2", borderRadius: 7, padding: 5 }}>
              <Minus size={12} color="#4A5247" />
            </button>
            <span className="font-display" style={{ color: low ? "#C05C4A" : "#1F2A1D", fontSize: 14, fontWeight: 700 }}>
              {item.qty} <span style={{ fontSize: 11, fontWeight: 500, color: "#8A9186" }}>{item.unit}</span>
            </span>
            <button onClick={() => adjustQty(item, 1)} style={{ background: "#F7F8F5", border: "1px solid #E7E9E2", borderRadius: 7, padding: 5 }}>
              <Plus size={12} color="#4A5247" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div style={{ color: "#4A5247", fontSize: 13 }}>{pantry.length} item{pantry.length !== 1 ? "s" : ""} on the shelf</div>
        {isAdmin && (
          <button
            onClick={() => setAdding(a => !a)}
            className="flex items-center gap-1.5 px-3.5 py-2"
            style={{ background: "#4C8B5C", color: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 600 }}
          >
            {adding ? <X size={14} /> : <Plus size={14} />}
            {adding ? "Cancel" : "Add item"}
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#B4BAAD" }} />
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
                  background: active ? "#1F2A1D" : "#FFFFFF",
                  color: active ? "#fff" : "#4A5247",
                  border: `1px solid ${active ? "#1F2A1D" : "#E7E9E2"}`,
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
        <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 16, marginBottom: 20, boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
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
            <label style={{ color: "#8A9186", fontSize: 12 }}>Alert when below</label>
            <FieldInput type="number" min="0" step="any" className="w-16" value={form.lowThreshold} onChange={e => setForm({ ...form, lowThreshold: e.target.value })} />
            <button onClick={addItem} className="ml-auto px-4 py-2" style={{ background: "#1F2A1D", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
              Add to shelf
            </button>
          </div>
        </div>
      )}

      {lowItems.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-1.5 mb-2" style={{ color: "#C05C4A", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
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
              <div className="font-mono mb-2" style={{ color: "rgba(31,42,29,0.35)", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" }}>
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
      <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        From your pantry ({lowItems.length})
      </div>
      {lowItems.length === 0 ? (
        <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 16, marginBottom: 24, color: "#8A9186", fontSize: 13 }}>
          Nothing running low right now — the pantry's in good shape.
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-7">
          {lowItems.map(item => {
            const cat = catInfo(item.category);
            const Icon = cat.icon;
            return (
              <div key={item.id} className="card-hover flex items-center gap-3 flex-wrap" style={{ background: "#FFFFFF", border: "1px solid #F0C4B8", borderRadius: 12, padding: "10px 12px", boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: cat.color + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={15} color={cat.color} />
                </div>
                <div style={{ flex: 1, minWidth: 100 }}>
                  <div style={{ color: "#1F2A1D", fontSize: 13.5, fontWeight: 600 }}>{item.name}</div>
                  <div style={{ color: "#C05C4A", fontSize: 11 }}>{item.qty === 0 ? "Out of stock" : `${item.qty} ${item.unit} left`}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <FieldInput type="number" min="0" step="any" value={amountFor(item)} onChange={e => setAmount(item.id, e.target.value)} className="w-16" style={{ padding: "5px 8px", fontSize: 12 }} />
                  <span style={{ color: "#8A9186", fontSize: 11 }}>{item.unit}</span>
                  <button onClick={() => markBought(item)} className="flex items-center gap-1" style={{ background: "#4C8B5C", color: "#fff", borderRadius: 7, padding: "6px 10px", fontSize: 11.5, fontWeight: 600 }}>
                    <Check size={12} /> Bought
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        Other items to pick up
      </div>
      <div className="flex gap-2 mb-3">
        <FieldInput placeholder="e.g. birthday candles" value={extraText} onChange={e => setExtraText(e.target.value)} onKeyDown={e => e.key === "Enter" && addExtra()} style={{ flex: 1 }} />
        <button onClick={addExtra} className="px-3.5 py-2" style={{ background: "#1F2A1D", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          Add
        </button>
      </div>
      {shoppingExtra.length === 0 ? (
        <EmptyState icon={ShoppingCart} text="No extra items on the list." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {shoppingExtra.map(item => (
            <div key={item.id} className="flex items-center gap-3" style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#1F2A1D", fontSize: 13 }}>{item.name}</div>
                <div style={{ color: "#B4BAAD", fontSize: 10.5 }}>added by {item.addedBy}</div>
              </div>
              <button onClick={() => boughtExtra(item)} className="flex items-center gap-1" style={{ background: "#4C8B5C", color: "#fff", borderRadius: 7, padding: "5px 9px", fontSize: 11, fontWeight: 600 }}>
                <Check size={11} /> Bought
              </button>
              <button onClick={() => removeExtra(item)} style={{ color: "#C6CBC0", padding: 3 }}>
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
          <StatCard label="Contributed" value={money(totalContributed)} color="#4C8B5C" />
          <StatCard label="Spent" value={money(totalSpent)} color="#C05C4A" />
          <StatCard label="Balance" value={money(poolBalance)} color="#C79A3E" />
        </div>
      </div>

      {isAdmin && tx.length > 0 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 14, marginBottom: 20 }}>
          {!confirmClose ? (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div style={{ color: "#4A5247", fontSize: 12.5 }}>Done with {monthLabel}? Archive it and start a fresh ledger.</div>
              <button onClick={() => setConfirmClose(true)} className="flex items-center gap-1.5 px-3 py-1.5" style={{ background: "#F7F8F5", border: "1px solid #E7E9E2", color: "#4A5247", borderRadius: 8, fontSize: 12.5, fontWeight: 600 }}>
                <Archive size={13} /> Close out {monthLabel}
              </button>
            </div>
          ) : (
            <div>
              <div style={{ color: "#1F2A1D", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Archive {monthLabel} and start over?</div>
              <div style={{ color: "#8A9186", fontSize: 12, marginBottom: 10 }}>
                All {tx.length} entries move to History. Monthly targets stay the same for next month — only what's been paid resets to $0.
              </div>
              <div className="flex gap-2">
                <button onClick={() => { closeMonth(); setConfirmClose(false); }} className="px-3 py-1.5" style={{ background: "#C05C4A", color: "#fff", borderRadius: 8, fontSize: 12.5, fontWeight: 600 }}>
                  Yes, archive it
                </button>
                <button onClick={() => setConfirmClose(false)} className="px-3 py-1.5" style={{ background: "#F7F8F5", border: "1px solid #E7E9E2", color: "#4A5247", borderRadius: 8, fontSize: 12.5, fontWeight: 600 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {members.length === 0 ? (
        <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 16, marginBottom: 20, color: "#4A5247", fontSize: 13 }}>
          Add housemates in the Household tab first — then you can log who paid what.
        </div>
      ) : (
        <>
          {isAdmin ? (
          <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 16, marginBottom: 20, boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
            <div className="flex gap-2 mb-3">
              {["expense", "contribution"].map(t => (
                <button
                  key={t}
                  onClick={() => setForm({ ...form, type: t })}
                  className="px-3 py-1.5"
                  style={{
                    background: form.type === t ? (t === "expense" ? "#C05C4A" : "#4C8B5C") : "#F7F8F5",
                    color: form.type === t ? "#fff" : "#4A5247",
                    border: "1px solid " + (form.type === t ? "transparent" : "#E7E9E2"),
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
                        background: active ? c.color + "1A" : "#F7F8F5",
                        color: active ? c.color : "#8A9186",
                        border: `1px solid ${active ? c.color : "#E7E9E2"}`,
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
                <div style={{ color: "#8A9186", fontSize: 11, marginBottom: 6 }}>Who paid?</div>
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    onClick={() => setForm({ ...form, paidBy: "pool" })}
                    className="px-2.5 py-1.5"
                    style={{
                      background: form.paidBy === "pool" ? "#1F2A1D" : "#F7F8F5",
                      color: form.paidBy === "pool" ? "#fff" : "#4A5247",
                      border: `1px solid ${form.paidBy === "pool" ? "#1F2A1D" : "#E7E9E2"}`,
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
                          background: active ? "#4A7FB5" : "#F7F8F5",
                          color: active ? "#fff" : "#4A5247",
                          border: `1px solid ${active ? "#4A7FB5" : "#E7E9E2"}`,
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
                <div style={{ color: "#8A9186", fontSize: 11, marginBottom: 6 }}>
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
                          background: active ? "#1F2A1D" : "#F7F8F5",
                          color: active ? "#fff" : "#4A5247",
                          border: `1px solid ${active ? "#1F2A1D" : "#E7E9E2"}`,
                          borderRadius: 8, fontSize: 12, fontWeight: 600,
                        }}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
                {splitWith.length > 0 && Number(form.amount) > 0 && (
                  <div style={{ color: form.paidBy === "pool" ? "#4C8B5C" : "#4A7FB5", fontSize: 11.5, marginTop: 6, fontWeight: 600 }}>
                    {form.paidBy === "pool"
                      ? `→ ${money(Number(form.amount) / splitWith.length)} added to each of ${splitWith.length} housemate${splitWith.length > 1 ? "s'" : "'s"} target`
                      : `→ each owes ${form.paidBy} ${money(Number(form.amount) / splitWith.length)}`}
                  </div>
                )}
              </div>
            )}
            {form.type === "contribution" && (
              <div className="mb-3">
                <div style={{ color: "#8A9186", fontSize: 11, marginBottom: 6 }}>For</div>
                <FieldSelect value={form.person} onChange={e => setForm({ ...form, person: e.target.value })} style={{ marginBottom: 8, width: "100%" }}>
                  {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </FieldSelect>
                <div style={{ color: "#8A9186", fontSize: 11, marginBottom: 6 }}>Actually paid by (optional — if someone covered it for them)</div>
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    onClick={() => setForm({ ...form, contribPaidBy: "" })}
                    className="px-2.5 py-1.5"
                    style={{
                      background: !form.contribPaidBy ? "#1F2A1D" : "#F7F8F5",
                      color: !form.contribPaidBy ? "#fff" : "#4A5247",
                      border: `1px solid ${!form.contribPaidBy ? "#1F2A1D" : "#E7E9E2"}`,
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
                          background: active ? "#4A7FB5" : "#F7F8F5",
                          color: active ? "#fff" : "#4A5247",
                          border: `1px solid ${active ? "#4A7FB5" : "#E7E9E2"}`,
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
              <button onClick={addTx} className="px-3 py-2" style={{ background: "#1F2A1D", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                Log it
              </button>
            </div>
          </div>
          ) : (
            <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 16, marginBottom: 20, color: "#8A9186", fontSize: 13 }}>
              Only the house admin can log contributions and expenses. You can view balances and the ledger below.
            </div>
          )}

          <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Settle up</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-7">
            {perPerson.map(m => (
              <div key={m.id} className="card-hover" style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: "12px 14px", boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
                <div style={{ color: "#1F2A1D", fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{m.name}</div>
                <div style={{ color: "#8A9186", fontSize: 12, marginBottom: 4 }}>{money(m.contributed)} of {money(m.contribution)}</div>
                <div style={{ background: "#F0F1EC", borderRadius: 6, height: 6, overflow: "hidden" }}>
                  <div style={{ width: `${m.contribution > 0 ? Math.min(100, (m.contributed / m.contribution) * 100) : 0}%`, background: m.remaining > 0 ? "#C79A3E" : "#4C8B5C", height: "100%" }} />
                </div>
                <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
                  <span style={{ color: m.remaining > 0 ? "#C79A3E" : "#4C8B5C", fontSize: 11.5, fontWeight: 600 }}>
                    {m.remaining > 0 ? `Owes ${money(m.remaining)}` : "Settled up"}
                  </span>
                  {isAdmin && m.remaining > 0 && (
                    <button onClick={() => settleUp(m)} className="flex items-center gap-1" style={{ color: "#4C8B5C", fontSize: 11, fontWeight: 600 }}>
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
          <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Who owes whom</div>
          <div className="flex flex-col gap-2 mb-7">
            {peerDebts.map((d, i) => (
              <div key={i} className="card-hover flex items-center gap-3" style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 12, padding: "10px 14px", boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: "#4A7FB51A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <HandCoins size={14} color="#4A7FB5" />
                </div>
                <div style={{ flex: 1, fontSize: 13, color: "#1F2A1D" }}>
                  <span style={{ fontWeight: 700 }}>{d.from}</span> owes <span style={{ fontWeight: 700 }}>{d.to}</span>
                </div>
                <div className="font-mono" style={{ color: "#4A7FB5", fontSize: 13.5, fontWeight: 700 }}>{money(d.amount)}</div>
                {isAdmin && (
                  <button onClick={() => settlePeerDebt(d)} className="px-2.5 py-1" style={{ background: "#F7F8F5", border: "1px solid #E7E9E2", color: "#4A5247", borderRadius: 7, fontSize: 11, fontWeight: 600 }}>
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
          <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Spending by category</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-7">
            {spendByCategory.map(c => {
              const Icon = c.icon;
              return (
                <div key={c.name} className="card-hover" style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: "12px 14px", boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: c.color + "1A", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                    <Icon size={13} color={c.color} />
                  </div>
                  <div style={{ color: "#8A9186", fontSize: 11 }}>{c.name}</div>
                  <div className="font-display" style={{ color: "#1F2A1D", fontSize: 15, fontWeight: 700 }}>{money(c.total)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Ledger</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {tx.length === 0 && <EmptyState icon={Wallet} text="No entries yet." />}
        {tx.map(t => {
          const cat = (t.type === "expense" || t.type === "peer") ? expCatInfo(t.category || "Other") : null;
          const CatIcon = cat ? cat.icon : ArrowDownRight;
          const iconColor = t.type === "expense" ? cat.color : t.type === "peer" ? "#4A7FB5" : "#4C8B5C";
          return (
            <div key={t.id} className="card-hover flex items-center gap-3" style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 12, padding: "10px 12px", boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: iconColor + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <CatIcon size={14} color={iconColor} />
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ color: "#1F2A1D", fontSize: 13, fontWeight: 500 }}>
                  {t.type === "expense" ? <>Household <span style={{ color: "#8A9186", fontWeight: 400 }}>· {cat.name}</span></>
                    : t.type === "peer" ? <>{t.payer} paid <span style={{ color: "#8A9186", fontWeight: 400 }}>· {cat?.name}</span></>
                    : `${t.person} contributed`}
                </div>
                <div style={{ color: "#B4BAAD", fontSize: 11 }}>
                  {t.note ? `${t.note} · ` : ""}{t.splitWith ? `${t.type === "peer" ? "owed by" : "split with"} ${t.splitWith.join(", ")} · ` : ""}{new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </div>
              </div>
              <div className="font-display" style={{ color: t.type === "expense" ? "#C05C4A" : t.type === "peer" ? "#4A7FB5" : "#4C8B5C", fontSize: 13, fontWeight: 700 }}>
                {t.type === "expense" ? "-" : t.type === "peer" ? "" : "+"}{money(t.amount)}
              </div>
              <button onClick={() => removeTx(t)} style={{ color: "#C6CBC0", padding: 3, visibility: isAdmin ? "visible" : "hidden" }}>
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
          <div key={rec.id} style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, boxShadow: "0 2px 8px rgba(31,42,29,0.04)", overflow: "hidden" }}>
            <button
              onClick={() => setExpanded(open ? null : rec.id)}
              className="w-full flex items-center justify-between"
              style={{ padding: "14px 16px" }}
            >
              <div className="text-left">
                <div className="font-display" style={{ color: "#1F2A1D", fontSize: 15, fontWeight: 700 }}>{rec.label}</div>
                <div style={{ color: "#8A9186", fontSize: 11.5 }}>{rec.tx.length} entries</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div style={{ color: "#8A9186", fontSize: 10.5 }}>contributed / spent</div>
                  <div className="font-mono" style={{ fontSize: 12.5 }}>
                    <span style={{ color: "#4C8B5C" }}>{money(rec.totalContributed)}</span>
                    {" / "}
                    <span style={{ color: "#C05C4A" }}>{money(rec.totalSpent)}</span>
                  </div>
                </div>
                {open ? <ChevronUp size={16} color="#8A9186" /> : <ChevronDown size={16} color="#8A9186" />}
              </div>
            </button>

            {open && (
              <div style={{ borderTop: "1px solid #F0F1EC", padding: "14px 16px" }}>
                <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Per person</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                  {rec.perPerson.map(p => (
                    <div key={p.name} style={{ background: "#F7F8F5", borderRadius: 10, padding: "8px 10px" }}>
                      <div style={{ color: "#1F2A1D", fontSize: 12.5, fontWeight: 600 }}>{p.name}</div>
                      <div style={{ color: "#8A9186", fontSize: 11 }}>{money(p.contributed)} of {money(p.target)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Entries</div>
                <div className="flex flex-col gap-1">
                  {rec.tx.map(t => (
                    <div key={t.id} className="flex items-center justify-between" style={{ fontSize: 12, padding: "5px 0", borderBottom: "1px solid #F5F6F2" }}>
                      <span style={{ color: "#4A5247" }}>
                        {t.type === "expense" ? `Household · ${t.category || "Other"}`
                          : t.type === "peer" ? `${t.payer} paid for ${(t.splitWith || []).join(", ")}`
                          : `${t.person} contributed`}
                        {t.note && <span style={{ color: "#B4BAAD" }}> — {t.note}</span>}
                      </span>
                      <span className="font-mono" style={{ color: t.type === "expense" ? "#C05C4A" : t.type === "peer" ? "#4A7FB5" : "#4C8B5C", fontWeight: 600 }}>
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
          <div key={a.id} className="flex items-center gap-3" style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 10, padding: "9px 12px" }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: "#F7F8F5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon size={13} color="#8A9186" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ color: "#1F2A1D", fontWeight: 600 }}>{a.actor}</span>{" "}
              <span style={{ color: "#4A5247" }}>{a.message}</span>
            </div>
            <div style={{ color: "#B4BAAD", fontSize: 11, whiteSpace: "nowrap" }}>{timeAgo(a.date)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Help tab -----------------------------------------------------------

function GuideSection({ title, icon: Icon, color, items }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 16, marginBottom: 12, boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
      <div className="flex items-center gap-2 mb-3">
        <div style={{ width: 26, height: 26, borderRadius: 8, background: color + "1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={13} color={color} />
        </div>
        <div style={{ color: "#1F2A1D", fontSize: 14, fontWeight: 700 }}>{title}</div>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            <span style={{ color: "#1F2A1D", fontWeight: 600 }}>{item.t}</span>{" "}
            <span style={{ color: "#4A5247" }}>{item.d}</span>
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
      title: "Pantry & Shopping", icon: Package, color: "#4C8B5C",
      items: [
        { t: "Add, edit, or remove items", d: "with the pencil and trash icons — only admin can do this; housemates can only adjust quantities." },
        { t: "Set a low-stock threshold", d: "per item so it shows up under Running Low and on the Shopping list automatically." },
        { t: "Shopping tab", d: "is admin-only — restock straight from there and it updates pantry quantities." },
      ],
    },
    {
      title: "Money", icon: Wallet, color: "#C79A3E",
      items: [
        { t: "Contribution", d: "logs money going into the shared pool for one person's monthly target." },
        { t: "Expense", d: "logs money leaving the pool — pick a category (Groceries, Rent, Maid, etc)." },
        { t: "\"Who paid?\"", d: "on an expense — leave it as Household pool for normal shared spending, or pick a person if they paid out of their own pocket for others (this creates a debt instead of touching the pool)." },
        { t: "\"Actually paid by\"", d: "on a contribution — use this if one housemate covered another's contribution. The pool credits the covered person, and they owe the payer directly." },
        { t: "Settle up / Who owes whom", d: "one-tap buttons to clear a pool debt or a person-to-person debt once it's paid back in real life." },
        { t: "Close out a month", d: "archives the current ledger to History and resets — monthly targets carry over, only what's paid resets to $0." },
      ],
    },
  ];

  const memberGuide = [
    {
      title: "Pantry", icon: Package, color: "#4C8B5C",
      items: [
        { t: "Search or filter by category", d: "to find an item fast." },
        { t: "Use the +/− buttons", d: "to update quantity as things get used up or restocked — that's the one thing you can always do here." },
        { t: "Running Low", d: "at the top shows what needs restocking soonest." },
      ],
    },
    {
      title: "Money (if your admin's given you access)", icon: Wallet, color: "#C79A3E",
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
        <span style={{ background: isAdmin ? "#1F2A1D" : "#EDEFEA", color: isAdmin ? "#F7F8F5" : "#4A5247", fontSize: 11, fontWeight: 700, borderRadius: 7, padding: "3px 8px" }}>
          {isAdmin ? "Admin guide" : "Housemate guide"}
        </span>
      </div>
      <div style={{ color: "#8A9186", fontSize: 12.5, marginBottom: 16 }}>
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
  const draftFor = (id) => loginDrafts[id] || credentials.users?.[id] || { username: "", password: "" };
  const setDraft = (id, field, value) => setLoginDrafts({ ...loginDrafts, [id]: { ...draftFor(id), [field]: value } });
  const saveLogin = (id, memberName) => {
    const d = draftFor(id);
    if (!d.username?.trim() || !d.password) return;
    setCredentials({ ...credentials, users: { ...credentials.users, [id]: { username: d.username.trim(), password: d.password } } });
    logActivity?.(`set login credentials for ${memberName}`, "people");
  };

  return (
    <div>
      {isAdmin ? (
      <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 16, marginBottom: 20, boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <FieldInput className="col-span-2 sm:col-span-1" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <FieldInput type="number" min="0" placeholder="Monthly target ($)" value={form.contribution} onChange={e => setForm({ ...form, contribution: e.target.value })} />
          <button onClick={addMember} className="px-3 py-2" style={{ background: "#4C8B5C", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            Add housemate
          </button>
        </div>
      </div>
      ) : (
        <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 16, marginBottom: 20, color: "#8A9186", fontSize: 13 }}>
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
            <div key={m.id} className="card-hover" style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 14, boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
              <div className="flex items-center justify-between mb-3">
                <div style={{ width: 34, height: 34, borderRadius: 10, background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>
                  {m.name.charAt(0).toUpperCase()}
                </div>
                {isAdmin && (
                  <button onClick={() => removeMember(m)} style={{ color: "#C6CBC0", padding: 3 }}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div style={{ color: "#1F2A1D", fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{m.name}</div>
              <div className="flex items-center gap-1.5 mb-2">
                <label style={{ color: "#8A9186", fontSize: 11 }}>Target</label>
                {isAdmin ? (
                  <FieldInput type="number" min="0" className="w-20" style={{ padding: "4px 8px" }} value={m.contribution} onChange={e => updateTarget(m.id, e.target.value)} />
                ) : (
                  <span style={{ color: "#1F2A1D", fontSize: 12, fontWeight: 600 }}>{money(m.contribution)}</span>
                )}
              </div>
              <div style={{ color: "#8A9186", fontSize: 11.5, marginBottom: isAdmin ? 10 : 0 }}>Paid {money(contributed)}</div>

              {isAdmin && (
                <div className="flex flex-col gap-1.5 pt-2.5 mb-2.5" style={{ borderTop: "1px solid #F0F1EC" }}>
                  <div style={{ color: "#8A9186", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>Login</div>
                  <FieldInput placeholder="Username" style={{ padding: "5px 8px", fontSize: 12 }} value={draftFor(m.id).username} onChange={e => setDraft(m.id, "username", e.target.value)} />
                  <div className="flex gap-1.5">
                    <FieldInput type="password" placeholder="Password" style={{ padding: "5px 8px", fontSize: 12, flex: 1 }} value={draftFor(m.id).password} onChange={e => setDraft(m.id, "password", e.target.value)} />
                    <button onClick={() => saveLogin(m.id, m.name)} style={{ background: "#1F2A1D", color: "#fff", borderRadius: 7, padding: "0 10px", fontSize: 11.5, fontWeight: 600 }}>Save</button>
                  </div>
                  {credentials.users?.[m.id] && <div style={{ color: "#4C8B5C", fontSize: 10.5 }}>Login set ✓</div>}
                </div>
              )}

              {isAdmin && (
                <div className="flex flex-col gap-1.5 pt-2.5" style={{ borderTop: "1px solid #F0F1EC" }}>
                  <div style={{ color: "#8A9186", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>Can see</div>
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
    <button onClick={onChange} className="flex items-center justify-between" style={{ fontSize: 12, color: "#4A5247" }}>
      <span>{label}</span>
      <span
        style={{
          width: 30, height: 17, borderRadius: 9, background: checked ? "#4C8B5C" : "#E7E9E2",
          position: "relative", transition: "background .15s ease", flexShrink: 0,
        }}
      >
        <span style={{ position: "absolute", top: 2, left: checked ? 15 : 2, width: 13, height: 13, borderRadius: "50%", background: "#fff", transition: "left .15s ease" }} />
      </span>
    </button>
  );
}
