// 수원시 일 최고/최저 기온 조회 (Open-Meteo, API 키 불필요, CORS 허용)
// - 최근 데이터: forecast API (과거 ~92일까지 + 오늘)
// - 오래된 데이터: archive API (ERA5 재분석, 약 5일 지연)

const CACHE_KEY = 'hb_weather_cache_v1';
const RECENT_DAYS = 80;

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}
function saveCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* quota */ }
}

export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
}

async function fetchRange(base, lat, lon, start, end) {
  const url = new URL(base);
  url.search = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'Asia/Seoul',
    start_date: start,
    end_date: end,
  }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`기온 API 오류 (${res.status})`);
  const json = await res.json();
  const out = {};
  const t = json.daily?.time || [];
  t.forEach((date, i) => {
    const max = json.daily.temperature_2m_max[i];
    const min = json.daily.temperature_2m_min[i];
    if (max != null && min != null) out[date] = { max, min };
  });
  return out;
}

/**
 * start~end(YYYY-MM-DD) 범위의 { [date]: {max, min} } 반환.
 */
export async function getTemperatures(start, end, { latitude, longitude }) {
  const today = ymd(new Date());
  if (end > today) end = today;
  if (start > end) return {};

  const cache = loadCache();
  const locKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const store = cache[locKey] || (cache[locKey] = {});

  // 확정된(3일 이전) 날짜는 캐시를 신뢰, 최근 3일은 항상 새로 조회
  const freshFrom = addDays(today, -3);
  const missing = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!store[d] || d >= freshFrom) missing.push(d);
  }

  if (missing.length) {
    const cutoff = addDays(today, -RECENT_DAYS);
    const mStart = missing[0];
    const mEnd = missing[missing.length - 1];
    const jobs = [];
    if (mStart < cutoff) {
      const archEnd = mEnd < cutoff ? mEnd : addDays(cutoff, -1);
      jobs.push(fetchRange('https://archive-api.open-meteo.com/v1/archive', latitude, longitude, mStart, archEnd));
    }
    if (mEnd >= cutoff) {
      const recStart = mStart > cutoff ? mStart : cutoff;
      jobs.push(fetchRange('https://api.open-meteo.com/v1/forecast', latitude, longitude, recStart, mEnd));
    }
    const results = await Promise.all(jobs);
    results.forEach((r) => Object.assign(store, r));
    saveCache(cache);
  }

  const out = {};
  for (let d = start; d <= end; d = addDays(d, 1)) if (store[d]) out[d] = store[d];
  return out;
}

/** 오늘 + 앞으로 6일 예보 */
export async function getForecast({ latitude, longitude }) {
  const today = ymd(new Date());
  return fetchRange('https://api.open-meteo.com/v1/forecast', latitude, longitude, today, addDays(today, 6));
}
