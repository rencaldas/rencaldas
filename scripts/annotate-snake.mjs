#!/usr/bin/env node
/**
 * Injeta no SVG gerado pelo Platane/snk:
 *  - texto com o total de contributions do ano
 *  - labels de mes (colunas) e de dia da semana (linhas), como no grafico original do GitHub
 *
 * Uso: node scripts/annotate-snake.mjs <arquivo.svg> [--dark]
 * Requer env GH_LOGIN e GH_TOKEN (token com escopo read:user).
 */

import { readFileSync, writeFileSync } from "node:fs";

const QUERY = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              weekday
            }
          }
        }
      }
    }
  }
`;

async function fetchCalendar(login, token) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL respondeu ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data.user.contributionsCollection.contributionCalendar;
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const CELL = 16;   // espacamento entre celulas (px), igual ao usado pelo Platane/snk
const CELL_X0 = 2; // x da primeira coluna
const CELL_Y0 = 2; // y da primeira linha
const MIN_WEEKS_BETWEEN_LABELS = 3; // evita labels de mes colados

export function buildMonthLabels(weeks) {
  const labels = [];
  let lastMonth = null;
  let lastLabelWeek = -Infinity;

  weeks.forEach((week, weekIndex) => {
    const firstDay = week.contributionDays[0];
    if (!firstDay) return;
    const month = new Date(firstDay.date).getUTCMonth();
    if (month !== lastMonth && weekIndex - lastLabelWeek >= MIN_WEEKS_BETWEEN_LABELS) {
      labels.push({ x: CELL_X0 + weekIndex * CELL, text: MONTH_ABBR[month] });
      lastLabelWeek = weekIndex;
    }
    lastMonth = month;
  });

  return labels;
}

export function buildDayLabels() {
  // 0=domingo .. 6=sabado; replica o grafico do GitHub, que so rotula Mon/Wed/Fri
  return [
    { weekday: 1, text: "Mon" },
    { weekday: 3, text: "Wed" },
    { weekday: 5, text: "Fri" },
  ].map(({ weekday, text }) => ({
    y: CELL_Y0 + weekday * CELL + 9, // baseline aproximado do centro da celula
    text,
  }));
}

export function injectLabels(svg, { totalContributions, monthLabels, dayLabels, dark }) {
  const textColor = dark ? "#7d8590" : "#57606a";
  const styleAddition = `.lbl{fill:${textColor};font:9px -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}.lbl-total{fill:${textColor};font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}`;

  const monthText = monthLabels
    .map(({ x, text }) => `<text class="lbl" x="${x}" y="-4">${text}</text>`)
    .join("");

  const dayText = dayLabels
    .map(({ y, text }) => `<text class="lbl" x="-6" y="${y}" text-anchor="end">${text}</text>`)
    .join("");

  const totalText = `<text class="lbl-total" x="2" y="-20">${totalContributions} contributions in the last year</text>`;

  if (!svg.includes("</style>")) {
    throw new Error("SVG sem bloco <style> — formato inesperado do Platane/snk");
  }

  let out = svg.replace("</style>", `${styleAddition}</style>`);
  out = out.replace("</style>", `</style>${totalText}${monthText}${dayText}`);

  // amplia a margem esquerda (de -16 para -34) para caber "Wed"/"Fri" sem cortar
  const viewBoxMatch = out.match(/viewBox="-16 -32 (\d+) (\d+)"/);
  if (!viewBoxMatch) {
    throw new Error("viewBox inesperado no SVG do Platane/snk — ajuste o regex do script");
  }
  const [, w, h] = viewBoxMatch;
  out = out.replace(
    /viewBox="-16 -32 \d+ \d+"/,
    `viewBox="-34 -32 ${Number(w) + 18} ${h}"`
  );

  return out;
}

async function main() {
  const [, , filePath, themeFlag] = process.argv;
  const isDark = themeFlag === "--dark";

  if (!filePath) {
    console.error("uso: node annotate-snake.mjs <arquivo.svg> [--dark]");
    process.exit(1);
  }

  const login = process.env.GH_LOGIN;
  const token = process.env.GH_TOKEN;

  if (!login || !token) {
    console.error("defina GH_LOGIN e GH_TOKEN no ambiente");
    process.exit(1);
  }

  const svg = readFileSync(filePath, "utf8");
  const calendar = await fetchCalendar(login, token);
  const monthLabels = buildMonthLabels(calendar.weeks);
  const dayLabels = buildDayLabels();

  const annotated = injectLabels(svg, {
    totalContributions: calendar.totalContributions,
    monthLabels,
    dayLabels,
    dark: isDark,
  });

  writeFileSync(filePath, annotated, "utf8");
  console.log(`labels injetadas em ${filePath} (total: ${calendar.totalContributions})`);
}

// so roda main() quando chamado diretamente (permite importar as funcoes puras em testes)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
