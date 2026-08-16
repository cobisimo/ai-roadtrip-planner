import express from "express";
import cors from "cors";
import OpenAI from "openai";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import * as schema from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import { db, sqlite } from "../db/client.js";
import "../db/migrateUsers.js";
import { adminOnly, auth, nonAdminOnly } from "../middleware/auth.js";
import { forgotPassword, login, register, resetPassword } from "../controllers/auth.controller.js";

process.on("uncaughtException", (err) => {
  console.error("Критична грешка приликом покретања:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(
    "Необрађено обећање (unhandled rejection) на:",
    promise,
    "разлог:",
    reason,
  );
});

console.log("Покрећем сервер...");

export const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "m3_chip_power_123";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  "http://localhost:3000/api/auth/google/callback";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const GOOGLE_STATE_COOKIE = "google_oauth_state";
const googleOAuthClient =
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
    ? new OAuth2Client({
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        redirectUri: GOOGLE_REDIRECT_URI,
      })
    : null;

app.use(cors());
app.use(express.json());

// const client = new OpenAI({
//   baseURL: 'https://api.mistral.ai/v1',
//   apiKey: process.env.MISTRAL_API_KEY,
// });

const client = new OpenAI({
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
  apiKey: process.env.GEMINI_API_KEY,
});

type RouteStop = {
  place: string;
  city?: string;
  lat: number;
  lng: number;
  description: string;
  reason: string;
  image?: string;
};

type RouteData = {
  title: string;
  stops: RouteStop[];
};

const removeTrailingJsonCommas = (value: string) => {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
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
};

const parseRouteData = (content: string): RouteData => {
  let normalized = content.trim();

  // Some providers still wrap JSON in Markdown despite response_format.
  normalized = normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  const firstObject = normalized.indexOf("{");
  const lastObject = normalized.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    normalized = normalized.slice(firstObject, lastObject + 1);
  }

  return JSON.parse(removeTrailingJsonCommas(normalized)) as RouteData;
};

type UserRole = "user" | "admin";
type UserPlan = "free" | "paid_10" | "paid_50" | "paid_100" | "none";

const PLAN_LIMITS: Record<Exclude<UserPlan, "none">, number> = {
  free: 3,
  paid_10: 10,
  paid_50: 50,
  paid_100: 100,
};
const USER_PLANS = ["free", "paid_10", "paid_50", "paid_100"] as const;
const getPlanRank = (plan: UserPlan) =>
  plan === "none" ? -1 : USER_PLANS.indexOf(plan);

const getPlanLimit = (plan: UserPlan) =>
  plan === "none" ? 0 : (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free);

type AuthenticatedUser = {
  userId: number;
  email: string;
  role: UserRole;
  plan: UserPlan;
  dailyLimit: number;
  usageDate: string | null;
  usageCount: number;
};

type WikipediaSearchResult = {
  title: string;
  matched_title?: string | null;
  description?: string | null;
  thumbnail?: {
    url?: string;
  } | null;
};

const WIKIMEDIA_USER_AGENT =
  process.env.WIKIMEDIA_USER_AGENT ??
  "AI Roadtrip Planner/1.0 (route image enrichment; local development)";

const WIKIPEDIA_HEADERS = {
  "User-Agent": WIKIMEDIA_USER_AGENT,
  "Api-User-Agent": WIKIMEDIA_USER_AGENT,
  Accept: "application/json",
};

const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "AI Roadtrip Planner/1.0 (geocoding; configure NOMINATIM_USER_AGENT for production)";
const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL;
type GeocodedPlace = { lat: number; lng: number; city?: string };
const nominatimCache = new Map<string, GeocodedPlace | null>();

const normalizeThumbnailUrl = (url?: string) => {
  if (!url) return undefined;
  return url.replace("60px", "500px").replace("//", "https://");
};

const getStopSearchLabel = (stop: RouteStop) =>
  [...new Set([stop.place?.trim(), stop.city?.trim()].filter(Boolean))].join(
    ", ",
  );

