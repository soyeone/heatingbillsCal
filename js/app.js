import * as db from './db.js';
import { getTemperatures, ymd } from './weather.js';
import {
  computeSeries, summarizeMonth, resolveRate, monthOf, daysInMonth, shiftMonth,
  addDays, parseCsv, correlation,
} from './calc.js';

const cfg = Object.assign(
  { LOCATION: { name: '수원시', latitude: 37.2636, longitude: 127.0286 }, UNIT: 'L' },
  window.APP_CONFIG || {}
);
const UNIT = cfg.UNIT;
const LOC = cfg.LOCATION;

const $ = (id) => document.getElementById(id);
const fmtWon = (n) => Math.round(n || 0).toLocaleString('ko-KR');
const fmtNum = (n, d = 1) =>
  n == null || Number.isNaN(n) ? '-' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtT = (t) => (t == null ? '-' : `${t.toFixed(1)}°`);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const todayStr = () => ymd(new Date());

const state = {
  store: null,
  demo: false,
  session: null,
  readings: [],
  rates: {},
  month: monthOf(todayStr()),
  temps: {},
  series: { rows: [], daily: {} },
  charts: {},
};

// =====================================================================
// 데모 저장소 (Supabase 설정 전 미리보기용, localStorage)
// =====================================================================
const DEMO_KEY = 'hb_demo_v1';
const demoStore = {
  _load() { try { return JSON.parse(localStorage.getItem(DEMO_KEY)); } catch { return null; } },
  _save(d) { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); },
  async ensure() {
    if (this._load()) return;
    const end = todayStr();
    const start = addDays(end, -75);
    let temps = {};
    try { temps = await getTemperatures(start, end, LOC); } catch { /* offline */ }
    let meter = 18250;
    const readings = [];
    let id = 1;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (Math.random() < 0.08 && d !== end) continue; // 가끔 검침 누락
      const t = temps[d];
      const avg = t ? (t.max + t.min) / 2 : 8;
      const use = Math.max(2, (18 - avg) * 9 + (Math.random() - 0.5) * 30);
      meter += use;
      readings.push({ id: id++, reading_date: d, meter_value: Math.round(meter * 10) / 10, memo: null });
    }
    const m0 = monthOf(end);
    const rates = {
      [shiftMonth(m0, -2)]: { unit_price: 98.5, base_fee: 0 },
      [shiftMonth(m0, -1)]: { unit_price: 101.2, base_fee: 0 },
      [m0]: { unit_price: 104.8, base_fee: 0 },
    };
    this._save({ readings, rates, nextId: id });
  },
  async listReadings() { await this.ensure(); return this._load().readings; },
  async listRates() { await this.ensure(); return this._load().rates; },
  async upsertReading(r) {
    const d = this._load();
    const ex = d.readings.find((x) => x.reading_date === r.reading_date);
    if (ex) Object.assign(ex, r); else d.readings.push({ id: d.nextId++, ...r });
    this._save(d);
  },
  async upsertReadingsBulk(rows) { for (const r of rows) await this.upsertReading(r); },
  async deleteReading(id) {
    const d = this._load();
    d.readings = d.readings.filter((x) => x.id !== id);
    this._save(d);
  },
  async upsertRate(month, unit_price, base_fee) {
    const d = this._load();
    d.rates[month] = { unit_price, base_fee };
    this._save(d);
  },
};

const dbStore = {
  listReadings: db.listReadings,
  listRates: db.listRates,
  upsertReading: db.upsertReading,
  upsertReadingsBulk: db.upsertReadingsBulk,
  deleteReading: db.deleteReading,
  upsertRate: db.upsertRate,
};

// =====================================================================
// UI 유틸
// =====================================================================
let toastTimer;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
function show(id) {
  ['setup-screen', 'auth-screen', 'app'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
}
async function withBusy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { console.error(e); toast(e.message || '오류가 발생했습니다', true); }
  finally { btn.disabled = false; }
}
function deltaHtml(cur, prev, unit, digits = 0) {
  if (!prev) return '<span class="muted">전월 데이터 없음</span>';
  const diff = cur - prev;
  const pct = (diff / prev) * 100;
  const cls = diff > 0 ? 'up' : 'down';
  const arrow = diff > 0 ? '▲' : '▼';
  const val = digits ? fmtNum(Math.abs(diff), digits) : fmtWon(Math.abs(diff));
  return `<span class="${cls}">${arrow} ${val}${unit} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)</span> 전월 동기간 대비`;
}

