import express from "express";
import cors from "cors";
import OpenAI from "openai";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import * as schema from "../db/schema.js";
import { and, eq, desc } from "drizzle-orm";
import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import { db, sqlite } from "../db/client.js";
import "../db/migrateUsers.js";
import { adminOnly, auth, nonAdminOnly } from "../middleware/auth.js";
import { forgotPassword, login, register, resetPassword } from "../controllers/auth.controller.js";
import { RouteService, type ProgressReporter, type RouteStop } from "../services/route.service.js";
import { USER_PLANS, userService, type UserPlan, type UserRole } from "../services/user.service.js";

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

const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
});

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
  [...new Set([stop.name?.trim(), stop.city?.trim()].filter(Boolean))].join(
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
  res.json(userService.toPublicUser(req.user));
});

app.patch("/api/me/plan", auth, nonAdminOnly, (req: any, res) => {
  const requestedPlan = req.body.plan as UserPlan;
  if (!USER_PLANS.includes(requestedPlan as (typeof USER_PLANS)[number])) {
    return res.status(400).json({ error: "Неважећи план." });
  }

  sqlite
    .prepare("UPDATE users SET plan = ?, daily_limit = ? WHERE id = ?")
    .run(requestedPlan, userService.getPlanLimit(requestedPlan), req.user.userId);

  res.json(userService.toPublicUser(userService.getUserById(req.user.userId)));
});

app.get("/api/admin/stats", auth, adminOnly, (req, res) => {
  const today = userService.getToday();
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
      dailyLimit: userService.getPlanLimit(
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
  const currentUser = userService.getUserById(userId);
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

  const dailyLimit = requestedRole === "admin" ? 0 : userService.getPlanLimit(plan);

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

  res.json(userService.toPublicUser(userService.getUserById(userId)));
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

const routeService = new RouteService({
  client,
  geocodeStops,
  enrichStopsWithImages,
  fetchRoute,
});

app.post("/api/login", login);
app.post("/api/register", register);
app.post("/api/forgot-password", forgotPassword);
app.post("/api/reset-password", resetPassword);

app.post("/api/generate", auth, nonAdminOnly, async (req: any, res) => {
  if (typeof req.body.prompt !== "string" || !req.body.prompt.trim()) {
    return res.status(400).json({ error: "Унос је обавезан." });
  }

  const quota = userService.consumeGenerationQuota(req.user.userId);
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
    const { routeData, stops, routeCoordinates } = await routeService.prepareRoute(req.body.prompt, sendProgress);

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

app.put("/api/routes/:id", auth, nonAdminOnly, async (req: any, res) => {
  if (typeof req.body.prompt !== "string" || !req.body.prompt.trim()) {
    return res.status(400).json({ error: "Додатни захтев је обавезан." });
  }

  const routeId = Number(req.params.id);
  if (!Number.isInteger(routeId)) return res.status(400).json({ error: "Неважећи идентификатор руте." });
  const existingRoutes = await db
    .select()
    .from(schema.routes)
    .where(and(eq(schema.routes.id, routeId), eq(schema.routes.userId, req.user.userId)))
    .limit(1);
  const existingRoute = existingRoutes[0];
  if (!existingRoute) return res.status(404).json({ error: "Рута није пронађена." });

  const quota = userService.consumeGenerationQuota(req.user.userId);
  if (!quota.allowed) {
    return res.status(429).json({ error: quota.reason, remaining: quota.remaining, limit: quota.limit, resetAt: quota.resetAt });
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
  const sendProgress = (event: Omit<GenerationEvent, "type">) => sendEvent({ type: "progress", ...event });

  try {
    const { routeData, stops, routeCoordinates } = await routeService.prepareRoute(req.body.prompt, sendProgress, existingRoute);
    sendProgress({ step: "saving_started", message: "Чувам измене руте.", percent: 95 });

    const updated = await db.update(schema.routes)
      .set({ title: routeData.title, destination: `${existingRoute.destination}\n\n${req.body.prompt}`, data: JSON.stringify(stops), path: JSON.stringify((routeCoordinates ?? []).map((coord) => [coord[1], coord[0]])) })
      .where(and(eq(schema.routes.id, routeId), eq(schema.routes.userId, req.user.userId)))
      .returning();
    sendEvent({ type: "complete", step: "completed", message: "Рута је успешно измењена.", percent: 100, route: updated[0] });
  } catch (error) {
    console.error("Error editing route:", error);
    sendEvent({ type: "error", step: "failed", message: error instanceof Error ? error.message : "Измена руте није успела." });
  } finally {
    res.end();
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