const fetchWikipediaImage = async (query: string) => {
  if (!query) {
    return undefined;
  }

  const response = await axios.get<{ pages?: WikipediaSearchResult[] }>(
    "https://sr.wikipedia.org/w/rest.php/v1/search/page",
    {
      params: {
        q: query,
        limit: 1,
      },
      headers: WIKIPEDIA_HEADERS,
      timeout: 5000,
    },
  );

  const pages = response.data.pages ?? [];
  return normalizeThumbnailUrl(pages[0]?.thumbnail?.url);
};

type GenerationEvent = {
  type: "progress" | "error" | "complete";
  step?: string;
  message?: string;
  percent?: number;
  route?: unknown;
};

type ProgressReporter = (event: Omit<GenerationEvent, "type">) => void;

type NominatimSearchResult = {
  lat?: string;
  lon?: string;
  address?: Record<string, string | undefined>;
};

const getClosestCity = (address?: Record<string, string | undefined>) =>
  address?.city ||
  address?.town ||
  address?.village ||
  address?.municipality ||
  address?.hamlet;

const fetchNominatimCoordinates = async (query: string) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return undefined;

  if (nominatimCache.has(normalizedQuery)) {
    return nominatimCache.get(normalizedQuery) ?? undefined;
  }

  const response = await axios.get<NominatimSearchResult[]>(
    "https://nominatim.openstreetmap.org/search",
    {
      params: {
        q: query,
        format: "jsonv2",
        limit: 1,
        addressdetails: 1,
        ...(NOMINATIM_EMAIL ? { email: NOMINATIM_EMAIL } : {}),
      },
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Referer: FRONTEND_URL,
        Accept: "application/json",
      },
      timeout: 8000,
    },
  );

  const result = response.data[0];
  const lat = Number(result?.lat);
  const lng = Number(result?.lon);
  const city = getClosestCity(result?.address);
  const coordinates =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng, ...(city ? { city } : {}) }
      : null;
  nominatimCache.set(normalizedQuery, coordinates);
  return coordinates ?? undefined;
};

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const geocodeStops = async (stops: RouteStop[], report?: ProgressReporter) => {
  const geocodedStops: RouteStop[] = [];

  for (const [index, stop] of stops.entries()) {
    const label = getStopSearchLabel(stop) || `стajалиште ${index + 1}`;
    report?.({
      step: "geocode_started",
      message: `Проналазим прецизније координате за: ${label}`,
    });

    try {
      const coordinates = await fetchNominatimCoordinates(label);
      if (coordinates) {
        geocodedStops.push({
          ...stop,
          ...coordinates,
          city: coordinates.city ?? stop.city,
        });
        report?.({
          step: "geocode_completed",
          message: `Координате су ажуриране за: ${label}`,
          percent: Math.round(((index + 1) / stops.length) * 100),
        });
      } else {
        geocodedStops.push(stop);
        report?.({
          step: "geocode_failed",
          message: `Координате нису пронађене за: ${label}; користим AI координате.`,
          percent: Math.round(((index + 1) / stops.length) * 100),
        });
      }
    } catch (error) {
      console.error(`Error geocoding stop "${label}":`, error);
      geocodedStops.push(stop);
      report?.({
        step: "geocode_failed",
        message: `Геокодирање није успело за: ${label}; користим AI координате.`,
        percent: Math.round(((index + 1) / stops.length) * 100),
      });
    }

    if (index < stops.length - 1) {
      await wait(1000);
    }
  }

  return geocodedStops;
};

