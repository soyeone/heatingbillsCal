// 사용량 / 요금 계산 로직 (순수 함수)

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function diffDays(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
export const monthOf = (dateStr) => dateStr.slice(0, 7);
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 해당 월의 단가. 입력이 없으면 가장 최근 이전 달 단가를 사용(추정 표시).
 * @returns {{unit_price:number, base_fee:number, estimated:boolean, source:string|null}}
 */
export function resolveRate(rates, month) {
  if (rates[month]) return { ...rates[month], estimated: false, source: month };
  const prev = Object.keys(rates).filter((m) => m < month).sort().pop();
  if (prev) return { unit_price: rates[prev].unit_price, base_fee: rates[prev].base_fee, estimated: true, source: prev };
  return { unit_price: 0, base_fee: 0, estimated: true, source: null };
}

/**
 * 검침 기록 → 검침행 + 일별(달력) 시계열
 * - 검침이 없었던 달은 0원으로 유지
 * - 검침이 있는 달은 직전 검침값과의 차이를 해당 월 1일부터 배분
 * - 같은 달 내 2일 이상 미검침 시 직전 검침 다음 날부터 균등 배분
 */
export function computeSeries(readings, rates) {
  const sorted = [...readings].sort((a, b) => (a.reading_date < b.reading_date ? -1 : 1));
  const rows = [];
  const daily = {}; // date -> { usage, cost, estimated }

  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    const row = { ...r, usage: null, gapDays: null, cost: null, anomaly: false };
    if (prev) {
      const usage = r.meter_value - prev.meter_value;
      row.usage = usage;
      row.anomaly = usage < 0;

      const prevMonth = monthOf(prev.reading_date);
      const curMonth = monthOf(r.reading_date);

      // 같은 달이면 직전 검침 다음날부터 배분,
      // 다른 달이면 해당 월의 1일부터 배분 (미검침 달은 0으로 유지)
      let startDay;
      if (prevMonth === curMonth) {
        startDay = addDays(prev.reading_date, 1);
      } else {
        startDay = `${curMonth}-01`;
      }

      const allocDays = Math.max(1, diffDays(startDay, r.reading_date) + 1);
      row.gapDays = diffDays(prev.reading_date, r.reading_date);

      let cost = 0;
      if (usage >= 0 && allocDays > 0) {
        const per = usage / allocDays;
        for (let k = 0; k < allocDays; k++) {
          const d = addDays(startDay, k);
          const price = resolveRate(rates, monthOf(d)).unit_price;
          daily[d] = { usage: per, cost: per * price, estimated: allocDays > 1 };
          cost += per * price;
        }
      }
      row.cost = cost;
    }
    rows.push(row);
  });
  return { rows, daily };
}

/** 월 요약 */
export function summarizeMonth(daily, rates, month, todayStr) {
  const dim = daysInMonth(month);
  let usage = 0, cost = 0, days = 0;
  for (let d = 1; d <= dim; d++) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    const v = daily[key];
    if (v) { usage += v.usage; cost += v.cost; days++; }
  }
  const rate = resolveRate(rates, month);
  const avg = days ? usage / days : 0;
  const isCurrent = todayStr && monthOf(todayStr) === month;
  const projectedUsage = days ? avg * dim : 0;
  const projectedCost = projectedUsage * rate.unit_price + (rate.base_fee || 0);
  return {
    month, usage, cost, days, dim, avg, rate,
    costWithBase: cost + (days ? rate.base_fee || 0 : 0),
    projectedUsage, projectedCost, isCurrent,
  };
}

/** CSV 파싱: "날짜(시간포함가능),계량기값[,메모]" */
export function parseCsv(text) {
  const byDate = new Map();
  const rawRows = [];
  const errors = [];

  text.split(/\r?\n/).forEach((line, idx) => {
    if (!line.trim()) return;
    const cols = line.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const m = cols[0].match(/^(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})(.*)$/);
    const val = Number((cols[1] || '').replace(/[^\d.\-]/g, ''));
    if (!m || cols[1] === undefined || cols[1] === '' || Number.isNaN(val)) {
      if (idx > 0) errors.push(idx + 1);
      return;
    }
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const timePart = (m[4] || '').replace(/^[일\s,]+/, '').trim();
    const memo = cols[2] ? cols[2] : (timePart || null);
    rawRows.push({ reading_date: date, meter_value: val, timePart, memo });
  });

  // 같은 날짜에 여러 번 검침한 경우:
  // 하루 최종 검침값을 기준값으로 삼고, 이전 검침값/시간을 메모에 보존합니다.
  for (const r of rawRows) {
    if (!byDate.has(r.reading_date)) {
      byDate.set(r.reading_date, { ...r, earlier: [] });
    } else {
      const existing = byDate.get(r.reading_date);
      existing.earlier.push({ meter_value: existing.meter_value, timePart: existing.timePart });
      existing.meter_value = r.meter_value;
      existing.timePart = r.timePart;
      if (r.memo) existing.memo = r.memo;
    }
  }

  const out = [];
  for (const [date, item] of byDate.entries()) {
    let finalMemo = item.memo || '';
    if (item.earlier.length > 0) {
      const earlierDesc = item.earlier
        .map((e) => (e.timePart ? `${e.timePart}: ${e.meter_value}` : `${e.meter_value}`))
        .join(', ');
      finalMemo = finalMemo
        ? `${finalMemo} (이전: ${earlierDesc})`
        : `이전: ${earlierDesc}`;
    }
    out.push({
      reading_date: date,
      meter_value: item.meter_value,
      memo: finalMemo || null,
    });
  }

  return { rows: out, rawCount: rawRows.length, errors };
}

/** 피어슨 상관계수 */
export function correlation(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