// =====================================================================
// 데이터 로딩 & 렌더링
// =====================================================================
async function loadData() {
  const [readings, rates] = await Promise.all([state.store.listReadings(), state.store.listRates()]);
  state.readings = readings;
  state.rates = rates;
  state.series = computeSeries(readings, rates);
  await render();
}

async function render() {
  const month = state.month;
  const [y, m] = month.split('-');
  $('month-label').textContent = `${y}년 ${Number(m)}월`;
  $('btn-next-month').disabled = month >= monthOf(todayStr());

  // 기온: 선택 월 포함 최근 3개월
  const start = `${shiftMonth(month, -2)}-01`;
  const end = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  try {
    const t = await getTemperatures(start, end, LOC);
    Object.assign(state.temps, t);
  } catch (e) {
    console.warn(e);
    toast('기온 데이터를 불러오지 못했습니다', true);
  }

  renderKpis();
  renderRateForm();
  renderDailyChart();
  renderMonthlyChart();
  renderScatter();
  renderTable();
  renderLastReading();
  updatePreview();
}

function sameDayCut(month, day) {
  // 전월 비교: 같은 일수까지만 합산 (진행 중인 달 공정 비교)
  const daily = state.series.daily;
  let usage = 0, cost = 0;
  const dim = daysInMonth(month);
  for (let d = 1; d <= Math.min(day, dim); d++) {
    const v = daily[`${month}-${String(d).padStart(2, '0')}`];
    if (v) { usage += v.usage; cost += v.cost; }
  }
  return { usage, cost };
}

function renderKpis() {
  const month = state.month;
  const s = summarizeMonth(state.series.daily, state.rates, month, todayStr());
  const prevMonth = shiftMonth(month, -1);

  // 이번 달 마지막 데이터 일자 기준으로 전월 동기간 비교
  let lastDay = 0;
  for (let d = 1; d <= s.dim; d++) if (state.series.daily[`${month}-${String(d).padStart(2, '0')}`]) lastDay = d;
  const prev = sameDayCut(prevMonth, lastDay || s.dim);

  $('kpi-unit').textContent = UNIT;
  $('kpi-avg-unit').textContent = `${UNIT}/일`;
  $('kpi-usage').textContent = fmtNum(s.usage, 1);
  $('kpi-usage-delta').innerHTML = s.days ? deltaHtml(s.usage, prev.usage, UNIT, 1) : '기록 없음';
  $('kpi-cost').textContent = fmtWon(s.costWithBase);
  $('kpi-cost-delta').innerHTML = s.days ? deltaHtml(s.cost, prev.cost, '원') : '';
  $('kpi-projected').textContent = s.days ? fmtWon(s.projectedCost) : '-';
  $('kpi-projected-sub').textContent = s.days
    ? `${s.days}/${s.dim}일 기록 · 예상 ${fmtNum(s.projectedUsage, 0)}${UNIT}${s.rate.estimated ? ' · 단가 추정' : ''}`
    : '';
  $('kpi-avg').textContent = fmtNum(s.avg, 1);

  // 평균기온
  const temps = [];
  for (let d = 1; d <= s.dim; d++) {
    const t = state.temps[`${month}-${String(d).padStart(2, '0')}`];
    if (t) temps.push(t);
  }
  if (temps.length) {
    const avgMax = temps.reduce((a, t) => a + t.max, 0) / temps.length;
    const avgMin = temps.reduce((a, t) => a + t.min, 0) / temps.length;
    $('kpi-temp').innerHTML = `${LOC.name} 평균 <span class="up">${avgMax.toFixed(1)}°</span> / <span style="color:var(--cool)">${avgMin.toFixed(1)}°</span>`;
  } else {
    $('kpi-temp').textContent = '';
  }
}

function renderRateForm() {
  const r = resolveRate(state.rates, state.month);
  const [, m] = state.month.split('-');
  $('rate-unit-label').textContent = `1${UNIT}당 단가 (원)`;
  $('rate-price').value = r.source ? r.unit_price : '';
  $('rate-base').value = r.source ? r.base_fee || 0 : 0;
  const badge = $('rate-status');
  if (!r.estimated) { badge.textContent = `${Number(m)}월 입력됨`; badge.className = 'badge ok'; }
  else if (r.source) { badge.textContent = `${r.source} 단가 적용 중`; badge.className = 'badge warn'; }
  else { badge.textContent = '미입력'; badge.className = 'badge warn'; }
  document.querySelector('#rate-form').closest('.card').querySelector('h2').textContent = `${Number(m)}월 단가`;
}

