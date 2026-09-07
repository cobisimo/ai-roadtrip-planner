import OpenAI from "openai";
import { performance } from "node:perf_hooks";
import axios from "axios";

export type RouteStop = {
  name: string;
  city?: string;
  lat: number;
  lng: number;
  description: string;
  reason: string;
  ticketsRequired?: boolean;
  ticketPrice?: string;
  bookingAdvance?: string;
  ticketCurrency?: string;
  image?: string;
};

export type RouteData = {
  title: string;
  stops: RouteStop[];
};

export type RouteProgress = {
  step: string;
  message: string;
  percent?: number;
};

export type ProgressReporter = (event: RouteProgress) => void;

export type PreparedRoute = {
  routeData: RouteData;
  stops: RouteStop[];
  routeCoordinates: [number, number][] | null;
};

export type RoutePreparationOptions = {
  postProcess?: boolean;
  useNominatimCache?: boolean;
  useNominatimDelay?: boolean;
};

export type RouteTiming = {
  kind: "ai";
  ms: number;
  status: number;
};

export type RouteExternalTiming = {
  kind: "coordinates" | "images" | "route";
  ms: number;
  status?: number;
  index?: number;
  found?: boolean;
  lat?: number;
  lng?: number;
};

export type RouteServiceDependencies = {
  client: OpenAI;
  onTiming?: (timing: RouteTiming) => void;
  onExternalTiming?: (timing: RouteExternalTiming) => void;
  enrichImages?: boolean;
};

export const NOMINATIM_REQUEST_DELAY_MS = 1000;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT ?? "AI Roadtrip Planner/1.0";
const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL;
const WIKIMEDIA_USER_AGENT = process.env.WIKIMEDIA_USER_AGENT ?? "AI Roadtrip Planner/1.0";
const WIKIPEDIA_HEADERS = {
  "User-Agent": WIKIMEDIA_USER_AGENT,
  "Api-User-Agent": WIKIMEDIA_USER_AGENT,
  Accept: "application/json",
};
type GeocodedPlace = { lat: number; lng: number; city?: string };
type NominatimSearchResult = { lat?: string; lon?: string; address?: Record<string, string | undefined> };
type WikipediaSearchResult = { thumbnail?: { url?: string } | null };
const nominatimCache = new Map<string, GeocodedPlace | null>();

const RoutePlanSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "The descriptive title or name of the travel route."
    },
    stops: {
      type: "array",
      description: "An ordered list of geographical stops along the route.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "The formal name of the stop or point of interest." },
          description: { type: "string", description: "A short summary of what this stop is." },
          city: { type: "string", description: "The name of the nearest town or city to this stop." },
          lat: { type: "number", description: "The accurate GPS latitude coordinate." },
          lng: { type: "number", description: "The accurate GPS longitude coordinate." },
          reason: { type: "string", description: "The primary reason for including this location on the route." },
          ticketsRequired: { type: "boolean", description: "True if an entry ticket or pass must be acquired, otherwise false." },
          ticketPrice: { type: ["number", "null"], description: "The price of a single ticket in local currency. Null if free." },
          ticketCurrency: { type: ["string", "null"], description: "The currency symbol used for the ticket price. Null if free." },
          bookingAdvance: { type: ["string", "null"], description: "How far in advance booking is recommended. Null if not needed." }
        },
        required: ["name", "description", "city", "lat", "lng", "reason", "ticketsRequired", "ticketPrice", "ticketCurrency", "bookingAdvance"],
        additionalProperties: false
      }
    }
  },
  required: ["title", "stops"],
  additionalProperties: false
};

export class RouteService {
  constructor(private readonly dependencies: RouteServiceDependencies) { }

  async geocodeStops(
    stops: RouteStop[],
    report?: ProgressReporter,
    options: Pick<RoutePreparationOptions, "useNominatimCache" | "useNominatimDelay"> = {},
  ): Promise<RouteStop[]> {
    const geocodedStops: RouteStop[] = [];
    for (const [index, stop] of stops.entries()) {
      const label = this.getStopSearchLabel(stop) || `стajалиште ${index + 1}`;
      report?.({ step: "geocode_started", message: `Проналазим прецизније координате за: ${label}` });
      const started = performance.now();
      try {
        const coordinates = await this.fetchNominatimCoordinates(label, options.useNominatimCache !== false);
        this.dependencies.onExternalTiming?.({
          kind: "coordinates", ms: performance.now() - started, status: 200, index,
          lat: coordinates?.lat, lng: coordinates?.lng, found: Boolean(coordinates),
        });
        if (coordinates) {
          geocodedStops.push({ ...stop, ...coordinates, city: coordinates.city ?? stop.city });
          report?.({ step: "geocode_completed", message: `Координате су ажуриране за: ${label}`, percent: Math.round(((index + 1) / stops.length) * 100) });
        } else {
          geocodedStops.push(stop);
          report?.({ step: "geocode_failed", message: `Координате нису пронађене за: ${label}; користим AI координате.`, percent: Math.round(((index + 1) / stops.length) * 100) });
        }
      } catch (error) {
        this.dependencies.onExternalTiming?.({ kind: "coordinates", ms: performance.now() - started, index, found: false });
        console.error(`Error geocoding stop "${label}":`, error);
        geocodedStops.push(stop);
        report?.({ step: "geocode_failed", message: `Геокодирање није успело за: ${label}; користим AI координате.`, percent: Math.round(((index + 1) / stops.length) * 100) });
      }
      if (options.useNominatimDelay !== false && index < stops.length - 1) {
        await wait(NOMINATIM_REQUEST_DELAY_MS);
      }
    }
    return geocodedStops;
  }

