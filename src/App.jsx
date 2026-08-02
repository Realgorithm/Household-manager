import React, { useState, useEffect, useCallback } from "react";
import { Plus, Minus, Trash2, X, Package, Wallet, Users, AlertTriangle, ArrowUpRight, ArrowDownRight, Sprout, Milk, Beef, Snowflake, Home, ShoppingBasket, Sparkles, KeyRound, MoreHorizontal } from "lucide-react";
import { supabase } from "./supabaseClient";

// ---- storage helpers ---------------------------------------------------
const KEYS = {
  members: "household:members",
  pantry: "household:pantry",
  tx: "household:transactions",
  permissions: "household:permissions",
  credentials: "household:credentials",
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
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [identityChecked, setIdentityChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const [m, p, t, perms, creds, id] = await Promise.all([
        loadKey(KEYS.members, []),
        loadKey(KEYS.pantry, []),
        loadKey(KEYS.tx, []),
        loadKey(KEYS.permissions, {}),
        loadKey(KEYS.credentials, { adminUsername: "", adminPassword: "", users: {} }),
        loadIdentity(),
      ]);
      setMembers(m);
      setPantry(p);
      setTx(t);
      setPermissions(perms);
      setCredentials(creds);
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

  const reloadAll = useCallback(async () => {
    const [m, p, t, perms, creds] = await Promise.all([
      loadKey(KEYS.members, []),
      loadKey(KEYS.pantry, []),
      loadKey(KEYS.tx, []),
      loadKey(KEYS.permissions, {}),
      loadKey(KEYS.credentials, { adminUsername: "", adminPassword: "", users: {} }),
    ]);
    setMembers(m);
    setPantry(p);
    setTx(t);
    setPermissions(perms);
    setCredentials(creds);
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

  const totalContributed = tx.filter(t => t.type === "contribution").reduce((s, t) => s + t.amount, 0);
  const totalSpent = tx.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const poolBalance = totalContributed - totalSpent;
  const lowStockCount = pantry.filter(i => i.qty <= i.lowThreshold).length;

  const isAdmin = identity?.role === "admin";
  const myPerms = identity?.role === "member" ? getPerms(permissions, identity.memberId) : DEFAULT_PERMS;
  const canSeeBudget = isAdmin || myPerms.budget;
  const canSeePeople = isAdmin || myPerms.people;

  useEffect(() => {
    if (tab === "budget" && !canSeeBudget) setTab("pantry");
    if (tab === "people" && !canSeePeople) setTab("pantry");
  }, [tab, canSeeBudget, canSeePeople]);

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
        {tab === "pantry" && <PantryTab pantry={pantry} setPantry={persistPantry} isAdmin={isAdmin} />}
        {tab === "budget" && canSeeBudget && (
          <BudgetTab members={members} setMembers={persistMembers} tx={tx} setTx={persistTx} poolBalance={poolBalance} totalContributed={totalContributed} totalSpent={totalSpent} isAdmin={isAdmin} />
        )}
        {tab === "people" && canSeePeople && (
          <PeopleTab members={members} setMembers={persistMembers} tx={tx} isAdmin={isAdmin} permissions={permissions} setPermissions={persistPermissions} credentials={credentials} setCredentials={persistCredentials} />
        )}
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
  const tabs = [
    { id: "pantry", label: "Pantry", icon: Package, badge: lowStockCount, show: true },
    { id: "budget", label: "Budget", icon: Wallet, show: canSeeBudget },
    { id: "people", label: "Household", icon: Users, show: canSeePeople },
  ].filter(t => t.show);
  const isAdmin = identity?.role === "admin";
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
  return (
    <div>
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

function PantryTab({ pantry, setPantry, isAdmin }) {
  const [form, setForm] = useState({ name: "", category: CATEGORIES[0].name, qty: 1, unit: "pcs", lowThreshold: 1 });
  const [adding, setAdding] = useState(false);

  const addItem = () => {
    if (!form.name.trim()) return;
    setPantry([...pantry, { id: uid(), ...form, qty: Number(form.qty), lowThreshold: Number(form.lowThreshold) }]);
    setForm({ name: "", category: CATEGORIES[0].name, qty: 1, unit: "pcs", lowThreshold: 1 });
    setAdding(false);
  };
  const adjustQty = (id, delta) => setPantry(pantry.map(i => i.id === id ? { ...i, qty: Math.max(0, i.qty + delta) } : i));
  const removeItem = (id) => setPantry(pantry.filter(i => i.id !== id));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
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

      {adding && isAdmin && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: 16, marginBottom: 20, boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <FieldInput className="col-span-2 sm:col-span-2" placeholder="Item name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <FieldSelect value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </FieldSelect>
            <FieldInput type="number" min="0" placeholder="Qty" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
            <FieldInput placeholder="Unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <label style={{ color: "#8A9186", fontSize: 12 }}>Alert when below</label>
            <FieldInput type="number" min="0" className="w-16" value={form.lowThreshold} onChange={e => setForm({ ...form, lowThreshold: e.target.value })} />
            <button onClick={addItem} className="ml-auto px-4 py-2" style={{ background: "#1F2A1D", color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
              Add to shelf
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {pantry.length === 0 && <EmptyState icon={Package} text="The shelf is empty — add your first item." />}
        {pantry.map(item => {
          const cat = catInfo(item.category);
          const Icon = cat.icon;
          const low = item.qty <= item.lowThreshold;
          return (
            <div key={item.id} className="card-hover" style={{ background: "#FFFFFF", border: `1px solid ${low ? "#F0C4B8" : "#E7E9E2"}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
              <div style={{ height: 5, background: cat.color }} />
              <div style={{ padding: "12px 14px" }}>
                <div className="flex items-start justify-between mb-2">
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: cat.color + "1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={15} color={cat.color} />
                  </div>
                  {isAdmin && (
                    <button onClick={() => removeItem(item.id)} style={{ color: "#C6CBC0", padding: 2 }}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <div style={{ color: "#1F2A1D", fontSize: 14, fontWeight: 600, marginBottom: 1 }}>{item.name}</div>
                <div style={{ color: "#8A9186", fontSize: 11, marginBottom: 10 }}>{item.category}</div>
                {low && (
                  <div className="flex items-center gap-1 mb-2" style={{ color: "#C05C4A", fontSize: 11, fontWeight: 600 }}>
                    <AlertTriangle size={11} /> Running low
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <button onClick={() => adjustQty(item.id, -1)} style={{ background: "#F7F8F5", border: "1px solid #E7E9E2", borderRadius: 7, padding: 5 }}>
                    <Minus size={12} color="#4A5247" />
                  </button>
                  <span className="font-display" style={{ color: low ? "#C05C4A" : "#1F2A1D", fontSize: 14, fontWeight: 700 }}>
                    {item.qty} <span style={{ fontSize: 11, fontWeight: 500, color: "#8A9186" }}>{item.unit}</span>
                  </span>
                  <button onClick={() => adjustQty(item.id, 1)} style={{ background: "#F7F8F5", border: "1px solid #E7E9E2", borderRadius: 7, padding: 5 }}>
                    <Plus size={12} color="#4A5247" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Budget tab ------------------------------------------------------

function BudgetTab({ members, setMembers, tx, setTx, poolBalance, totalContributed, totalSpent, isAdmin }) {
  const [form, setForm] = useState({ type: "expense", category: "Groceries", person: "", amount: "", note: "" });
  const [splitWith, setSplitWith] = useState([]);

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
    setForm({ ...form, amount: "", note: "" });
    setSplitWith([]);
  };
  const removeTx = (id) => setTx(tx.filter(t => t.id !== id));

  const spendByCategory = EXPENSE_CATEGORIES.map(c => ({
    ...c,
    total: tx.filter(t => t.type === "expense" && (t.category || "Other") === c.name).reduce((s, t) => s + t.amount, 0),
  })).filter(c => c.total > 0);

  const perPerson = members.map(m => {
    const contributed = tx.filter(t => t.type === "contribution" && t.person === m.name).reduce((s, t) => s + t.amount, 0);
    return { ...m, contributed, remaining: m.contribution - contributed };
  });

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="Contributed" value={money(totalContributed)} color="#4C8B5C" />
        <StatCard label="Spent" value={money(totalSpent)} color="#C05C4A" />
        <StatCard label="Balance" value={money(poolBalance)} color="#C79A3E" />
      </div>

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
                <div style={{ color: "#8A9186", fontSize: 11, marginBottom: 6 }}>Split with specific housemates? (optional — adds their share to their monthly target)</div>
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
                  <div style={{ color: "#4C8B5C", fontSize: 11.5, marginTop: 6, fontWeight: 600 }}>
                    → {money(Number(form.amount) / splitWith.length)} added to each of {splitWith.length} housemate{splitWith.length > 1 ? "s'" : "'s"} target
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {form.type === "contribution" && (
                <FieldSelect value={form.person} onChange={e => setForm({ ...form, person: e.target.value })}>
                  {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </FieldSelect>
              )}
              <FieldInput type="number" min="0" step="0.01" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={form.type === "expense" ? "col-span-2 sm:col-span-1" : ""} />
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

          <div style={{ color: "#8A9186", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Contribution targets</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-7">
            {perPerson.map(m => (
              <div key={m.id} className="card-hover" style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 14, padding: "12px 14px", boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
                <div style={{ color: "#1F2A1D", fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{m.name}</div>
                <div style={{ color: "#8A9186", fontSize: 12, marginBottom: 4 }}>{money(m.contributed)} of {money(m.contribution)}</div>
                <div style={{ background: "#F0F1EC", borderRadius: 6, height: 6, overflow: "hidden" }}>
                  <div style={{ width: `${m.contribution > 0 ? Math.min(100, (m.contributed / m.contribution) * 100) : 0}%`, background: m.remaining > 0 ? "#C79A3E" : "#4C8B5C", height: "100%" }} />
                </div>
                <div style={{ color: m.remaining > 0 ? "#C79A3E" : "#4C8B5C", fontSize: 11.5, fontWeight: 600, marginTop: 6 }}>
                  {m.remaining > 0 ? `Owes ${money(m.remaining)}` : "Settled up"}
                </div>
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
          const cat = t.type === "expense" ? expCatInfo(t.category || "Other") : null;
          const CatIcon = cat ? cat.icon : ArrowDownRight;
          const iconColor = t.type === "expense" ? cat.color : "#4C8B5C";
          return (
            <div key={t.id} className="card-hover flex items-center gap-3" style={{ background: "#FFFFFF", border: "1px solid #E7E9E2", borderRadius: 12, padding: "10px 12px", boxShadow: "0 2px 8px rgba(31,42,29,0.04)" }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: iconColor + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <CatIcon size={14} color={iconColor} />
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ color: "#1F2A1D", fontSize: 13, fontWeight: 500 }}>
                  {t.type === "expense" ? <>Household <span style={{ color: "#8A9186", fontWeight: 400 }}>· {cat.name}</span></> : `${t.person} contributed`}
                </div>
                <div style={{ color: "#B4BAAD", fontSize: 11 }}>
                  {t.note ? `${t.note} · ` : ""}{t.splitWith ? `split with ${t.splitWith.join(", ")} · ` : ""}{new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </div>
              </div>
              <div className="font-display" style={{ color: t.type === "expense" ? "#C05C4A" : "#4C8B5C", fontSize: 13, fontWeight: 700 }}>
                {t.type === "expense" ? "-" : "+"}{money(t.amount)}
              </div>
              <button onClick={() => removeTx(t.id)} style={{ color: "#C6CBC0", padding: 3, visibility: isAdmin ? "visible" : "hidden" }}>
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- People tab -----------------------------------------------------------

const AVATAR_COLORS = ["#4C8B5C", "#4A7FB5", "#C05C4A", "#C79A3E", "#8D6CB0", "#4CA0AE"];

function PeopleTab({ members, setMembers, tx, isAdmin, permissions, setPermissions, credentials, setCredentials }) {
  const [form, setForm] = useState({ name: "", contribution: "" });
  const [loginDrafts, setLoginDrafts] = useState({});

  const addMember = () => {
    if (!form.name.trim()) return;
    setMembers([...members, { id: uid(), name: form.name.trim(), contribution: Number(form.contribution) || 0 }]);
    setForm({ name: "", contribution: "" });
  };
  const removeMember = (id) => setMembers(members.filter(m => m.id !== id));
  const updateTarget = (id, value) => setMembers(members.map(m => m.id === id ? { ...m, contribution: Number(value) || 0 } : m));
  const togglePerm = (memberId, key) => {
    const current = getPerms(permissions, memberId);
    setPermissions({ ...permissions, [memberId]: { ...current, [key]: !current[key] } });
  };
  const draftFor = (id) => loginDrafts[id] || credentials.users?.[id] || { username: "", password: "" };
  const setDraft = (id, field, value) => setLoginDrafts({ ...loginDrafts, [id]: { ...draftFor(id), [field]: value } });
  const saveLogin = (id) => {
    const d = draftFor(id);
    if (!d.username?.trim() || !d.password) return;
    setCredentials({ ...credentials, users: { ...credentials.users, [id]: { username: d.username.trim(), password: d.password } } });
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
                  <button onClick={() => removeMember(m.id)} style={{ color: "#C6CBC0", padding: 3 }}>
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
                    <button onClick={() => saveLogin(m.id)} style={{ background: "#1F2A1D", color: "#fff", borderRadius: 7, padding: "0 10px", fontSize: 11.5, fontWeight: 600 }}>Save</button>
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
