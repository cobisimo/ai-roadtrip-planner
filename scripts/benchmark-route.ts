import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import OpenAI from "openai";
import {
  RouteService,
  type RouteExternalTiming,
  type RouteStop,
} from "../src/services/route.service.js";

type StopMeasurement = {
  run: number;
  index: number;
  name: string;
  city?: string;
  aiLat?: number;
  aiLng?: number;
  osmLat?: number;
  osmLng?: number;
  coordinateErrorKm?: number;
  coordinateApiMs?: number;
  coordinateApiStatus?: number;
  coordinateFound: boolean;
  mediaApiMs?: number;
  mediaApiStatus?: number;
  mediaFound: boolean;
  error?: string;
};

type RunMeasurement = {
  run: number;
  title: string;
  aiMs: number;
  aiStatus: number;
  stops: number;
  coordinateApiMs: number | null;
  mediaApiMs: number | null;
  routeApiMs: number | null;
  coordinateSuccessRate: number | null;
  meanCoordinateErrorKm: number | null;
  medianCoordinateErrorKm: number | null;
  mediaSuccessRate: number | null;
  error?: string;
};

type BenchmarkReport = {
  generatedAt: string;
  provider: string;
  model: string;
  baseUrl: string;
  prompt: string;
  runs: RunMeasurement[];
  stops: StopMeasurement[];
};

type CoordinateMeasurement = { ms: number; status?: number; lat?: number; lng?: number; error?: string };
type MediaMeasurement = { ms: number; status?: number; found: boolean; error?: string };

const args = process.argv.slice(2);
const getArg = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const hasArg = (name: string) => args.includes(name);

if (hasArg("--help") || hasArg("-h")) {
  console.log(`Коришћење: npm run benchmark -- --prompt "Ваш упит за руту" [опције]

Потребне променљиве окружења:
  OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL

Опције:
  --prompt <текст>      Обавезни упит за руту
  --runs <број>         Број понављања мерења (подразумевано: 1)
  --output <директоријум> Директоријум за извештаје
  --no-media            Прескочи мерење Википедије
`);
  process.exit(0);
}

const prompt = getArg("--prompt");
const baseUrl = process.env.OPENAI_BASE_URL;
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL;
const runs = Math.max(1, Number(getArg("--runs") ?? "1") || 1);
const includeMedia = !hasArg("--no-media");
const outputDirectory = getArg("--output") ?? join("benchmark-results", new Date().toISOString().replace(/[:.]/g, "-"));

if (!prompt?.trim()) {
  console.error(
    "Недостаје обавезни упит за руту. Наведите га помоћу опције --prompt, на пример: " +
    'npm run benchmark -- --prompt "Направи петодневну руту од Београда до Прага"',
  );
  process.exitCode = 1;
  process.exit();
}
if (!baseUrl || !apiKey || !model) throw new Error("Потребне су променљиве окружења OPENAI_BASE_URL, OPENAI_API_KEY и OPENAI_MODEL.");