  async enrichStopsWithImages(stops: RouteStop[], report?: ProgressReporter): Promise<RouteStop[]> {
    return Promise.all(stops.map(async (stop, index) => {
      const label = this.getStopSearchLabel(stop) || `стajалиште ${index + 1}`;
      if (stop.image) {
        this.dependencies.onExternalTiming?.({ kind: "images", ms: 0, index, found: true });
        report?.({ step: "image_completed", message: `Слика већ постоји за: ${label}`, percent: Math.round(((index + 1) / stops.length) * 100) });
        return stop;
      }
      report?.({ step: "image_started", message: `Проналазим слику за: ${label}` });
      const started = performance.now();
      try {
        const image = await this.fetchWikipediaImage(label);
        this.dependencies.onExternalTiming?.({ kind: "images", ms: performance.now() - started, status: 200, index, found: Boolean(image) });
        report?.({ step: image ? "image_completed" : "image_failed", message: image ? `Слика је пронађена за: ${label}` : `Слика није пронађена за: ${label}`, percent: Math.round(((index + 1) / stops.length) * 100) });
        return image ? { ...stop, image } : stop;
      } catch (error) {
        this.dependencies.onExternalTiming?.({ kind: "images", ms: performance.now() - started, index, found: false });
        console.error(`Error fetching image for stop "${label}":`, error);
        report?.({ step: "image_failed", message: `Слика није могла да се учита за: ${label}`, percent: Math.round(((index + 1) / stops.length) * 100) });
        return stop;
      }
    }));
  }

  async fetchRoute(waypoints: string[]): Promise<[number, number][] | null> {
    const started = performance.now();
    try {
      const response = await axios.get(`https://router.project-osrm.org/route/v1/driving/${waypoints.join(";")}?overview=full&geometries=geojson`);
      this.dependencies.onExternalTiming?.({ kind: "route", ms: performance.now() - started, status: response.status });
      return response.data.routes[0].geometry.coordinates;
    } catch (error) {
      this.dependencies.onExternalTiming?.({ kind: "route", ms: performance.now() - started });
      console.error("Error fetching route:", error);
      return null;
    }
  }

