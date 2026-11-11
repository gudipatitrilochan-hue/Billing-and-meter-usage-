// Chart.js helpers that read colours from theme tokens and redraw on theme change.
import { token } from "./theme.js";
import { reduced } from "./motion.js";

const Chart = window.Chart;
const charts = new Set();

window.addEventListener("ml:themechange", () => {
  for (const c of charts) { if (c._ml) { c._ml.rebuild(); } }
});

function rgba(triplet, a) { return `rgba(${triplet}, ${a})`; }

function baseOptions({ onPanel = false, money = null } = {}) {
  const ink2 = onPanel ? token("--panel-ink-2") : token("--ink-2");
  const grid = onPanel ? "rgba(255,255,255,.06)" : token("--line");
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduced ? false : { duration: 900, easing: "easeOutQuart" },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: token("--panel"), titleColor: token("--panel-ink"), bodyColor: token("--panel-ink"),
        borderColor: "rgba(255,255,255,.1)", borderWidth: 1, padding: 10, cornerRadius: 10, displayColors: false,
        titleFont: { family: "Inter", weight: "600" }, bodyFont: { family: "Inter" },
        callbacks: money ? { label: (ctx) => money(ctx.parsed.y) } : {},
      },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: ink2, font: { family: "Inter", size: 11 }, maxRotation: 0, autoSkipPadding: 14 } },
      y: { grid: { color: grid }, border: { display: false }, beginAtZero: true, ticks: { color: ink2, font: { family: "Inter", size: 11 }, maxTicksLimit: 5, callback: (v) => compact(v) } },
    },
  };
}

export function compact(v) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

/** Smooth gradient area chart (overview hero, on the dark panel). */
export function areaChart(canvas, labels, data, { onPanel = true, label = "" } = {}) {
  let chart;
  const build = () => {
    if (chart) chart.destroy();
    const glow = token("--glow");
    const ctx = canvas.getContext("2d");
    const h = canvas.parentElement.clientHeight || 180;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgba(glow, 0.45));
    grad.addColorStop(1, rgba(glow, 0));
    chart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets: [{ label, data, fill: true, backgroundColor: grad, borderColor: token("--accent"), borderWidth: 2, tension: 0.38, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: token("--accent"), pointHoverBorderColor: "#fff", pointHoverBorderWidth: 2 }] },
      options: baseOptions({ onPanel }),
    });
    chart._ml = { rebuild: build };
    charts.add(chart);
    return chart;
  };
  build();
  return { get chart() { return chart; }, update(l, d) { chart.data.labels = l; chart.data.datasets[0].data = d; chart.update(); }, destroy() { charts.delete(chart); chart.destroy(); } };
}

/** Daily usage bars, today highlighted with the accent. */
export function barChart(canvas, labels, data, { highlight = -1, limitLine = null } = {}) {
  let chart;
  const build = () => {
    if (chart) chart.destroy();
    const ink = token("--ink");
    const accent = token("--accent");
    const muted = token("--surface-3");
    chart = new Chart(canvas, {
      type: "bar",
      data: { labels, datasets: [{ data, backgroundColor: data.map((v, i) => (i === highlight ? accent : v ? ink : muted)), borderRadius: 6, borderSkipped: false, maxBarThickness: 22, hoverBackgroundColor: accent }] },
      options: baseOptions(),
    });
    chart._ml = { rebuild: build };
    charts.add(chart);
  };
  build();
  return {
    update(l, d, hi = -1) { labels = l; data = d; highlight = hi; build(); },
    destroy() { charts.delete(chart); chart.destroy(); },
  };
}
