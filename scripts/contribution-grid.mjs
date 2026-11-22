#!/usr/bin/env node
/**
 * Gera um SVG estatico do grid de contribuicoes do GitHub (sem a animacao da cobra),
 * com a paleta azul do perfil, total do ano, labels de mes/dia e legenda Less/More.
 *
 * Uso:
 *   node scripts/contribution-grid.mjs <saida.svg> --palette "#c0,#c1,#c2,#c3,#c4" [--dark]
 *
 * A paleta tem 5 cores: sem contribuicao -> nivel mais alto.
 * Requer env GH_LOGIN. Nao precisa de token: os dados vem da pagina publica de contribuicoes
 * (https://github.com/users/<login>/contributions), a mesma que o perfil mostra. Assim o total
 * inclui as contribuicoes em repositorios privados, quando o perfil esta configurado para exibi-las.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const LEVELS = ["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CELL = 16; // espacamento entre celulas (px)
const DOT = 12; // tamanho da celula (px)
const LEFT = 34; // margem para Mon/Wed/Fri
const TOP = 34; // margem para o total e os meses
const BOTTOM = 26; // margem para a legenda
const MIN_WEEKS_BETWEEN_LABELS = 3;

async function fetchCalendar(login) {
  const url = `https://github.com/users/${encodeURIComponent(login)}/contributions`;
  const res = await fetch(url, { headers: { "User-Agent": "contribution-grid-script" } });
  if (!res.ok) throw new Error(`${url} respondeu ${res.status}`);
  return parseCalendarHtml(await res.text());
}

// Converte o HTML da pagina publica no mesmo formato usado por renderSvg
export function parseCalendarHtml(html) {
  const days = [];
  for (const [tag] of html.matchAll(/<td\s[^>]*ContributionCalendar-day[^>]*>/g)) {
    const date = tag.match(/data-date="(\d{4}-\d{2}-\d{2})"/)?.[1];
    const level = tag.match(/data-level="(\d)"/)?.[1];
    if (date && level !== undefined) days.push({ date, level: Number(level) });
  }

  const total = html.match(/([\d,]+)\s+contributions?\s+in the last year/i)?.[1];
  if (days.length < 300 || !total) {
    throw new Error(`formato inesperado da pagina de contribuicoes (${days.length} dias, total=${total})`);
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  const DAY_MS = 24 * 60 * 60 * 1000;
  const first = new Date(`${days[0].date}T00:00:00Z`);
  const firstSunday = first.getTime() - first.getUTCDay() * DAY_MS;

  const weeks = [];
  for (const { date, level } of days) {
    const d = new Date(`${date}T00:00:00Z`);
    const w = Math.round((d.getTime() - d.getUTCDay() * DAY_MS - firstSunday) / (7 * DAY_MS));
    (weeks[w] ??= { contributionDays: [] }).contributionDays.push({
      date,
      weekday: d.getUTCDay(),
      contributionLevel: LEVELS[level] ?? "NONE",
    });
  }

  return { totalContributions: Number(total.replace(/,/g, "")), weeks: weeks.filter(Boolean) };
}

export function buildMonthLabels(weeks) {
  const labels = [];
  let lastMonth = null;
  let lastLabelWeek = -Infinity;
  weeks.forEach((week, weekIndex) => {
    const firstDay = week.contributionDays[0];
    if (!firstDay) return;
    const month = new Date(firstDay.date).getUTCMonth();
    if (month !== lastMonth && weekIndex - lastLabelWeek >= MIN_WEEKS_BETWEEN_LABELS) {
      labels.push({ x: weekIndex * CELL, text: MONTH_ABBR[month] });
      lastLabelWeek = weekIndex;
    }
    lastMonth = month;
  });
  return labels;
}

export function renderSvg(calendar, { palette, dark }) {
  const { weeks, totalContributions } = calendar;
  const text = dark ? "#7d8590" : "#57606a";
  const outline = dark ? "rgba(255,255,255,0.06)" : "rgba(27,31,35,0.08)";
  const gridW = weeks.length * CELL;
  const gridH = 7 * CELL;
  const width = LEFT + gridW + 2;
  const height = TOP + gridH + BOTTOM;
  const font = `-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif`;

  const cell = (x, y, color) =>
    `<rect x="${x}" y="${y}" width="${DOT}" height="${DOT}" rx="2.5" fill="${color}" stroke="${outline}"/>`;

  const days = weeks
    .flatMap((week, w) =>
      week.contributionDays.map((day) => {
        const level = Math.max(0, LEVELS.indexOf(day.contributionLevel));
        return cell(w * CELL, day.weekday * CELL, palette[level]);
      })
    )
    .join("");

  const months = buildMonthLabels(weeks)
    .map(({ x, text: t }) => `<text class="lbl" x="${x}" y="-6">${t}</text>`)
    .join("");

  const weekdays = [
    [1, "Mon"],
    [3, "Wed"],
    [5, "Fri"],
  ]
    .map(([wd, t]) => `<text class="lbl" x="-6" y="${wd * CELL + 9}" text-anchor="end">${t}</text>`)
    .join("");

  const legendY = gridH + 10;
  const legendX = gridW - 5 * CELL - 28;
  const legend =
    `<text class="lbl" x="${legendX - 6}" y="${legendY + 9}" text-anchor="end">Less</text>` +
    palette.map((c, i) => cell(legendX + i * CELL, legendY, c)).join("") +
    `<text class="lbl" x="${legendX + 5 * CELL + 2}" y="${legendY + 9}">More</text>`;

  const total = `<text class="total" x="0" y="-22">${totalContributions.toLocaleString("en-US")} contributions in the last year</text>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-LEFT} ${-TOP} ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${totalContributions} GitHub contributions in the last year">` +
    `<style>.lbl{fill:${text};font:9px ${font}}.total{fill:${text};font:11px ${font}}</style>` +
    total + months + weekdays + days + legend +
    `</svg>\n`
  );
}

function parseArgs(argv) {
  const [filePath, ...rest] = argv;
  const opts = { filePath, dark: rest.includes("--dark"), palette: null };
  const i = rest.indexOf("--palette");
  if (i !== -1) opts.palette = rest[i + 1]?.split(",").map((c) => c.trim());
  return opts;
}

async function main() {
  const { filePath, dark, palette } = parseArgs(process.argv.slice(2));
  if (!filePath || !palette || palette.length !== 5) {
    console.error('uso: node contribution-grid.mjs <saida.svg> --palette "#c0,#c1,#c2,#c3,#c4" [--dark]');
    process.exit(1);
  }
  const login = process.env.GH_LOGIN;
  if (!login) {
    console.error("defina GH_LOGIN no ambiente");
    process.exit(1);
  }

  const calendar = await fetchCalendar(login);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, renderSvg(calendar, { palette, dark }), "utf8");
  console.log(`grid gerado em ${filePath} (total: ${calendar.totalContributions})`);
}

// so roda main() quando chamado diretamente (permite importar as funcoes puras em testes)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