const enrichStopsWithImages = async (
  stops: RouteStop[],
  report?: ProgressReporter,
) => {
  return Promise.all(
    stops.map(async (stop, index) => {
      const label = getStopSearchLabel(stop) || `стajалиште ${index + 1}`;

      if (stop.image) {
        report?.({
          step: "image_completed",
          message: `Слика већ постоји за: ${label}`,
          percent: Math.round(((index + 1) / stops.length) * 100),
        });
        return stop;
      }

      report?.({
        step: "image_started",
        message: `Проналазим слику за: ${label}`,
      });

      try {
        const image = await fetchWikipediaImage(getStopSearchLabel(stop));
        if (image) {
          report?.({
            step: "image_completed",
            message: `Слика је пронађена за: ${label}`,
            percent: Math.round(((index + 1) / stops.length) * 100),
          });
          return { ...stop, image };
        }
        report?.({
          step: "image_failed",
          message: `Слика није пронађена за: ${label}`,
          percent: Math.round(((index + 1) / stops.length) * 100),
        });
      } catch (error) {
        console.error(`Error fetching image for stop "${label}":`, error);
        report?.({
          step: "image_failed",
          message: `Слика није могла да се учита за: ${label}`,
          percent: Math.round(((index + 1) / stops.length) * 100),
        });
      }

      return stop;
    }),
  );
};

const getUserById = (userId: number): AuthenticatedUser | undefined => {
  const user = sqlite
    .prepare(
      "SELECT id, email, role, plan, daily_limit, usage_date, usage_count FROM users WHERE id = ?",
    )
    .get(userId) as
    | {
        id: number;
        email: string;
        role: string;
        plan: string;
        daily_limit: number;
        usage_date: string | null;
        usage_count: number;
      }
    | undefined;

  if (!user) return undefined;

  const role: UserRole = user.role === "admin" ? "admin" : "user";
  const plan: UserPlan = role === "admin" ? "none" : (user.plan as UserPlan);

  return {
    userId: user.id,
    email: user.email,
    role,
    plan,
    dailyLimit: getPlanLimit(plan),
    usageDate: user.usage_date,
    usageCount: user.usage_count,
  };
};

const toPublicUser = (user: AuthenticatedUser | undefined) => {
  if (!user) return undefined;
  return {
    ...user,
    plan: user.role === "admin" ? null : user.plan,
  };
};

const getToday = () => new Date().toISOString().slice(0, 10);

const getNextResetAt = () => {
  const reset = new Date();
  reset.setUTCHours(24, 0, 0, 0);
  return reset.toISOString();
};

const consumeGenerationQuota = (userId: number) => {
  const user = getUserById(userId);
  if (!user) return { allowed: false, reason: "Корисник није пронађен." };
  if (user.role === "admin")
    return { allowed: true, remaining: null, limit: null, resetAt: null };

  const today = getToday();
  const usageCount = user.usageDate === today ? user.usageCount : 0;
  const limit = getPlanLimit(user.plan);

  if (usageCount >= limit) {
    return {
      allowed: false,
      reason: `Достигнут је дневни лимит захтева (${limit}).`,
      remaining: 0,
      limit,
      resetAt: getNextResetAt(),
    };
  }

  const nextUsageCount = usageCount + 1;
  sqlite
    .prepare("UPDATE users SET usage_date = ?, usage_count = ? WHERE id = ?")
    .run(today, nextUsageCount, userId);

  return {
    allowed: true,
    remaining: limit - nextUsageCount,
    limit,
    resetAt: getNextResetAt(),
  };
};

const getCookies = (header?: string) =>
  Object.fromEntries(
    (header ?? "").split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return [];
      return [
        [
          part.slice(0, separator).trim(),
          decodeURIComponent(part.slice(separator + 1).trim()),
        ],
      ];
    }),
  );

const redirectToLogin = (
  res: express.Response,
  params: Record<string, string>,
) => {
  const query = new URLSearchParams(params);
  res.redirect(`${FRONTEND_URL}/login?${query.toString()}`);
};