  async prepareRoute(
    prompt: string,
    report: ProgressReporter,
    existingRoute?: { title: string; data: string },
    options: RoutePreparationOptions = {},
  ): Promise<PreparedRoute> {
    const { client } = this.dependencies;
    report({
      step: existingRoute ? "edit_started" : "started",
      message: existingRoute ? "Припремам измену постојеће руте." : "Покрећем планирање путовања.",
      percent: 0,
    });
    report({
      step: "ai_started",
      message: existingRoute ? "AI агент обрађује ваш додатни захтев." : "AI агент осмишљава руту.",
      percent: 10,
    });

    const context = existingRoute
      ? `Постојећа рута:\n${JSON.stringify({ title: existingRoute.title, stops: JSON.parse(existingRoute.data) })}\n\nДодатни захтев корисника:\n${prompt}`
      : prompt;
    const basePrompt = "Ти си искусни стручњак за планирање путовања. На основу корисничког упита креирај логичну, реалну и географски повезану руту. Опис и разлог посете напиши на српском језику ћирилицом у најмање 3 реченице.";
    const messages = [
      {
        role: "system" as const,
        content: existingRoute
          ? `${basePrompt} Задржи корисне постојеће локације, али измени, додај или уклони стајалишта у складу са додатним захтевом.`
          : basePrompt,
      },
      { role: "user" as const, content: context },
    ];

    let completion;
    const aiStarted = performance.now();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        completion = await client.chat.completions.create({
          messages,
          model: process.env.OPENAI_MODEL ?? "gpt-3.5-turbo",
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "route_plan",
              strict: true, // Forces compliance with strict serialization
              schema: RoutePlanSchema
            }
          }
        });
        this.dependencies.onTiming?.({ kind: "ai", ms: performance.now() - aiStarted, status: 200 });
        break;
      } catch (error) {
        const status = this.getErrorStatus(error);
        if ((status !== 503 && status !== 429) || attempt === 3) {
          this.dependencies.onTiming?.({ kind: "ai", ms: performance.now() - aiStarted, status: status ?? 500 });
          if (status === 503) throw new Error("AI сервис је тренутно недоступан. Покушајте поново.");
          if (status === 429) throw new Error("AI лимит је тренутно достигнут. Сачекајте и покушајте поново.");
          throw error;
        }
        const delay = attempt * 1500;
        report({ step: "ai_retry", message: `AI сервис је привремено недоступан. Поновни покушај за ${Math.round(delay / 1000)} секунде.`, percent: 10 });
        await wait(delay);
      }
    }
    if (!completion) throw new Error("AI сервис није вратио одговор. Покушајте поново.");
    report({ step: "ai_completed", message: "AI агент је направио предлог руте.", percent: 35 });

    let routeData: RouteData;
    try {
      routeData = this.parseRouteData(completion.choices[0].message.content || "{}");
    } catch (error) {
      console.error("Error parsing route data:", error);
      throw new Error("AI није вратио исправан формат руте.");
    }
    if (!routeData.title || !Array.isArray(routeData.stops)) {
      throw new Error("AI није вратио валидне податке о рути.");
    }

    if (options.postProcess === false) {
      return { routeData, stops: routeData.stops, routeCoordinates: null };
    }

    report({ step: "geocoding_started", message: `Проверавам координате за ${routeData.stops.length} стајалишта.`, percent: 35 });
    const geocodedStops = await this.geocodeStops(
      routeData.stops,
      (event) => report({ ...event, percent: event.percent === undefined ? 35 : 35 + Math.round(event.percent * 0.1) }),
      options,
    );
    report({ step: "geocoding_completed", message: "Координате су проверене преко Nominatim-а.", percent: 45 });
    report({ step: "images_started", message: `Обогаћујем ${geocodedStops.length} стајалишта сликама.`, percent: 50 });
    const stops = this.dependencies.enrichImages === false
      ? geocodedStops
      : await this.enrichStopsWithImages(geocodedStops, (event) => report({ ...event, percent: event.percent === undefined ? 50 : 50 + Math.round(event.percent * 0.3) }));
    report({ step: "images_completed", message: "Обогаћивање сликама је завршено.", percent: 80 });
    report({ step: "route_started", message: "Израчунавам путну трасу.", percent: 85 });
    const routeCoordinates = await this.fetchRoute(stops.map((stop) => `${stop.lng},${stop.lat}`));
    report({ step: routeCoordinates ? "route_completed" : "route_warning", message: routeCoordinates ? "Путна траса је израчуната." : "Путна траса није доступна, али рута може бити сачувана.", percent: 90 });

    return { routeData, stops, routeCoordinates };
  }

  private getErrorStatus(error: unknown) {
    if (error && typeof error === "object" && "status" in error) {
      const status = (error as { status?: unknown }).status;
      if (typeof status === "number") return status;
    }
    const message = error instanceof Error ? error.message : String(error ?? "");
    const match = message.match(/\b(429|503)\b/);
    return match ? Number(match[1]) : undefined;
  }

  private getStopSearchLabel(stop: RouteStop) {
    return [...new Set([stop.name?.trim(), stop.city?.trim()].filter(Boolean))].join(", ");
  }

  private async fetchNominatimCoordinates(query: string, useCache: boolean) {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return undefined;
    if (useCache && nominatimCache.has(normalizedQuery)) return nominatimCache.get(normalizedQuery) ?? undefined;
    const response = await axios.get<NominatimSearchResult[]>("https://nominatim.openstreetmap.org/search", {
      params: { q: query, format: "jsonv2", limit: 1, addressdetails: 1, ...(NOMINATIM_EMAIL ? { email: NOMINATIM_EMAIL } : {}) },
      headers: { "User-Agent": NOMINATIM_USER_AGENT, Referer: FRONTEND_URL, Accept: "application/json" },
      timeout: 8000,
    });
    const result = response.data[0];
    const lat = Number(result?.lat);
    const lng = Number(result?.lon);
    const city = result?.address?.city || result?.address?.town || result?.address?.village || result?.address?.municipality || result?.address?.hamlet;
    const coordinates = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, ...(city ? { city } : {}) } : null;
    if (useCache) nominatimCache.set(normalizedQuery, coordinates);
    return coordinates ?? undefined;
  }

  private async fetchWikipediaImage(query: string) {
    if (!query) return undefined;
    const response = await axios.get<{ pages?: WikipediaSearchResult[] }>("https://sr.wikipedia.org/w/rest.php/v1/search/page", {
      params: { q: query, limit: 1 }, headers: WIKIPEDIA_HEADERS, timeout: 5000,
    });
    const url = response.data.pages?.[0]?.thumbnail?.url;
    return url?.replace("60px", "500px").replace("//", "https://");
  }

  private parseRouteData(content: string): RouteData {
    let normalized = content.trim();
    normalized = normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const firstObject = normalized.indexOf("{");
    const lastObject = normalized.lastIndexOf("}");
    if (firstObject >= 0 && lastObject > firstObject) normalized = normalized.slice(firstObject, lastObject + 1);
    return JSON.parse(this.removeTrailingJsonCommas(normalized)) as RouteData;
  }

  private removeTrailingJsonCommas(value: string) {
    let result = "";
    let inString = false;
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (inString) {
        result += character;
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        result += character;
        continue;
      }
      if (character === ",") {
        let nextIndex = index + 1;
        while (/\s/.test(value[nextIndex] ?? "")) nextIndex += 1;
        if (value[nextIndex] === "}" || value[nextIndex] === "]") continue;
      }
      result += character;
    }
    return result;
  }
}
