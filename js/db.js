// Supabase 데이터 접근 계층
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.APP_CONFIG || {};

// '.../rest/v1/' 처럼 경로가 붙어 있어도 프로젝트 주소(origin)만 사용
function normalizeUrl(u) {
  try { return new URL(String(u).trim()).origin; } catch { return ''; }
}
const SUPABASE_URL = normalizeUrl(cfg.SUPABASE_URL);
const SUPABASE_KEY = String(cfg.SUPABASE_ANON_KEY || '').trim();

export const isConfigured =
  !!SUPABASE_URL && !SUPABASE_URL.includes('YOUR-PROJECT') && !!SUPABASE_KEY && !SUPABASE_KEY.includes('YOUR-ANON-KEY');

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// ---------- Auth ----------
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_e, session) => cb(session));
}
export async function signIn(email, password) {
  return check(await supabase.auth.signInWithPassword({ email, password }));
}
export async function signUp(email, password) {
  return check(await supabase.auth.signUp({ email, password }));
}
export async function signOut() {
  await supabase.auth.signOut();
}

// ---------- Readings ----------
export async function listReadings() {
  const all = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const rows = check(
      await supabase
        .from('meter_readings')
        .select('id, reading_date, meter_value, memo')
        .order('reading_date', { ascending: true })
        .range(from, from + page - 1)
    );
    all.push(...rows);
    if (rows.length < page) break;
  }
  return all.map((r) => ({ ...r, meter_value: Number(r.meter_value) }));
}

export async function upsertReading({ reading_date, meter_value, memo }) {
  return check(
    await supabase
      .from('meter_readings')
      .upsert({ reading_date, meter_value, memo: memo || null }, { onConflict: 'user_id,reading_date' })
      .select()
  );
}

export async function upsertReadingsBulk(rows) {
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    check(
      await supabase
        .from('meter_readings')
        .upsert(rows.slice(i, i + chunk), { onConflict: 'user_id,reading_date' })
    );
  }
}

export async function deleteReading(id) {
  return check(await supabase.from('meter_readings').delete().eq('id', id));
}

// ---------- Rates ----------
export async function listRates() {
  const rows = check(
    await supabase.from('monthly_rates').select('month, unit_price, base_fee').order('month')
  );
  const map = {};
  rows.forEach((r) => (map[r.month] = { unit_price: Number(r.unit_price), base_fee: Number(r.base_fee) }));
  return map;
}

export async function upsertRate(month, unit_price, base_fee = 0) {
  return check(
    await supabase
      .from('monthly_rates')
      .upsert({ month, unit_price, base_fee }, { onConflict: 'user_id,month' })
  );
}