function renderLastReading() {
  const last = state.readings[state.readings.length - 1];
  $('last-reading').textContent = last ? `최근 ${last.reading_date.slice(5)} · ${fmtNum(last.meter_value, 3)}` : '';
}

// ---------- Charts ----------
const C = {
  flame: 'hsl(25, 100%, 60%)',
  flameSoft: 'hsla(25, 100%, 60%, 0.35)',
  hot: 'hsl(38, 100%, 62%)',
  cool: 'hsl(200, 90%, 64%)',
  pink: 'hsl(345, 85%, 62%)',
  grid: 'rgba(255,255,255,0.06)',
  tick: '#a99db4',
};
function baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: {
      legend: { labels: { color: C.tick, boxWidth: 12, usePointStyle: true, font: { family: 'Pretendard Variable' } } },
      tooltip: {
        backgroundColor: 'rgba(24,18,30,0.95)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
        padding: 10, titleFont: { family: 'Pretendard Variable' }, bodyFont: { family: 'Pretendard Variable' },
      },
    },
    scales: {},
  };
}
function axis(extra = {}) {
  return { grid: { color: C.grid }, ticks: { color: C.tick, font: { family: 'Outfit' } }, border: { display: false }, ...extra };
}
function upsertChart(key, canvasId, config) {
  if (!window.Chart) return;
  if (state.charts[key]) {
    const ch = state.charts[key];
    ch.data = config.data;
    ch.options = config.options;
    ch.update();
    return;
  }
  state.charts[key] = new window.Chart($(canvasId), config);
}

function gradient(ctx, area, from, to) {
  const g = ctx.createLinearGradient(0, area.bottom, 0, area.top);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  return g;
}