const client = new OpenAI({ baseURL: baseUrl, apiKey });
const provider = process.env.BENCHMARK_PROVIDER ?? new URL(baseUrl).hostname;
const stopName = (stop: RouteStop) => stop.name?.trim() || "Непознато стајалиште";
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const msToSeconds = (milliseconds: number) => milliseconds / 1000;
const secondsDisplay = (milliseconds: number) => `${msToSeconds(milliseconds).toFixed(2)} s`;

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLng = (lng2 - lng1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const measureRun = async (run: number) => {
  const coordinateMeasurements = new Map<number, CoordinateMeasurement>();
  const mediaMeasurements = new Map<number, MediaMeasurement>();
  let aiTiming = { ms: 0, status: 200 };
  let routeApiMs = 0;
  const service = new RouteService({
    client,
    enrichImages: includeMedia,
    onTiming: (timing) => { aiTiming = { ms: timing.ms, status: timing.status }; },
    onExternalTiming: (timing: RouteExternalTiming) => {
      if (timing.kind === "coordinates" && timing.index !== undefined) {
        coordinateMeasurements.set(timing.index, { ms: timing.ms, status: timing.status, lat: timing.lat, lng: timing.lng });
      } else if (timing.kind === "images" && timing.index !== undefined) {
        mediaMeasurements.set(timing.index, { ms: timing.ms, status: timing.status, found: Boolean(timing.found) });
      } else if (timing.kind === "route") {
        routeApiMs = timing.ms;
      }
    },
  });
  try {
    const prepared = await service.prepareRoute(prompt!, () => undefined, undefined, {
      postProcess: run === 1,
      useNominatimCache: false,
      useNominatimDelay: false,
    });
    const hasExternalMeasurements = coordinateMeasurements.size > 0;
    const stops: StopMeasurement[] = prepared.routeData.stops.map((aiStop, index) => {
      const coordinate = coordinateMeasurements.get(index) ?? { ms: 0 };
      const media = mediaMeasurements.get(index) ?? { ms: 0, found: false };
      const aiLat = finite(aiStop.lat);
      const aiLng = finite(aiStop.lng);
      const coordinateFound = coordinate.lat !== undefined && coordinate.lng !== undefined;
      const coordinateErrorKm = coordinateFound && aiLat !== undefined && aiLng !== undefined ? haversineKm(aiLat, aiLng, coordinate.lat!, coordinate.lng!) : undefined;
      return { run, index: index + 1, name: stopName(aiStop), city: aiStop.city, aiLat, aiLng, osmLat: hasExternalMeasurements ? coordinate.lat : undefined, osmLng: hasExternalMeasurements ? coordinate.lng : undefined, coordinateErrorKm: hasExternalMeasurements ? coordinateErrorKm : undefined, coordinateApiMs: hasExternalMeasurements ? coordinate.ms : undefined, coordinateApiStatus: hasExternalMeasurements ? coordinate.status : undefined, coordinateFound: hasExternalMeasurements && coordinateFound, mediaApiMs: includeMedia && hasExternalMeasurements ? media.ms : undefined, mediaApiStatus: includeMedia && hasExternalMeasurements ? media.status : undefined, mediaFound: includeMedia && hasExternalMeasurements ? media.found : false, error: [coordinate.error, media.error].filter(Boolean).join("; ") || undefined };
    });
    const errors = stops.map((stop) => stop.coordinateErrorKm).filter((value): value is number => value !== undefined);
    return { run: { run, title: prepared.routeData.title, aiMs: aiTiming.ms, aiStatus: aiTiming.status, stops: stops.length, coordinateApiMs: hasExternalMeasurements ? stops.reduce((sum, stop) => sum + (stop.coordinateApiMs ?? 0), 0) : null, mediaApiMs: hasExternalMeasurements && includeMedia ? stops.reduce((sum, stop) => sum + (stop.mediaApiMs ?? 0), 0) : null, routeApiMs: hasExternalMeasurements ? routeApiMs : null, coordinateSuccessRate: hasExternalMeasurements ? stops.filter((stop) => stop.coordinateFound).length / Math.max(stops.length, 1) : null, meanCoordinateErrorKm: hasExternalMeasurements ? mean(errors) : null, medianCoordinateErrorKm: hasExternalMeasurements ? median(errors) : null, mediaSuccessRate: hasExternalMeasurements && includeMedia ? stops.filter((stop) => stop.mediaFound).length / Math.max(stops.length, 1) : null }, stops };
  } catch (error) {
    return { run: { run, title: "Грешка", aiMs: aiTiming.ms, aiStatus: aiTiming.status, stops: 0, coordinateApiMs: null, mediaApiMs: null, routeApiMs: null, coordinateSuccessRate: null, meanCoordinateErrorKm: null, medianCoordinateErrorKm: null, mediaSuccessRate: null, error: error instanceof Error ? error.message : String(error) }, stops: [] };
  }
};

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);
const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  return [columns.join(","), ...rows.map((row) => columns.map((column) => `"${String(row[column] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
};
const chart = (runs: RunMeasurement[], firstRun: RunMeasurement | undefined) => {
  const phases = [
    { label: "AI модел", color: "#4c6ef5" },
    { label: "OSM координате", color: "#20a070" },
    { label: "Википедија", color: "#9b59b6" },
    { label: "OSRM рута", color: "#f08c46" },
  ];
  const external = [firstRun?.coordinateApiMs ?? 0, firstRun?.mediaApiMs ?? 0, firstRun?.routeApiMs ?? 0];
  const values = runs.map((run) => [run.aiMs, ...external]);
  const totals = values.map((run) => run.reduce((sum, value) => sum + value, 0));
  const max = Math.max(...values.flat(), 1);
  const chartHeight = 145;
  const baselineY = 172;
  const groupStep = 650 / Math.max(runs.length, 1);
  const barWidth = Math.max(8, Math.min(18, (groupStep - 20) / phases.length));
  const barGap = 3;
  const bars = values.map((run, index) => {
    const groupX = 50 + index * groupStep;
    const groupWidth = phases.length * barWidth + (phases.length - 1) * barGap;
    const xStart = groupX + (groupStep - groupWidth) / 2;
    const totalLabel = `Укупно ${secondsDisplay(totals[index])}`;
    return run.map((value, phaseIndex) => {
      const height = (value / max) * chartHeight;
      const x = xStart + phaseIndex * (barWidth + barGap);
      const y = baselineY - height;
      return value > 0 ? `<rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="2" fill="${phases[phaseIndex].color}"/>` : "";
    }).join("") + `<text x="${groupX + groupStep / 2}" y="${baselineY + 18}" text-anchor="middle" font-size="9">${index + 1}. мерење</text><text x="${groupX + groupStep / 2}" y="24" text-anchor="middle" font-size="9" fill="#6b7280">${totalLabel}</text>`;
  }).join("");
  const legend = phases.map((phase) => `<span><i style="background:${phase.color}"></i>${phase.label}</span>`).join("");
  const gridLines = [0, 0.5, 1].map((ratio) => {
    const y = baselineY - ratio * chartHeight;
    return `<line x1="44" y1="${y}" x2="710" y2="${y}" stroke="#e7ebf1"/><text x="38" y="${y + 3}" text-anchor="end" font-size="10" fill="#7b8494">${secondsDisplay(max * ratio)}</text>`;
  }).join("");
  return `<h3>Време по фазама и мерењу</h3><div class="legend">${legend}</div><svg viewBox="0 0 720 205" role="img" aria-label="Време по фазама и мерењу">${gridLines}<g>${bars}</g></svg>`;
};

const main = async () => {
  const measurements = [];
  for (let run = 1; run <= runs; run += 1) {
    console.log(`Мерење ${run}/${runs}: ${provider} / ${model}`);
    measurements.push(await measureRun(run));
  }
  const report: BenchmarkReport = { generatedAt: new Date().toISOString(), provider, model, baseUrl: baseUrl!, prompt: prompt!, runs: measurements.map((measurement) => measurement.run), stops: measurements.flatMap((measurement) => measurement.stops) };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(outputDirectory, "stops.csv"), csv(report.stops as unknown as Record<string, unknown>[]));
  const firstRun = report.runs[0];
  const averageAiMs = mean(report.runs.map((run) => run.aiMs)) ?? 0;
  const rows = firstRun ? `<tr><td>${secondsDisplay(averageAiMs)}</td><td>${firstRun.stops}</td><td>${firstRun.coordinateApiMs === null ? "-" : secondsDisplay(firstRun.coordinateApiMs)}</td><td>${firstRun.mediaApiMs === null ? "-" : secondsDisplay(firstRun.mediaApiMs)}</td><td>${firstRun.routeApiMs === null ? "-" : secondsDisplay(firstRun.routeApiMs)}</td><td>${firstRun.coordinateSuccessRate === null ? "-" : `${(firstRun.coordinateSuccessRate * 100).toFixed(0)}%`}</td><td>${firstRun.meanCoordinateErrorKm?.toFixed(2) ?? "-"} km</td></tr>` : "";
  const stopRows = report.stops.filter((stop) => stop.run === 1).map((stop) => `<tr><td>${escapeHtml(stop.name)}</td><td>${stop.aiLat?.toFixed(5) ?? "-"}, ${stop.aiLng?.toFixed(5) ?? "-"}</td><td>${stop.osmLat?.toFixed(5) ?? "-"}, ${stop.osmLng?.toFixed(5) ?? "-"}</td><td>${stop.coordinateErrorKm?.toFixed(2) ?? "-"} km</td><td>${stop.coordinateApiMs === undefined ? "-" : secondsDisplay(stop.coordinateApiMs)}</td><td>${stop.mediaApiMs === undefined ? "-" : secondsDisplay(stop.mediaApiMs)}</td></tr>`).join("");
  const html = `<!doctype html><html lang="sr-Cyrl"><head><meta charset="utf-8"><title>Мерење генератора руте</title><style>body{font:15px system-ui;max-width:1100px;margin:32px auto;color:#18212f}.meta{color:#5c6778}.card{border:1px solid #d9dee8;border-radius:12px;padding:16px;margin:14px 0;background:#fff}.chart{width:100%;height:auto}svg{width:100%;height:auto}.legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin:6px 0 2px;color:#5c6778;font-size:12px}.legend span{display:inline-flex;align-items:center;gap:5px}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px;border-bottom:1px solid #e7eaf0;text-align:left}th{background:#f5f7fa}h1,h2,h3{margin-top:0}</style></head><body><h1>Мерење AI генератора путних рута</h1><p class="meta">${escapeHtml(provider)} · ${escapeHtml(model)} · ${escapeHtml(report.generatedAt)}</p><h2>${escapeHtml(report.prompt)}</h2><section class="card">${chart(report.runs, firstRun)}</section><section class="card"><h3>Резултати  мерења</h3><table><thead><tr><th>AI (s), просек</th><th>Стајалишта</th><th>OSM (s)</th><th>Википедија (s)</th><th>OSRM (s)</th><th>Успешност OSM-а</th><th>Просечна грешка</th></tr></thead><tbody>${rows}</tbody></table></section><section class="card"><h3>Поређење координата по стајалишту</h3><table><thead><tr><th>Место</th><th>AI координате</th><th>OSM координате</th><th>Одступање</th><th>OSM (s)</th><th>Википедија (s)</th></tr></thead><tbody>${stopRows}</tbody></table></section></body></html>`;
  await writeFile(join(outputDirectory, "report.html"), html);
  console.table(report.runs.map((run) => ({ "Мерење": run.run, "AI (s)": secondsDisplay(run.aiMs), "Стајалишта": run.stops, "OSM (s)": run.coordinateApiMs === null ? "-" : secondsDisplay(run.coordinateApiMs), "Википедија (s)": run.mediaApiMs === null ? "-" : secondsDisplay(run.mediaApiMs), "OSRM (s)": run.routeApiMs === null ? "-" : secondsDisplay(run.routeApiMs), "Просечна грешка (km)": run.meanCoordinateErrorKm?.toFixed(2) ?? "-" })));
  console.log(`\nИзвештаји су сачувани у ${outputDirectory}/report.html, report.json и stops.csv`);
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
