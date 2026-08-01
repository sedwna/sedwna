import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const username = process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY_OWNER;
const outputDir = process.env.OUTPUT_DIR || "dist";

if (!username) {
  throw new Error("GITHUB_USERNAME is required.");
}

const now = new Date();
const year = now.getUTCFullYear();
const month = now.getUTCMonth();
const monthStart = new Date(Date.UTC(year, month, 1));
const monthEnd = new Date(Date.UTC(year, month + 1, 1) - 1);
const today = now.toISOString().slice(0, 10);

const profileCalendarUrl = new URL(
  `https://github.com/users/${encodeURIComponent(username)}/contributions`,
);
profileCalendarUrl.searchParams.set("from", monthStart.toISOString().slice(0, 10));
profileCalendarUrl.searchParams.set("to", monthEnd.toISOString().slice(0, 10));

let response;
let lastRequestError;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    response = await fetch(profileCalendarUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent": "sedwna-monthly-activity-generator",
      },
    });
    if (response.ok || attempt === 3) break;
    lastRequestError = new Error(`GitHub contribution calendar request failed with ${response.status}.`);
  } catch (error) {
    lastRequestError = error;
  }
  await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
}

if (!response) throw lastRequestError;

if (!response.ok) {
  throw new Error(`GitHub contribution calendar request failed with ${response.status}.`);
}

const calendarHtml = await response.text();
const attribute = (attributes, name) => {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match?.[1];
};
const tooltipByCell = new Map();
for (const match of calendarHtml.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/g)) {
  const cellId = attribute(match[1], "for");
  if (cellId) tooltipByCell.set(cellId, match[2].replace(/<[^>]+>/g, "").trim());
}

const levels = ["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"];
const contributionDays = [];
for (const match of calendarHtml.matchAll(/<td\b([^>]*)><\/td>/g)) {
  const attributes = match[1];
  const className = attribute(attributes, "class") ?? "";
  if (!className.includes("ContributionCalendar-day")) continue;

  const date = attribute(attributes, "data-date");
  const cellId = attribute(attributes, "id");
  const levelNumber = Number(attribute(attributes, "data-level") ?? 0);
  const tooltip = tooltipByCell.get(cellId) ?? "";
  const countMatch = tooltip.match(/([\d,]+) contribution/);
  const contributionCount = countMatch ? Number(countMatch[1].replaceAll(",", "")) : 0;
  if (date) {
    contributionDays.push({
      date,
      contributionCount,
      contributionLevel: levels[levelNumber] ?? "NONE",
    });
  }
}

if (!contributionDays.length) {
  throw new Error("GitHub returned no contribution calendar cells.");
}

const contributionByDate = new Map(
  contributionDays.map((day) => [day.date, day]),
);

const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
const firstWeekday = monthStart.getUTCDay();
const monthLabel = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
}).format(monthStart);

const cells = Array.from({ length: 42 }, (_, index) => {
  const dayNumber = index - firstWeekday + 1;
  if (dayNumber < 1 || dayNumber > daysInMonth) {
    return { index, inMonth: false, future: false, count: 0, level: "NONE" };
  }

  const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
  const contribution = contributionByDate.get(date);
  return {
    index,
    inMonth: true,
    future: date > today,
    dayNumber,
    date,
    count: contribution?.contributionCount ?? 0,
    level: contribution?.contributionLevel ?? "NONE",
  };
});

const elapsedCells = cells.filter((cell) => cell.inMonth && !cell.future);
const totalContributions = elapsedCells.reduce((sum, cell) => sum + cell.count, 0);
const activeDays = elapsedCells.filter((cell) => cell.count > 0).length;

const palettes = {
  dark: {
    background: "#0D2B45",
    panel: "#123852",
    border: "#48677A",
    grid: "#1A435C",
    gridFuture: "#14354D",
    text: "#FFF3D3",
    muted: "#BEC9C2",
    subtle: "#91A59D",
    track: "#0A2338",
    trackBorder: "#6C817F",
    ticks: "#82958E",
  },
  light: {
    background: "#E1BE7E",
    panel: "#F2DDAE",
    border: "#B58B4A",
    grid: "#DFC999",
    gridFuture: "#EAD7AE",
    text: "#0D2B45",
    muted: "#4C6B74",
    subtle: "#6E807C",
    track: "#D8C497",
    trackBorder: "#9B7A45",
    ticks: "#8A7B5C",
  },
};