function renderDailyChart() {
  const month = state.month;
  const dim = daysInMonth(month);
  const labels = [], usage = [], hi = [], lo = [], est = [], cost = [];
  for (let d = 1; d <= dim; d++) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    labels.push(`${d}일`);
    const v = state.series.daily[key];
    usage.push(v ? +v.usage.toFixed(2) : null);
    cost.push(v ? v.cost : null);
    est.push(v?.estimated || false);
    const t = state.temps[key];
    hi.push(t ? t.max : null);
    lo.push(t ? t.min : null);
  }
  const opts = baseOptions();
  opts.scales = {
    x: axis({ grid: { display: false }, ticks: { color: C.tick, maxRotation: 0, autoSkipPadding: 8, font: { family: 'Outfit' } } }),
    y: axis({ beginAtZero: true, title: { display: true, text: `사용량 (${UNIT})`, color: C.tick } }),
    y1: axis({ position: 'right', grid: { display: false }, title: { display: true, text: '기온 (°C)', color: C.tick } }),
  };
  opts.plugins.tooltip.callbacks = {
    label(ctx) {
      if (ctx.dataset.yAxisID === 'y1') return ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}°C`;
      if (ctx.parsed.y == null) return null;
      const i = ctx.dataIndex;
      return ` 사용량: ${fmtNum(ctx.parsed.y, 2)}${UNIT} · ${fmtWon(cost[i])}원${est[i] ? ' (배분 추정)' : ''}`;
    },
  };
  upsertChart('daily', 'chart-daily', {
    data: {
      labels,
      datasets: [
        {
          type: 'line', label: '최고기온', data: hi, yAxisID: 'y1', borderColor: C.hot, backgroundColor: C.hot,
          tension: 0.35, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2, spanGaps: true, order: 0,
        },
        {
          type: 'line', label: '최저기온', data: lo, yAxisID: 'y1', borderColor: C.cool, backgroundColor: C.cool,
          tension: 0.35, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2, spanGaps: true, borderDash: [4, 3], order: 0,
        },
        {
          type: 'bar', label: `사용량 (${UNIT})`, data: usage, yAxisID: 'y', order: 1, borderRadius: 6, maxBarThickness: 22,
          backgroundColor(ctx) {
            const { chart } = ctx;
            if (!chart.chartArea) return C.flameSoft;
            if (est[ctx.dataIndex]) return 'rgba(255,140,80,0.28)';
            return gradient(chart.ctx, chart.chartArea, 'hsla(345, 85%, 62%, 0.85)', 'hsla(38, 100%, 62%, 0.95)');
          },
        },
      ],
    },
    options: opts,
  });
}

function renderMonthlyChart() {
  const labels = [], costs = [], usages = [], colors = [];
  for (let i = 11; i >= 0; i--) {
    const mm = shiftMonth(state.month, -i);
    const s = summarizeMonth(state.series.daily, state.rates, mm, todayStr());
    labels.push(`${mm.slice(2, 4)}.${mm.slice(5)}`);
    costs.push(Math.round(s.costWithBase));
    usages.push(+s.usage.toFixed(1));
    colors.push(i === 0 ? C.flame : 'rgba(255,255,255,0.14)');
  }
  const opts = baseOptions();
  opts.scales = {
    x: axis({ grid: { display: false } }),
    y: axis({ beginAtZero: true, ticks: { color: C.tick, font: { family: 'Outfit' }, callback: (v) => `${(v / 10000).toFixed(v % 10000 ? 1 : 0)}만` } }),
    y1: axis({ position: 'right', beginAtZero: true, grid: { display: false } }),
  };
  opts.plugins.tooltip.callbacks = {
    label: (ctx) => (ctx.dataset.yAxisID === 'y1'
      ? ` 사용량: ${fmtNum(ctx.parsed.y, 1)}${UNIT}`
      : ` 난방비: ${fmtWon(ctx.parsed.y)}원`),
  };
  upsertChart('monthly', 'chart-monthly', {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: '난방비 (원)', data: costs, backgroundColor: colors, borderRadius: 8, maxBarThickness: 34, yAxisID: 'y', order: 1 },
        { type: 'line', label: `사용량 (${UNIT})`, data: usages, borderColor: C.pink, backgroundColor: C.pink, tension: 0.35, pointRadius: 3, yAxisID: 'y1', order: 0 },
      ],
    },
    options: opts,
  });
}

function renderScatter() {
  const pts = [];
  const start = `${shiftMonth(state.month, -2)}-01`;
  const end = `${state.month}-${String(daysInMonth(state.month)).padStart(2, '0')}`;
  for (const [d, v] of Object.entries(state.series.daily)) {
    if (d < start || d > end || v.estimated || v.usage < 0) continue;
    const t = state.temps[d];
    if (!t) continue;
    pts.push({ x: +((t.max + t.min) / 2).toFixed(1), y: +v.usage.toFixed(2), d });
  }
  const r = correlation(pts.map((p) => p.x), pts.map((p) => p.y));
  const badge = $('corr-badge');
  if (r == null) { badge.textContent = '데이터 부족'; badge.className = 'badge'; }
  else {
    const strength = Math.abs(r) >= 0.7 ? '강한' : Math.abs(r) >= 0.4 ? '중간' : '약한';
    badge.textContent = `최근 3개월 · 상관계수 ${r.toFixed(2)} (${strength} ${r < 0 ? '음' : '양'}의 상관)`;
    badge.className = Math.abs(r) >= 0.4 ? 'badge ok' : 'badge';
  }

  // 회귀선
  const datasets = [{
    type: 'scatter', label: '일별', data: pts, backgroundColor: 'hsla(25, 100%, 60%, 0.7)',
    borderColor: 'hsl(25, 100%, 60%)', pointRadius: 5, pointHoverRadius: 7,
  }];
  if (pts.length >= 3) {
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    const sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
    if (sxx) {
      const b = sxy / sxx, a = my - b * mx;
      const xs = pts.map((p) => p.x);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      datasets.push({
        type: 'line', label: `추세 (1°C당 ${fmtNum(b, 1)}${UNIT})`, data: [{ x: x0, y: a + b * x0 }, { x: x1, y: a + b * x1 }],
        borderColor: C.cool, borderDash: [6, 4], pointRadius: 0, borderWidth: 2,
      });
    }
  }
  const opts = baseOptions();
  opts.interaction = { mode: 'nearest', intersect: true };
  opts.scales = {
    x: axis({ type: 'linear', title: { display: true, text: '일 평균기온 (°C)', color: C.tick } }),
    y: axis({ beginAtZero: true, title: { display: true, text: `사용량 (${UNIT})`, color: C.tick } }),
  };
  opts.plugins.tooltip.callbacks = {
    label: (ctx) => (ctx.raw.d ? ` ${ctx.raw.d}: ${ctx.raw.x}°C · ${fmtNum(ctx.raw.y, 2)}${UNIT}` : ` ${ctx.dataset.label}`),
  };
  upsertChart('scatter', 'chart-scatter', { data: { datasets }, options: opts });
}

// ---------- Table ----------
function renderTable() {
  const body = $('records-body');
  const rows = state.series.rows.filter((r) => monthOf(r.reading_date) === state.month).reverse();
  $('records-empty').classList.toggle('hidden', rows.length > 0);
  body.innerHTML = rows.map((r) => {
    const dt = new Date(r.reading_date + 'T00:00:00');
    const dow = dt.getDay();
    const t = state.temps[r.reading_date];
    const usage = r.usage == null ? '-'
      : `<span class="${r.anomaly ? 'anomaly' : ''}">${fmtNum(r.usage, 2)}</span>${r.gapDays > 1 ? `<span class="gap">(${r.gapDays}일)</span>` : ''}`;
    return `<tr>
      <td>${r.reading_date.slice(5).replace('-', '.')}<span class="dow ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}">${DOW[dow]}</span></td>
      <td>${fmtNum(r.meter_value, 3)}</td>
      <td>${usage}</td>
      <td>${r.cost == null ? '-' : fmtWon(r.cost)}</td>
      <td class="t-hi">${fmtT(t?.max)}</td>
      <td class="t-lo">${fmtT(t?.min)}</td>
      <td title="${escapeHtml(r.memo || '')}">${escapeHtml(r.memo || '')}</td>
      <td><span class="row-actions">
        <button data-act="edit" data-id="${r.id}" aria-label="수정" title="수정">✎</button>
        <button data-act="del" data-id="${r.id}" aria-label="삭제" title="삭제">🗑</button>
      </span></td>
    </tr>`;
  }).join('');
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Preview ----------
function updatePreview() {
  const date = $('reading-date').value;
  const val = parseFloat($('reading-value').value);
  const el = $('reading-preview');
  if (!date || Number.isNaN(val)) { el.textContent = ''; return; }
  const prev = [...state.readings].filter((r) => r.reading_date < date).pop();
  if (!prev) { el.textContent = '첫 검침값입니다. 다음 검침부터 사용량이 계산됩니다.'; return; }
  const usage = val - prev.meter_value;
  const gap = Math.round((new Date(date) - new Date(prev.reading_date)) / 86400000);
  const price = resolveRate(state.rates, monthOf(date)).unit_price;
  if (usage < 0) { el.innerHTML = `<span class="up">⚠ 직전 검침(${prev.reading_date.slice(5)}: ${fmtNum(prev.meter_value, 3)})보다 작습니다.</span>`; return; }
  el.innerHTML = `${prev.reading_date.slice(5)} 대비${gap > 1 ? ` (${gap}일간)` : ''} <b>+${fmtNum(usage, 2)}${UNIT}</b> · 약 <b>${fmtWon(usage * price)}원</b>`;
}

// =====================================================================
// 이벤트
// =====================================================================
function bindEvents() {
  $('btn-prev-month').onclick = () => { state.month = shiftMonth(state.month, -1); render(); };
  $('btn-next-month').onclick = () => { state.month = shiftMonth(state.month, 1); render(); };
  $('btn-this-month').onclick = () => { state.month = monthOf(todayStr()); render(); };

  $('reading-value').addEventListener('input', updatePreview);
  $('reading-date').addEventListener('change', updatePreview);

  $('reading-form').addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy($('btn-save-reading'), async () => {
      const reading_date = $('reading-date').value;
      const meter_value = parseFloat($('reading-value').value);
      const memo = $('reading-memo').value.trim();
      const prev = [...state.readings].filter((r) => r.reading_date < reading_date).pop();
      if (prev && meter_value < prev.meter_value &&
        !confirm(`직전 검침값(${prev.meter_value})보다 작습니다. 그래도 저장할까요?`)) return;
      await state.store.upsertReading({ reading_date, meter_value, memo });
      toast(`${reading_date} 검침값을 저장했습니다`);
      $('reading-value').value = '';
      $('reading-memo').value = '';
      $('reading-date').value = addDays(reading_date, 1) <= todayStr() ? addDays(reading_date, 1) : reading_date;
      state.month = monthOf(reading_date);
      await loadData();
    });
  });

  $('rate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy($('btn-save-rate'), async () => {
      const price = parseFloat($('rate-price').value);
      const base = parseFloat($('rate-base').value) || 0;
      await state.store.upsertRate(state.month, price, base);
      toast(`${state.month} 단가를 저장했습니다`);
      await loadData();
    });
  });

  $('records-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const r = state.readings.find((x) => x.id === id);
    if (!r) return;
    if (btn.dataset.act === 'edit') {
      $('reading-date').value = r.reading_date;
      $('reading-value').value = r.meter_value;
      $('reading-memo').value = r.memo || '';
      updatePreview();
      $('reading-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('reading-value').focus();
    } else if (btn.dataset.act === 'del') {
      if (!confirm(`${r.reading_date} 검침 기록을 삭제할까요?`)) return;
      try {
        await state.store.deleteReading(id);
        toast('삭제했습니다');
        await loadData();
      } catch (err) { toast(err.message, true); }
    }
  });

  $('btn-export').onclick = () => {
    const lines = ['날짜,계량기값,사용량,난방비(원),최고기온,최저기온,메모'];
    state.series.rows.forEach((r) => {
      const t = state.temps[r.reading_date];
      lines.push([
        r.reading_date, r.meter_value, r.usage == null ? '' : r.usage.toFixed(3),
        r.cost == null ? '' : Math.round(r.cost), t?.max ?? '', t?.min ?? '',
        `"${(r.memo || '').replace(/"/g, '""')}"`,
      ].join(','));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `난방비_검침기록_${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $('csv-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const { rows, rawCount, errors } = parseCsv(await file.text());
    if (!rows.length) { toast('가져올 수 있는 행이 없습니다. 형식: 날짜,계량기값[,메모]', true); return; }
    let msg = '';
    if (rawCount && rawCount > rows.length) {
      msg = `총 ${rawCount}개 기록 중 하루 여러 번 측정한 날은 당일 최종 검침값(${rows.length}일치)으로 정리하여 가져옵니다.\n(이전 측정값은 메모에 자동 기록됩니다.)\n\n진행할까요?`;
    } else {
      msg = `${rows.length}건을 가져옵니다${errors.length ? ` (인식 실패 ${errors.length}행 제외)` : ''}.\n같은 날짜의 기존 기록은 덮어씁니다. 진행할까요?`;
    }
    if (!confirm(msg)) return;
    try {
      await state.store.upsertReadingsBulk(rows);
      toast(`${rows.length}일치 데이터를 가져왔습니다`);
      const latestDate = rows.map((r) => r.reading_date).sort().pop();
      if (latestDate) state.month = monthOf(latestDate);
      await loadData();
    } catch (err) { toast(err.message, true); }
  });

  // 인증
  $('auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy($('btn-login'), async () => {
      $('auth-msg').textContent = '';
      try { await db.signIn($('auth-email').value, $('auth-password').value); }
      catch (err) { $('auth-msg').textContent = '로그인 실패: ' + err.message; }
    });
  });
  $('btn-signup').onclick = () => withBusy($('btn-signup'), async () => {
    const email = $('auth-email').value, pw = $('auth-password').value;
    if (!email || pw.length < 6) { $('auth-msg').textContent = '이메일과 6자 이상 비밀번호를 입력하세요.'; return; }
    try {
      const res = await db.signUp(email, pw);
      $('auth-msg').textContent = res.session ? '' : '가입 완료! 이메일 인증 후 로그인해 주세요.';
    } catch (err) { $('auth-msg').textContent = '가입 실패: ' + err.message; }
  });
  $('btn-logout').onclick = async () => {
    if (state.demo) { localStorage.removeItem(DEMO_KEY); location.reload(); return; }
    await db.signOut();
  };
  const demoBtn = $('btn-demo');
  if (demoBtn) demoBtn.onclick = () => enterApp(null, true);
}

async function enterApp(session, demo = false) {
  state.session = session;
  state.demo = demo;
  state.store = demo ? demoStore : dbStore;
  $('user-email').textContent = demo ? '데모 모드' : session?.user?.email || '';
  $('btn-logout').textContent = demo ? '데모 초기화' : '로그아웃';
  $('reading-date').value = todayStr();
  $('reading-date').max = todayStr();
  show('app');
  try { await loadData(); } catch (e) { console.error(e); toast('데이터 로딩 실패: ' + e.message, true); }
}

// =====================================================================
// 시작
// =====================================================================
async function init() {
  bindEvents();
  if (!db.isConfigured) { show('setup-screen'); return; }
  db.onAuthChange((session) => {
    if (session && !state.session) enterApp(session);
    else if (!session && !state.demo) { state.session = null; show('auth-screen'); }
  });
  const session = await db.getSession();
  if (!session) show('auth-screen');
}

init();