app.get("/api/auth/google", (req, res) => {
  if (!googleOAuthClient) {
    return redirectToLogin(res, {
      error: "Google аутентификација није подешена на серверу.",
    });
  }

  const state = randomBytes(24).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `${GOOGLE_STATE_COOKIE}=${encodeURIComponent(state)}; HttpOnly; Path=/api/auth/google; SameSite=Lax; Max-Age=600`,
  );

  const googleUrl = googleOAuthClient.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });

  res.redirect(googleUrl);
});

app.get("/api/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const storedState = getCookies(req.headers.cookie)[GOOGLE_STATE_COOKIE];

  if (error) {
    return redirectToLogin(res, { error: String(error) });
  }

  if (
    typeof code !== "string" ||
    typeof state !== "string" ||
    !storedState ||
    state !== storedState
  ) {
    return redirectToLogin(res, {
      error: "Неважеће стање Google аутентификације.",
    });
  }

  if (!googleOAuthClient || !GOOGLE_CLIENT_ID) {
    return redirectToLogin(res, {
      error: "Google аутентификација није подешена на серверу.",
    });
  }

  try {
    const { tokens } = await googleOAuthClient.getToken(code);
    if (!tokens.id_token) {
      return redirectToLogin(res, {
        error: "Google није вратио идентификациони токен.",
      });
    }

    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || payload.email_verified === false) {
      return redirectToLogin(res, {
        error: "Google није доставио верификовану имејл адресу.",
      });
    }

    let user = sqlite
      .prepare("SELECT * FROM users WHERE google_id = ?")
      .get(payload.sub) as { id: number; email: string } | undefined;

    if (!user) {
      user = sqlite
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(payload.email) as { id: number; email: string } | undefined;
      if (user) {
        sqlite
          .prepare("UPDATE users SET google_id = ? WHERE id = ?")
          .run(payload.sub, user.id);
      }
    }

    if (!user) {
      const password = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
      const result = sqlite
        .prepare(
          "INSERT INTO users (email, password, google_id, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(payload.email, password, payload.sub, Date.now());
      user = { id: Number(result.lastInsertRowid), email: payload.email };
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" },
    );
    res.setHeader(
      "Set-Cookie",
      `${GOOGLE_STATE_COOKIE}=; HttpOnly; Path=/api/auth/google; SameSite=Lax; Max-Age=0`,
    );
    return redirectToLogin(res, { token });
  } catch (oauthError) {
    console.error("Google authentication failed:", oauthError);
    return redirectToLogin(res, {
      error: "Google аутентификација није успела. Покушајте поново.",
    });
  }
});

app.get("/api/me", auth, (req: any, res) => {
  res.json(toPublicUser(req.user));
});

app.patch("/api/me/plan", auth, nonAdminOnly, (req: any, res) => {
  const requestedPlan = req.body.plan as UserPlan;
  if (!USER_PLANS.includes(requestedPlan as (typeof USER_PLANS)[number])) {
    return res.status(400).json({ error: "Неважећи план." });
  }

  sqlite
    .prepare("UPDATE users SET plan = ?, daily_limit = ? WHERE id = ?")
    .run(requestedPlan, getPlanLimit(requestedPlan), req.user.userId);

  res.json(toPublicUser(getUserById(req.user.userId)));
});

app.get("/api/admin/stats", auth, adminOnly, (req, res) => {
  const today = getToday();
  const userStats = sqlite
    .prepare(
      `
    SELECT
      COUNT(*) AS total_users,
      SUM(CASE WHEN role != 'admin' AND plan = 'free' THEN 1 ELSE 0 END) AS free_users,
      SUM(CASE WHEN role != 'admin' AND plan IN ('paid_10', 'paid_50', 'paid_100') THEN 1 ELSE 0 END) AS paid_users,
      SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admin_users,
      COALESCE(SUM(CASE WHEN usage_date = ? THEN usage_count ELSE 0 END), 0) AS requests_today
    FROM users
  `,
    )
    .get(today) as Record<string, number>;
  const routeStats = sqlite
    .prepare(
      `
    SELECT
      COUNT(*) AS total_routes,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS routes_today
    FROM routes
  `,
    )
    .get(Date.now() - 24 * 60 * 60 * 1000) as Record<string, number>;

  res.json({
    totalUsers: Number(userStats.total_users ?? 0),
    freeUsers: Number(userStats.free_users ?? 0),
    paidUsers: Number(userStats.paid_users ?? 0),
    adminUsers: Number(userStats.admin_users ?? 0),
    requestsToday: Number(userStats.requests_today ?? 0),
    totalRoutes: Number(routeStats.total_routes ?? 0),
    routesToday: Number(routeStats.routes_today ?? 0),
  });
});

