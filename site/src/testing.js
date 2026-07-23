// Client-side renderer for the testing page: loads testing-results.json
// (published by the NCC suite CI run) and fills the stat tiles, the
// signal-vs-noise chart and the coverage table. All translatable text is
// inserted with data-i18n attributes so applyI18n() keeps dynamic content
// localized across language switches.

import { applyI18n, dateLocale } from "./i18n.js";

const C_MATCH = "#8a5fe6";
const C_NEG = "#1fa85f";
const INK_MUT = "#8fa3b5";
const INK_SEC = "#b7c5d3";
const GRID = "#2a3644";

/** Escapes a string for safe interpolation into markup. */
function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Builds the grouped-bar SVG (weakest match vs strongest negative). */
function gapChartSvg(scenarios) {
  const rows = scenarios
    .filter((s) => s.quality)
    .sort((a, b) => b.quality.gap - a.quality.gap);
  const BAR = 10;
  const GAP2 = 2;
  const ROW_H = 34;
  const LABEL_W = 190;
  const CHART_W = 560;
  const PLOT_W = CHART_W - LABEL_W - 44;
  const TOP = 14;
  const H = TOP + ROW_H * rows.length + 24;
  const x = (v) => LABEL_W + v * PLOT_W;

  const parts = [
    `<svg viewBox="0 0 ${CHART_W} ${H}" role="img" width="100%" font-size="11" ` +
      `aria-label="Grouped bar chart: per scenario, the weakest real encounter score versus the strongest false candidate score.">`,
  ];
  for (const gv of [0, 0.25, 0.5, 0.75, 1]) {
    const gx = x(gv).toFixed(1);
    parts.push(`<line x1="${gx}" y1="${TOP - 4}" x2="${gx}" y2="${H - 18}" stroke="${GRID}" stroke-width="1" />`);
    parts.push(`<text x="${gx}" y="${H - 5}" fill="${INK_MUT}" text-anchor="middle">${gv}</text>`);
  }
  rows.forEach((s, i) => {
    const y0 = TOP + i * ROW_H;
    const label = esc(`${s.pokemonName} · ${s.label}`);
    parts.push(`<text x="${LABEL_W - 8}" y="${(y0 + BAR + GAP2 / 2 + 4).toFixed(1)}" fill="${INK_SEC}" text-anchor="end">${label}</text>`);
    const bars = [
      [s.quality.matchMin, C_MATCH],
      [s.quality.negMax, C_NEG],
    ];
    bars.forEach(([val, col], j) => {
      const by = y0 + j * (BAR + GAP2);
      const w = Math.max(val * PLOT_W, 2);
      const r = 4;
      parts.push(
        `<path d="M ${LABEL_W} ${by} h ${(w - r).toFixed(1)} a ${r} ${r} 0 0 1 ${r} ${r} v ${BAR - 2 * r} ` +
          `a ${r} ${r} 0 0 1 ${-r} ${r} h ${(-(w - r)).toFixed(1)} Z" fill="${col}" />`,
      );
    });
    const gx = (x(Math.max(s.quality.matchMin, s.quality.negMax)) + 6).toFixed(1);
    parts.push(`<text x="${gx}" y="${(y0 + BAR + GAP2 / 2 + 4).toFixed(1)}" fill="${INK_MUT}">+${s.quality.gap.toFixed(2)}</text>`);
  });
  parts.push("</svg>");
  return parts.join("");
}

/** Renders the coverage table body. */
function coverageRows(scenarios) {
  const badge = (s) => {
    if (!s.loopTestable) {
      return '<span class="hard-badge" data-i18n="testing.coverage.hard">Hard case</span>';
    }
    return s.scan?.pass
      ? '<span class="pass-badge" data-i18n="testing.coverage.pass">Pass</span>'
      : '<span class="fail-badge" data-i18n="testing.coverage.fail">Fail</span>';
  };
  return scenarios
    .map(
      (s) => `<tr>
        <th scope="row">${esc(s.pokemonName)} · ${esc(s.label)}</th>
        <td>${esc(s.game)}</td>
        <td>${esc(s.style)}</td>
        <td class="compare-col">${badge(s)}</td>
      </tr>`,
    )
    .join("\n");
}

/**
 * Loads the published suite results and renders stats, chart and coverage.
 * Shows the fallback note when the results file is unavailable.
 */
export async function initTestingResults() {
  const chart = document.getElementById("gap-chart");
  const coverage = document.getElementById("coverage-body");
  const runstamp = document.getElementById("results-runstamp");
  try {
    const res = await fetch("/Encounty/testing-results.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const report = await res.json();
    const scenarios = report.scenarios ?? [];
    const testable = scenarios.filter((s) => s.loopTestable);

    const date = new Date(report.generatedAt);
    runstamp.textContent = `${report.version} · ${Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(dateLocale())}`;

    const passed = testable.filter((s) => s.scan?.pass).length;
    const encExpected = testable.reduce((sum, s) => sum + s.expectedEncounters, 0);
    const encFound = testable.reduce((sum, s) => sum + (s.scan?.simulated ?? 0), 0);
    document.getElementById("stat-scenarios").textContent = `${passed}/${testable.length}`;
    document.getElementById("stat-encounters").textContent = `${encFound}/${encExpected}`;
    document.getElementById("stat-hard").textContent = String(scenarios.length - testable.length);
    document.getElementById("stat-games").textContent = String(new Set(scenarios.map((s) => s.game)).size);

    chart.innerHTML = gapChartSvg(scenarios);
    coverage.innerHTML = coverageRows(
      [...scenarios].sort((a, b) => a.style.localeCompare(b.style) || a.game.localeCompare(b.game) || a.templateId - b.templateId),
    );
    // Translate the freshly inserted data-i18n badges.
    applyI18n(coverage);
  } catch {
    const note = document.getElementById("results-error");
    if (note) note.hidden = false;
    if (chart) chart.textContent = "";
  }
}
