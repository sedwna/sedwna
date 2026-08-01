import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const username = process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || "sedwna";
const outputDir = process.env.OUTPUT_DIR || "dist";

const themes = [
  {
    file: "github-activity-snake.svg",
    mode: "light",
    background: "#E1BE7E",
    panel: "#F2DDAE",
    border: "#B58B4A",
    text: "#0D2B45",
    muted: "#4C6B74",
    track: "#D3BE8E",
    trackBorder: "#8C7143",
    progressStart: "#3D756B",
    progressEnd: "#7AA27E",
  },
  {
    file: "github-activity-snake-dark.svg",
    mode: "dark",
    background: "#0B111B",
    panel: "#101826",
    border: "#334155",
    text: "#F8FAFC",
    muted: "#94A3B8",
    track: "#0A2338",
    trackBorder: "#526477",
    progressStart: "#315F5B",
    progressEnd: "#7AA27E",
  },
];

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

async function fetchContributionTotal() {
  const url = `https://github.com/users/${encodeURIComponent(username)}/contributions`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "text/html", "User-Agent": "sedwna-snake-enhancer" },
      });
      if (response.ok) {
        const html = await response.text();
        const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        const match = plain.match(/([\d,]+) contributions? in the last year/i);
        if (match) return match[1];
      }
    } catch {
      // A later attempt may recover from a transient network error.
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  return null;
}

function monthLabels(now = new Date()) {
  const currentSunday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - now.getUTCDay(),
  ));
  const firstSunday = new Date(currentSunday);
  firstSunday.setUTCDate(firstSunday.getUTCDate() - 52 * 7);

  const labels = [];
  let previousMonth = -1;
  for (let column = 0; column < 53; column += 1) {
    const date = new Date(firstSunday);
    date.setUTCDate(date.getUTCDate() + column * 7);
    const month = date.getUTCMonth();
    if (column === 0 || month !== previousMonth) {
      const name = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
      labels.push(`<text x="${2 + column * 16}" y="-14" class="month">${name}</text>`);
    }
    previousMonth = month;
  }
  return labels.join("");
}

function weightedProgressKeyframes(svg) {
  const activeCells = [];
  for (const match of svg.matchAll(/\.c\.c(\d+)\{fill:var\(--c([0-4])\);animation-name:c\1\}/g)) {
    const id = match[1];
    const level = Number(match[2]);
    const start = svg.indexOf(`@keyframes c${id}{`);
    const end = svg.indexOf(`}.c.c${id}`, start);
    if (start < 0 || end < 0) continue;
    const block = svg.slice(start, end);
    const times = [...block.matchAll(/([\d.]+)%/g)].map((entry) => Number(entry[1]));
    if (times.length >= 2) {
      activeCells.push({
        before: times[0],
        after: times[1],
        weight: Math.max(1, level),
      });
    }
  }

  activeCells.sort((a, b) => a.before - b.before);
  const totalWeight = activeCells.reduce((sum, cell) => sum + cell.weight, 0) || 1;
  let cumulative = 0;
  const frames = ["0%{transform:scale(0,1)}"];
  for (const cell of activeCells) {
    frames.push(`${cell.before}%{transform:scale(${(cumulative / totalWeight).toFixed(4)},1)}`);
    cumulative += cell.weight;
    frames.push(`${cell.after}%{transform:scale(${(cumulative / totalWeight).toFixed(4)},1)}`);
  }
  frames.push("100%{transform:scale(1,1)}");
  return `@keyframes u0{${frames.join("")}}`;
}

