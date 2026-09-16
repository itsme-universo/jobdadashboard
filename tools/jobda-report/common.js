// 공통 유틸 (두 페이지 공용)
const themeParam = new URLSearchParams(location.search).get('theme');
if (themeParam === 'dark' || themeParam === 'light') {
  document.documentElement.dataset.theme = themeParam;
}

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('ko-KR');
let charts = [];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function baseOptions() {
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.font.size = 12;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        labels: { color: cssVar('--ink-2'), boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle' },
      },
      tooltip: { padding: 10, boxPadding: 4 },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: cssVar('--baseline') },
        ticks: { color: cssVar('--muted') },
      },
      y: {
        beginAtZero: true,
        grid: { color: cssVar('--grid'), drawTicks: false },
        border: { display: false },
        ticks: { color: cssVar('--muted'), font: { size: 11 }, callback: (v) => fmt.format(v) },
      },
    },
  };
}

function lineDs(label, data, color) {
  return {
    label, data,
    borderColor: color, backgroundColor: color,
    borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointHitRadius: 12,
    pointBackgroundColor: color, pointBorderColor: cssVar('--surface'), pointBorderWidth: 2,
    tension: 0.15,
  };
}

function makeChart(id, config) {
  const c = new Chart($(id), config);
  charts.push(c);
  return c;
}

function destroyCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

function table(elId, headers, rows) {
  const th = headers.map((h) => `<th>${h}</th>`).join('');
  const trs = rows.map((r) => `<tr>${r.map((c, i) => `<td>${i === 0 ? c : fmt.format(c ?? 0)}</td>`).join('')}</tr>`).join('');
  $(elId).innerHTML = `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

// 가로 바 차트 (단일 시리즈, slot 1)
function hbar(id, tblId, rows, labelKey, valueKey, header) {
  const opt = baseOptions();
  opt.indexAxis = 'y';
  opt.interaction = { mode: 'nearest', intersect: false };
  opt.plugins.legend = { display: false };
  opt.scales = {
    x: { beginAtZero: true, grid: { color: cssVar('--grid'), drawTicks: false }, border: { display: false },
         ticks: { color: cssVar('--muted'), font: { size: 11 }, callback: (v) => fmt.format(v) } },
    y: { grid: { display: false }, border: { color: cssVar('--baseline') },
         ticks: { color: cssVar('--ink-2'), autoSkip: false } },
  };
  makeChart(id, {
    type: 'bar',
    data: {
      labels: rows.map((r) => r[labelKey]),
      datasets: [{ data: rows.map((r) => r[valueKey]), backgroundColor: cssVar('--s1'),
                   borderRadius: 4, maxBarThickness: 18, borderColor: cssVar('--surface'), borderWidth: 1 }],
    },
    options: opt,
  });
  if (tblId) table(tblId, header, rows.map((r) => [r[labelKey], r[valueKey]]));
}

// HTML 퍼널 렌더링: stages = [{name, users, events?}]
function renderFunnel(elId, stages) {
  const max = Math.max(...stages.map((s) => s.users), 1);
  let html = '<div class="funnel">';
  stages.forEach((s, i) => {
    const w = Math.max((s.users / max) * 82, 0.5); // 오른쪽 숫자 공간 확보
    html += `<div class="stage">
      <div class="name">${s.name}</div>
      <div class="bar-area">
        <div class="bar" style="width:${w}%"></div>
        <div class="nums"><b>${fmt.format(s.users)}</b>명${s.events != null ? ` · ${fmt.format(s.events)}회` : ''}</div>
      </div>
    </div>`;
    if (i < stages.length - 1) {
      const next = stages[i + 1];
      const pct = s.users > 0 ? ((next.users / s.users) * 100).toFixed(1) : '–';
      html += `<div class="stage"><div></div><div class="conv">↓ 전환 <span class="pct">${pct}%</span></div></div>`;
    }
  });
  html += '</div>';
  $(elId).innerHTML = html;
}

const shortDay = (d) => d.slice(5).replace('-', '/');

function tile(label, value, prev, dateLabel, suffix, deltaLabel = '전일 대비') {
  let delta = '';
  if (prev != null && prev > 0 && value != null) {
    const pct = ((value - prev) / prev) * 100;
    const cls = pct >= 0 ? 'up' : 'down';
    const arrow = pct >= 0 ? '▲' : '▼';
    delta = `<span class="${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span> ${deltaLabel}`;
  }
  const shown = value == null ? '–' : (typeof value === 'string' ? value : fmt.format(value));
  return `<div class="tile">
    <div class="label">${label}${dateLabel ? ` <span style="color:var(--muted)">· ${dateLabel}</span>` : ''}</div>
    <div class="value">${shown}${suffix ? `<small> ${suffix}</small>` : ''}</div>
    <div class="delta">${delta}</div>
  </div>`;
}

function watchTheme(rerender) {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rerender);
}
