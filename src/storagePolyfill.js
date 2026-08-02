import { supabase } from "./supabaseClient";

const LOCAL_PREFIX = "household_local:";

async function sharedGet(key) {
  const { data, error } = await supabase
    .from("household_data")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data ? { key, value: JSON.stringify(data.value), shared: true } : null;
}

async function sharedSet(key, value) {
  const parsed = JSON.parse(value);
  const { error } = await supabase
    .from("household_data")
    .upsert({ key, value: parsed, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
  return { key, value, shared: true };
}

async function sharedDelete(key) {
  const { error } = await supabase.from("household_data").delete().eq("key", key);
  if (error) throw error;
  return { key, deleted: true, shared: true };
}

async function sharedList(prefix) {
  let query = supabase.from("household_data").select("key");
  if (prefix) query = query.like("key", `${prefix}%`);
  const { data, error } = await query;
  if (error) throw error;
  return { keys: (data || []).map((d) => d.key), prefix, shared: true };
}

function localGet(key) {
  const raw = localStorage.getItem(LOCAL_PREFIX + key);
  return raw !== null ? { key, value: raw, shared: false } : null;
}
function localSet(key, value) {
  localStorage.setItem(LOCAL_PREFIX + key, value);
  return { key, value, shared: false };
}
function localDelete(key) {
  localStorage.removeItem(LOCAL_PREFIX + key);
  return { key, deleted: true, shared: false };
}
function localList(prefix) {
  const keys = Object.keys(localStorage)
    .filter((k) => k.startsWith(LOCAL_PREFIX))
    .map((k) => k.slice(LOCAL_PREFIX.length))
    .filter((k) => !prefix || k.startsWith(prefix));
  return { keys, prefix, shared: false };
}

// Polyfill the same window.storage API the app already calls, backed by
// Supabase for shared data and localStorage for per-device data.
window.storage = {
  async get(key, shared) {
    return shared ? sharedGet(key) : localGet(key);
  },
  async set(key, value, shared) {
    return shared ? sharedSet(key, value) : localSet(key, value);
  },
  async delete(key, shared) {
    return shared ? sharedDelete(key) : localDelete(key);
  },
  async list(prefix, shared) {
    return shared ? sharedList(prefix) : localList(prefix);
  },
};