app.get("/api/admin/users", auth, adminOnly, (req, res) => {
  const users = sqlite
    .prepare(
      `
    SELECT
      users.id,
      users.email,
      users.role,
      users.plan,
      users.daily_limit,
      users.usage_date,
      users.usage_count,
      users.created_at,
      COUNT(routes.id) AS total_routes
    FROM users
    LEFT JOIN routes ON routes.user_id = users.id
    GROUP BY users.id
    ORDER BY users.id DESC
  `,
    )
    .all() as Array<Record<string, unknown>>;

  res.json(
    users.map((user) => ({
      id: Number(user.id),
      email: String(user.email),
      role: String(user.role),
      plan: user.role === "admin" ? null : String(user.plan),
      dailyLimit: getPlanLimit(
        user.role === "admin" ? "none" : (user.plan as UserPlan),
      ),
      usageDate: user.usage_date,
      usageCount: Number(user.usage_count),
      totalRoutes: Number(user.total_routes ?? 0),
      createdAt: user.created_at,
    })),
  );
});

app.patch("/api/admin/users/:id", auth, adminOnly, (req, res) => {
  const userId = Number(req.params.id);
  const currentUser = getUserById(userId);
  if (!currentUser)
    return res.status(404).json({ error: "Корисник није пронађен." });

  const requestedRole = req.body.role as UserRole;
  const allowedRoles: UserRole[] = ["user", "admin"];
  if (!allowedRoles.includes(requestedRole)) {
    return res.status(400).json({ error: "Неважећа улога." });
  }

  if (currentUser.role === "admin" && requestedRole !== "admin") {
    const adminCountResult = sqlite
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
      .get() as { count: number };
    const adminCount = Number(adminCountResult.count);
    if (adminCount <= 1) {
      return res
        .status(400)
        .json({ error: "Последњи администратор не може бити деградиран." });
    }
  }

  const requestedPlan = req.body.plan as UserPlan | undefined;
  const paidPlans: UserPlan[] = ["paid_10", "paid_50", "paid_100"];
  let plan: UserPlan;
  if (requestedRole === "user" && requestedPlan === "free") {
    plan = "free";
  } else if (requestedRole === "admin") {
    plan = "none";
  } else if (requestedPlan && paidPlans.includes(requestedPlan)) {
    plan = requestedPlan;
  } else {
    plan =
      currentUser.plan === "free" || paidPlans.includes(currentUser.plan)
        ? currentUser.plan
        : "free";
  }

  const dailyLimit = requestedRole === "admin" ? 0 : getPlanLimit(plan);

  sqlite
    .prepare(
      "UPDATE users SET role = ?, plan = ?, daily_limit = ? WHERE id = ?",
    )
    .run(
      requestedRole,
      requestedRole === "admin" ? "" : plan,
      dailyLimit,
      userId,
    );

  res.json(toPublicUser(getUserById(userId)));
});

const fetchRoute = async (
  waypoints: string[],
): Promise<[number, number][] | null> => {
  try {
    const response = await axios.get(
      `https://router.project-osrm.org/route/v1/driving/${waypoints.join(";")}?overview=full&geometries=geojson`,
    );
    return response.data.routes[0].geometry.coordinates;
  } catch (error) {
    console.error("Error fetching route:", error);
    return null;
  }
};