const levelColors = {
  NONE: null,
  FIRST_QUARTILE: "#315F5B",
  SECOND_QUARTILE: "#3D756B",
  THIRD_QUARTILE: "#4F8C77",
  FOURTH_QUARTILE: "#6FA083",
};

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function renderMonthlyActivity(theme) {
  const colors = palettes[theme];
  const cellSize = 28;
  const gap = 7;
  const gridX = 50;
  const gridY = 102;
  const cycleSeconds = 15;
  const travelEnd = 0.82;

  const pathOrder = [];
  for (let row = 0; row < 6; row += 1) {
    const columns = row % 2 === 0
      ? [0, 1, 2, 3, 4, 5, 6]
      : [6, 5, 4, 3, 2, 1, 0];
    for (const column of columns) {
      pathOrder.push(row * 7 + column);
    }
  }

  const pointForIndex = (index) => {
    const row = Math.floor(index / 7);
    const column = index % 7;
    return {
      x: gridX + column * (cellSize + gap) + cellSize / 2,
      y: gridY + row * (cellSize + gap) + cellSize / 2,
    };
  };

  const snakePoints = pathOrder.map(pointForIndex);
  const snakePath = snakePoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
  const orderPosition = new Map(pathOrder.map((index, position) => [index, position]));

  const weekdayLabels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
    .map((label, column) => {
      const x = gridX + column * (cellSize + gap) + cellSize / 2;
      return `<text x="${x}" y="88" text-anchor="middle" class="weekday">${label}</text>`;
    })
    .join("");

  const gridCells = cells.map((cell) => {
    const row = Math.floor(cell.index / 7);
    const column = cell.index % 7;
    const x = gridX + column * (cellSize + gap);
    const y = gridY + row * (cellSize + gap);

    if (!cell.inMonth) {
      return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="7" fill="${colors.gridFuture}" opacity=".34"/>`;
    }

    const fill = cell.future
      ? colors.gridFuture
      : levelColors[cell.level] || colors.grid;
    const cellTitle = cell.future
      ? `${cell.date} — upcoming`
      : `${cell.date} — ${cell.count} contribution${cell.count === 1 ? "" : "s"}`;
    const animatedOpacity = !cell.future && cell.count > 0
      ? (() => {
          const position = orderPosition.get(cell.index) / (pathOrder.length - 1);
          const eatAt = Math.max(0.015, position * travelEnd);
          const before = Math.max(0, eatAt - 0.012);
          const after = Math.min(0.9, eatAt + 0.012);
          return `<animate attributeName="opacity" values="1;1;.14;.14;1;1" keyTimes="0;${before.toFixed(4)};${after.toFixed(4)};.925;.95;1" dur="${cycleSeconds}s" repeatCount="indefinite"/>`;
        })()
      : "";

    return `
      <g>
        <title>${escapeXml(cellTitle)}</title>
        <rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="7" fill="${fill}" stroke="${cell.future ? colors.border : fill}" stroke-opacity="${cell.count > 0 ? ".65" : ".38"}" opacity="${cell.future ? ".55" : "1"}">
          ${animatedOpacity}
        </rect>
        <text x="${x + cellSize / 2}" y="${y + 18}" text-anchor="middle" class="day" opacity="${cell.future ? ".45" : ".82"}">${cell.dayNumber}</text>
      </g>`;
  }).join("");

  const progressTicks = [0.25, 0.5, 0.75].map((ratio) => {
    const x = 385 + 460 * ratio;
    return `<line x1="${x}" y1="252" x2="${x}" y2="270" stroke="${colors.ticks}" stroke-opacity=".6"/>`;
  }).join("");

  return `<svg width="900" height="340" viewBox="0 0 900 340" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(monthLabel)} GitHub contribution activity for ${escapeXml(username)}</title>
  <desc id="desc">An animated monthly calendar built from ${totalContributions} real public and private GitHub contributions across ${activeDays} active days. Private repository details remain hidden. A snake traverses the calendar while a synchronized progress bar fills from left to right.</desc>
  <defs>
    <linearGradient id="accent" x1="385" y1="0" x2="845" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#315F5B"/><stop offset=".55" stop-color="#4F8C77"/><stop offset="1" stop-color="#7AA27E"/>
    </linearGradient>
    <linearGradient id="snake" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#D7AD61"/><stop offset="1" stop-color="#9B6A2F"/>
    </linearGradient>
    <filter id="softGlow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="progressClip"><rect x="385" y="252" width="460" height="18" rx="9"/></clipPath>
  </defs>
  <style>
    .title { font: 750 23px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${colors.text}; letter-spacing: -.3px; }
    .eyebrow { font: 650 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: #D7AD61; letter-spacing: 2px; }
    .weekday { font: 650 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: ${colors.muted}; letter-spacing: .5px; }
    .day { font: 650 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${colors.text}; }
    .metric { font: 780 38px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${colors.text}; letter-spacing: -1px; }
    .label { font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${colors.muted}; }
    .micro { font: 600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: ${colors.muted}; letter-spacing: .6px; }
    .pct { font: 600 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: ${colors.subtle}; }
  </style>

  <rect x=".5" y=".5" width="899" height="339" rx="22" fill="${colors.background}" stroke="${colors.border}"/>
  <rect x="24" y="22" width="852" height="296" rx="17" fill="${colors.panel}" stroke="${colors.border}" stroke-opacity=".65"/>

  <text x="48" y="48" class="eyebrow">LIVE · PUBLIC + PRIVATE ACTIVITY</text>
  <text x="48" y="70" class="title">${escapeXml(monthLabel)}</text>
  ${weekdayLabels}
  ${gridCells}

  <path d="${snakePath}" stroke="#B98735" stroke-opacity=".16" stroke-width="2" stroke-dasharray="3 7"/>
  <g filter="url(#softGlow)">
    <circle r="4" fill="#9B6A2F" opacity=".34">
      <animateMotion path="${snakePath}" dur="${cycleSeconds}s" keyPoints="0;1;1" keyTimes="0;.82;1" calcMode="linear" repeatCount="indefinite"/>
    </circle>
    <circle r="7" fill="#C18F3E" opacity=".62">
      <animateMotion path="${snakePath}" dur="${cycleSeconds}s" begin=".08s" keyPoints="0;1;1" keyTimes="0;.82;1" calcMode="linear" repeatCount="indefinite"/>
    </circle>
    <circle r="10" fill="url(#snake)" stroke="#FFF0C7" stroke-opacity=".82">
      <animateMotion path="${snakePath}" dur="${cycleSeconds}s" begin=".16s" keyPoints="0;1;1" keyTimes="0;.82;1" calcMode="linear" repeatCount="indefinite"/>
    </circle>
  </g>

  <text x="385" y="86" class="eyebrow">ACTUAL GITHUB DATA</text>
  <text x="385" y="139" class="metric">${totalContributions.toLocaleString("en-US")}</text>
  <text x="385" y="160" class="label">contributions this month</text>
  <line x1="585" y1="104" x2="585" y2="170" stroke="${colors.border}"/>
  <text x="620" y="139" class="metric">${activeDays}</text>
  <text x="620" y="160" class="label">active days</text>
  <rect x="385" y="176" width="174" height="24" rx="12" fill="#B98735" fill-opacity=".15" stroke="#D7AD61" stroke-opacity=".58"/>
  <circle cx="401" cy="188" r="3" fill="#D7AD61"/>
  <text x="413" y="192" class="micro" style="fill:#D7AD61">PUBLIC + PRIVATE</text>
  <text x="574" y="192" class="micro">DETAILS STAY PRIVATE</text>
  <text x="385" y="213" class="micro">REPLAY PROGRESS · LEFT TO RIGHT</text>

  <text x="385" y="241" class="pct">0%</text>
  <text x="494" y="241" class="pct">25%</text>
  <text x="608" y="241" class="pct">50%</text>
  <text x="723" y="241" class="pct">75%</text>
  <text x="824" y="241" class="pct">100%</text>
  <rect x="385" y="252" width="460" height="18" rx="9" fill="${colors.track}" stroke="${colors.trackBorder}" stroke-width="2"/>
  <g clip-path="url(#progressClip)">
    <rect x="385" y="252" width="0" height="18" fill="url(#accent)">
      <animate attributeName="width" values="0;460;460;0" keyTimes="0;.82;.95;1" dur="${cycleSeconds}s" repeatCount="indefinite"/>
    </rect>
    ${progressTicks}
  </g>
  <circle cy="261" r="5" fill="#D1FAE5" filter="url(#softGlow)">
    <animate attributeName="cx" values="385;845;845;385" keyTimes="0;.82;.95;1" dur="${cycleSeconds}s" repeatCount="indefinite"/>
  </circle>

  <text x="385" y="302" class="micro">REAL CONTRIBUTIONS · REFRESHED DAILY · REPLAYS AUTOMATICALLY</text>
</svg>`;
}

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(join(outputDir, "monthly-activity-snake.svg"), renderMonthlyActivity("light")),
  writeFile(join(outputDir, "monthly-activity-snake-dark.svg"), renderMonthlyActivity("dark")),
]);

console.log(
  `Generated ${monthLabel}: ${totalContributions} public + anonymized private contributions across ${activeDays} active days.`,
);
