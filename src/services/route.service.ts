import OpenAI from "openai";

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

type PreparedRoute = {
  routeData: RouteData;
  stops: RouteStop[];
  routeCoordinates: [number, number][] | null;
};

type RouteServiceDependencies = {
  client: OpenAI;
  geocodeStops: (stops: RouteStop[], report?: ProgressReporter) => Promise<RouteStop[]>;
  enrichStopsWithImages: (stops: RouteStop[], report?: ProgressReporter) => Promise<RouteStop[]>;
  fetchRoute: (waypoints: string[]) => Promise<[number, number][] | null>;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

  async prepareRoute(
    prompt: string,
    report: ProgressReporter,
    existingRoute?: { title: string; data: string },
  ): Promise<PreparedRoute> {
    const { client, geocodeStops, enrichStopsWithImages, fetchRoute } = this.dependencies;
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
        break;
      } catch (error) {
        const status = this.getErrorStatus(error);
        if ((status !== 503 && status !== 429) || attempt === 3) {
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

    report({ step: "geocoding_started", message: `Проверавам координате за ${routeData.stops.length} стајалишта.`, percent: 35 });
    const geocodedStops = await geocodeStops(routeData.stops, (event) => report({ ...event, percent: event.percent === undefined ? 35 : 35 + Math.round(event.percent * 0.1) }));
    report({ step: "geocoding_completed", message: "Координате су проверене преко Nominatim-а.", percent: 45 });
    report({ step: "images_started", message: `Обогаћујем ${geocodedStops.length} стајалишта сликама.`, percent: 50 });
    const stops = await enrichStopsWithImages(geocodedStops, (event) => report({ ...event, percent: event.percent === undefined ? 50 : 50 + Math.round(event.percent * 0.3) }));
    report({ step: "images_completed", message: "Обогаћивање сликама је завршено.", percent: 80 });
    report({ step: "route_started", message: "Израчунавам путну трасу.", percent: 85 });
    const routeCoordinates = await fetchRoute(stops.map((stop) => `${stop.lng},${stop.lat}`));
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