app.post("/api/login", login);
app.post("/api/register", register);
app.post("/api/forgot-password", forgotPassword);
app.post("/api/reset-password", resetPassword);

app.post("/api/generate", auth, nonAdminOnly, async (req: any, res) => {
  if (typeof req.body.prompt !== "string" || !req.body.prompt.trim()) {
    return res.status(400).json({ error: "Унос је обавезан." });
  }

  const quota = consumeGenerationQuota(req.user.userId);
  if (!quota.allowed) {
    return res.status(429).json({
      error: quota.reason,
      remaining: quota.remaining,
      limit: quota.limit,
      resetAt: quota.resetAt,
    });
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (event: GenerationEvent) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const sendProgress = (event: Omit<GenerationEvent, "type">) => {
    sendEvent({ type: "progress", ...event });
  };

  try {
    sendProgress({
      step: "started",
      message:
        quota.limit === null
          ? "Покрећем планирање путовања."
          : `Покрећем планирање путовања. Преостало захтева данас: ${quota.remaining}.`,
      percent: 0,
    });
    sendProgress({
      step: "ai_started",
      message: "AI агент осмишљава руту.",
      percent: 10,
    });

    const completion = await client.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            'Ти си искусни стручњак за планирање путовања (Road Trip Planner). Твој задатак је да на основу корисничког упита креираш логичну, реалну и географски повезану руту са 4 до 6 стајалишта.\n\nПРАВИЛА ЗА ГЕНЕРИСАЊЕ СТАЈАЛИШТА:\n1. Редослед: Стајалишта морају бити уређена логичким редоследом за вожњу.\n2. Назив (place): Наведи тачан и званичан назив локације или знаменитости (нпр. \'Манастир Манасија\', а не само \'Манастир\').\n3. Град (city): Наведи најближи већи град или општину којој место припада.\n4. Координате (lat, lng): Наведи што прецизније географске координате.\n5. Опис (description): Детаљно опиши место у барем 3 реченице. Опис мора да обухвати: шта је то место, његов историјски или природни значај и шта корисник ту може да види.\n6. Разлог посете (reason): У барем 3 реченице објасни зашто је ово место изабрано БАШ за овај конкретан кориснички упит. Немој понављати информације из описа, већ се фокусирај на доживљај и специфичну жељу корисника.\n\nФОРМАТ ИЗЛАЗА:\nОдговори ИСКЉУЧИВО у валидном JSON формату. Немој додавати никакав уводни ни закључни текст, нити Markdown ознаке (попут ```json).\n\nШема JSON објекта:\n{\n  "title": "Креативан назив целог путовања",\n  "description": "Кратак преглед целе руте у 2 реченице",\n  "stops": [\n    {\n      "place": "Назив места",\n      "city": "Најближи град",\n      "lat": 44.1234,\n      "lng": 20.5678,\n      "description": "Опис од најмање 3 детаљне реченице...",\n      "reason": "Разлог посете од најмање 3 детаљне реченице..."\n    }\n  ]\n}',
        },
        { role: "user", content: req.body.prompt },
      ],
      // model: "mistral-small-latest",
      model: "gemini-3-flash-preview",
      response_format: { type: "json_object" },
    });
    sendProgress({
      step: "ai_completed",
      message: "AI агент је направио предлог руте.",
      percent: 35,
    });

    let routeData: RouteData;

    try {
      routeData = parseRouteData(completion.choices[0].message.content || "{}");
    } catch (error) {
      console.error("Error parsing route data:", error);
      console.log(completion);
      throw new Error("AI није вратио исправан формат руте.");
    }

    if (!routeData.title || !Array.isArray(routeData.stops)) {
      throw new Error("AI није вратио валидне податке о рути.");
    }

    const generatedStops = routeData.stops;
    sendProgress({
      step: "geocoding_started",
      message: `Проверавам координате за ${generatedStops.length} стајалишта.`,
      percent: 35,
    });
    const geocodedStops = await geocodeStops(generatedStops, (event) => {
      sendProgress({
        ...event,
        percent:
          event.percent === undefined
            ? 35
            : 35 + Math.round(event.percent * 0.1),
      });
    });
    sendProgress({
      step: "geocoding_completed",
      message: "Координате су проверене преко Nominatim-а.",
      percent: 45,
    });

    sendProgress({
      step: "images_started",
      message: `Обогаћујем ${geocodedStops.length} стајалишта сликама.`,
      percent: 50,
    });
    const stops = await enrichStopsWithImages(geocodedStops, (event) => {
      sendProgress({
        ...event,
        percent:
          event.percent === undefined
            ? 50
            : 50 + Math.round(event.percent * 0.3),
      });
    });
    sendProgress({
      step: "images_completed",
      message: "Обогаћивање сликама је завршено.",
      percent: 80,
    });

    sendProgress({
      step: "route_started",
      message: "Израчунавам путну трасу.",
      percent: 85,
    });
    const waypoints = stops.map((stop) => `${stop.lng},${stop.lat}`);
    const routeCoordinates = await fetchRoute(waypoints);
    if (!routeCoordinates) {
      sendProgress({
        step: "route_warning",
        message: "Путна траса није доступна, али рута може бити сачувана.",
        percent: 90,
      });
    } else {
      sendProgress({
        step: "route_completed",
        message: "Путна траса је израчуната.",
        percent: 90,
      });
    }

    sendProgress({
      step: "saving_started",
      message: "Чувам руту.",
      percent: 95,
    });
    const result = await db
      .insert(schema.routes)
      .values({
        userId: req.user.userId,
        title: routeData.title,
        destination: req.body.prompt,
        data: JSON.stringify(stops),
        path: JSON.stringify(
          (routeCoordinates ?? []).map((coord) => [coord[1], coord[0]]),
        ),
      })
      .returning();
    sendEvent({
      type: "complete",
      step: "completed",
      message: "Путовање је успешно испланирано.",
      percent: 100,
      route: result[0],
    });
  } catch (error) {
    console.error("Error generating route:", error);
    sendEvent({
      type: "error",
      step: "failed",
      message:
        error instanceof Error ? error.message : "Генерисање руте није успело.",
    });
  } finally {
    res.end();
  }
});