function enhance(svg, theme, contributionTotal) {
  const keyframeStart = svg.indexOf("@keyframes u0{");
  const keyframeEnd = svg.indexOf(".u.u0{", keyframeStart);
  if (keyframeStart >= 0 && keyframeEnd >= 0) {
    svg = svg.slice(0, keyframeStart)
      + weightedProgressKeyframes(svg)
      + svg.slice(keyframeEnd);
  }

  svg = svg
    .replace(/<svg viewBox="[^"]+" width="[^"]+" height="[^"]+"/, '<svg viewBox="-76 -70 1000 270" width="1000" height="270"')
    .replace(/\.u\.u0\{fill:[^;]+;/, ".u.u0{fill:url(#progressGradient);");

  const defs = `<defs>
    <linearGradient id="progressGradient" x1="0" y1="0" x2="1" y2="0">
      <stop stop-color="${theme.progressStart}"/><stop offset="1" stop-color="${theme.progressEnd}"/>
    </linearGradient>
  </defs>`;
  svg = svg.replace(/(<desc>[\s\S]*?<\/desc>)/, `$1${defs}`);

  const extraCss = `
    .frame-text{font:650 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:${theme.text}}
    .title{font:700 20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:${theme.text}}
    .meta{font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.7px;fill:${theme.muted}}
    .month{font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:${theme.text}}
    .axis{font:600 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:${theme.muted}}
    .percent{font:600 8px ui-monospace,SFMono-Regular,Menlo,monospace;fill:${theme.muted}}
  `;
  svg = svg.replace("</style>", `${extraCss}</style>`);

  const title = contributionTotal
    ? `${escapeXml(contributionTotal)} contributions in the last year`
    : "Real contribution activity &#183; last 12 months";
  const headerAndAxes = `
    <rect x="-70" y="-64" width="988" height="254" rx="18" fill="${theme.background}" stroke="${theme.border}"/>
    <rect x="-56" y="-52" width="960" height="226" rx="14" fill="${theme.panel}" stroke="${theme.border}" stroke-opacity=".68"/>
    <text x="0" y="-39" class="title">${title}</text>
    <text x="848" y="-39" text-anchor="end" class="meta">DAILY &#183; PUBLIC + PRIVATE</text>
    ${monthLabels()}
    <text x="-47" y="28" class="axis">Mon</text>
    <text x="-47" y="60" class="axis">Wed</text>
    <text x="-47" y="92" class="axis">Fri</text>
    <g transform="translate(676 120)">
      <text x="0" y="10" class="axis">Less</text>
      <rect x="34" y="0" width="12" height="12" rx="3" fill="var(--c0)"/>
      <rect x="50" y="0" width="12" height="12" rx="3" fill="var(--c1)"/>
      <rect x="66" y="0" width="12" height="12" rx="3" fill="var(--c2)"/>
      <rect x="82" y="0" width="12" height="12" rx="3" fill="var(--c3)"/>
      <rect x="98" y="0" width="12" height="12" rx="3" fill="var(--c4)"/>
      <text x="118" y="10" class="axis">More</text>
    </g>
  `;
  svg = svg.replace(/(<\/style>)/, `$1${headerAndAxes}`);

  const progress = `
    <g>
      <text x="0" y="132" class="meta">WEIGHTED EATING PROGRESS &#183; LIGHT 1&#215; &#8594; DARK 4&#215;</text>
      <text x="0" y="145" class="percent">0%</text>
      <text x="206" y="145" class="percent">25%</text>
      <text x="418" y="145" class="percent">50%</text>
      <text x="630" y="145" class="percent">75%</text>
      <text x="830" y="145" class="percent">100%</text>
      <rect x="0" y="150" width="848.6" height="20" rx="10" fill="${theme.track}" stroke="${theme.trackBorder}" stroke-width="2"/>
      <line x1="212.15" y1="151" x2="212.15" y2="169" stroke="${theme.trackBorder}" stroke-opacity=".75"/>
      <line x1="424.3" y1="151" x2="424.3" y2="169" stroke="${theme.trackBorder}" stroke-opacity=".75"/>
      <line x1="636.45" y1="151" x2="636.45" y2="169" stroke="${theme.trackBorder}" stroke-opacity=".75"/>
      <rect class="u u0" height="14" width="848.6" x="0" y="153" rx="7" ry="7"/>
    </g>`;
  svg = svg.replace(/<rect class="u u0"[^>]*\/>/, progress);
  return svg;
}

const contributionTotal = await fetchContributionTotal();
for (const theme of themes) {
  const filePath = join(outputDir, theme.file);
  const svg = await readFile(filePath, "utf8");
  await writeFile(filePath, enhance(svg, theme, contributionTotal));
}

console.log(`Enhanced contribution snake${contributionTotal ? ` with ${contributionTotal} yearly contributions` : ""}.`);