app.get("/api/routes", auth, nonAdminOnly, async (req: any, res) => {
  try {
    const result = await db
      .select({
        id: schema.routes.id,
        userId: schema.routes.userId,
        title: schema.routes.title,
        destination: schema.routes.destination,
        createdAt: schema.routes.createdAt,
      })
      .from(schema.routes)
      .where(eq(schema.routes.userId, req.user.userId))
      .orderBy(desc(schema.routes.createdAt));
    res.json(result);
  } catch (error) {
    console.error("Error fetching routes:", error);
    res.status(500).json({ error: "Интерна грешка сервера." });
  }
});

app.get("/api/routes/:id", auth, nonAdminOnly, async (req: any, res) => {
  try {
    const { id } = req.params;
    const result = await db
      .select()
      .from(schema.routes)
      .where(eq(schema.routes.id, id))
      .limit(1);

    if (result.length === 0) {
      return res.status(404).json({ error: "Рута није пронађена." });
    }

    res.json(result[0]);
  } catch (error) {
    console.error("Error fetching route details:", error);
    res.status(500).json({ error: "Интерна грешка сервера." });
  }
});

app.delete("/api/routes/:id", auth, nonAdminOnly, async (req: any, res) => {
  try {
    const { id } = req.params;
    const result = await db
      .delete(schema.routes)
      .where(eq(schema.routes.id, id))
      .returning();
    if (result.length === 0) {
      return res.status(404).json({ error: "Рута није пронађена." });
    }
    res.json({ message: "Рута је уклоњена из историје." });
  } catch (error) {
    console.error("Error removing route:", error);
    res.status(500).json({ error: "Интерна грешка сервера." });
  }
});
