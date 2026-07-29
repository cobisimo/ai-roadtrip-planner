import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './db/schema.js';
import { eq, desc } from 'drizzle-orm';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';

process.on('uncaughtException', (err) => {
  console.error('Критична грешка приликом покретања:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Необрађено обећање (unhandled rejection) на:', promise, 'разлог:', reason);
});

console.log("Покрећем сервер...");

const app = express();
const sqlite = new Database('roadtrip.db');
const db = drizzle(sqlite, { schema });
const JWT_SECRET = process.env.JWT_SECRET || 'm3_chip_power_123';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const GOOGLE_STATE_COOKIE = 'google_oauth_state';
const googleOAuthClient = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
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
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
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
  'AI Roadtrip Planner/1.0 (route image enrichment; local development)';

const WIKIPEDIA_HEADERS = {
  'User-Agent': WIKIMEDIA_USER_AGENT,
  'Api-User-Agent': WIKIMEDIA_USER_AGENT,
  Accept: 'application/json',
};

const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  'AI Roadtrip Planner/1.0 (geocoding; configure NOMINATIM_USER_AGENT for production)';
const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL;
type GeocodedPlace = { lat: number; lng: number; city?: string };
const nominatimCache = new Map<string, GeocodedPlace | null>();

const normalizeThumbnailUrl = (url?: string) => {
  if (!url) return undefined;
  return url.replace('60px', '500px').replace('//', 'https://');
};

const getStopSearchLabel = (stop: RouteStop) => [...new Set([stop.place?.trim(), stop.city?.trim()].filter(Boolean))].join(', ');

const fetchWikipediaImage = async (query: string) => {
  if (!query) {
    return undefined;
  }

  const response = await axios.get<{ pages?: WikipediaSearchResult[] }>('https://sr.wikipedia.org/w/rest.php/v1/search/page', {
    params: {
      q: query,
      limit: 1,
    },
    headers: WIKIPEDIA_HEADERS,
    timeout: 5000,
  });

  const pages = response.data.pages ?? [];
  return normalizeThumbnailUrl(pages[0]?.thumbnail?.url);
};

type GenerationEvent = {
  type: 'progress' | 'error' | 'complete';
  step?: string;
  message?: string;
  percent?: number;
  route?: unknown;
};

type ProgressReporter = (event: Omit<GenerationEvent, 'type'>) => void;

type NominatimSearchResult = {
  lat?: string;
  lon?: string;
  address?: Record<string, string | undefined>;
};

const getClosestCity = (address?: Record<string, string | undefined>) =>
  address?.city || address?.town || address?.village || address?.municipality || address?.hamlet;

const fetchNominatimCoordinates = async (query: string) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return undefined;

  if (nominatimCache.has(normalizedQuery)) {
    return nominatimCache.get(normalizedQuery) ?? undefined;
  }

  const response = await axios.get<NominatimSearchResult[]>('https://nominatim.openstreetmap.org/search', {
    params: {
      q: query,
      format: 'jsonv2',
      limit: 1,
      addressdetails: 1,
      ...(NOMINATIM_EMAIL ? { email: NOMINATIM_EMAIL } : {}),
    },
    headers: {
      'User-Agent': NOMINATIM_USER_AGENT,
      Referer: FRONTEND_URL,
      Accept: 'application/json',
    },
    timeout: 8000,
  });

  const result = response.data[0];
  const lat = Number(result?.lat);
  const lng = Number(result?.lon);
  const city = getClosestCity(result?.address);
  const coordinates = Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng, ...(city ? { city } : {}) }
    : null;
  nominatimCache.set(normalizedQuery, coordinates);
  return coordinates ?? undefined;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const geocodeStops = async (stops: RouteStop[], report?: ProgressReporter) => {
  const geocodedStops: RouteStop[] = [];

  for (const [index, stop] of stops.entries()) {
    const label = getStopSearchLabel(stop) || `стajалиште ${index + 1}`;
    report?.({
      step: 'geocode_started',
      message: `Проналазим прецизније координате за: ${label}`,
    });

    try {
      const coordinates = await fetchNominatimCoordinates(label);
      if (coordinates) {
        geocodedStops.push({ ...stop, ...coordinates, city: coordinates.city ?? stop.city });
        report?.({
          step: 'geocode_completed',
          message: `Координате су ажуриране за: ${label}`,
          percent: Math.round(((index + 1) / stops.length) * 100),
        });
      } else {
        geocodedStops.push(stop);
        report?.({
          step: 'geocode_failed',
          message: `Координате нису пронађене за: ${label}; користим AI координате.`,
          percent: Math.round(((index + 1) / stops.length) * 100),
        });
      }
    } catch (error) {
      console.error(`Error geocoding stop "${label}":`, error);
      geocodedStops.push(stop);
      report?.({
        step: 'geocode_failed',
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

const enrichStopsWithImages = async (stops: RouteStop[], report?: ProgressReporter) => {
  return Promise.all(
    stops.map(async (stop, index) => {
      const label = getStopSearchLabel(stop) || `стajалиште ${index + 1}`;

      if (stop.image) {
        report?.({
          step: 'image_completed',
          message: `Слика већ постоји за: ${label}`,
          percent: Math.round(((index + 1) / stops.length) * 100),
        });
        return stop;
      }

      report?.({
        step: 'image_started',
        message: `Проналазим слику за: ${label}`,
      });

      try {
        const image = await fetchWikipediaImage(getStopSearchLabel(stop));
        if (image) {
          report?.({
            step: 'image_completed',
            message: `Слика је пронађена за: ${label}`,
            percent: Math.round(((index + 1) / stops.length) * 100),
          });
          return { ...stop, image };
        }
        report?.({
          step: 'image_failed',
          message: `Слика није пронађена за: ${label}`,
          percent: Math.round(((index + 1) / stops.length) * 100),
        });
      } catch (error) {
        console.error(`Error fetching image for stop "${label}":`, error);
        report?.({
          step: 'image_failed',
          message: `Слика није могла да се учита за: ${label}`,
          percent: Math.round(((index + 1) / stops.length) * 100),
        });
      }

      return stop;
    }),
  );
};

// Middleware за аутентификацију
const auth = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('No token');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).send('Invalid token'); }
};

const getCookies = (header?: string) => Object.fromEntries(
  (header ?? '').split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [];
    return [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
  }),
);

const redirectToLogin = (res: express.Response, params: Record<string, string>) => {
  const query = new URLSearchParams(params);
  res.redirect(`${FRONTEND_URL}/login?${query.toString()}`);
};

app.get('/api/auth/google', (req, res) => {
  if (!googleOAuthClient) {
    return redirectToLogin(res, { error: 'Google authentication is not configured on the server.' });
  }

  const state = randomBytes(24).toString('hex');
  res.setHeader(
    'Set-Cookie',
    `${GOOGLE_STATE_COOKIE}=${encodeURIComponent(state)}; HttpOnly; Path=/api/auth/google; SameSite=Lax; Max-Age=600`,
  );

  const googleUrl = googleOAuthClient.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
  });

  res.redirect(googleUrl);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const storedState = getCookies(req.headers.cookie)[GOOGLE_STATE_COOKIE];

  if (error) {
    return redirectToLogin(res, { error: String(error) });
  }

  if (typeof code !== 'string' || typeof state !== 'string' || !storedState || state !== storedState) {
    return redirectToLogin(res, { error: 'Invalid Google authentication state.' });
  }

  if (!googleOAuthClient || !GOOGLE_CLIENT_ID) {
    return redirectToLogin(res, { error: 'Google authentication is not configured on the server.' });
  }

  try {
    const { tokens } = await googleOAuthClient.getToken(code);
    if (!tokens.id_token) {
      return redirectToLogin(res, { error: 'Google did not return an identity token.' });
    }

    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || payload.email_verified === false) {
      return redirectToLogin(res, { error: 'Google did not provide a verified email address.' });
    }

    let user = sqlite.prepare('SELECT * FROM users WHERE google_id = ?').get(payload.sub) as { id: number; username: string } | undefined;

    if (!user) {
      user = sqlite.prepare('SELECT * FROM users WHERE username = ?').get(payload.email) as { id: number; username: string } | undefined;
      if (user) {
        sqlite.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(payload.sub, user.id);
      }
    }

    if (!user) {
      const password = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
      const result = sqlite.prepare('INSERT INTO users (username, password, google_id) VALUES (?, ?, ?)').run(
        payload.email,
        password,
        payload.sub,
      );
      user = { id: Number(result.lastInsertRowid), username: payload.email };
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.setHeader('Set-Cookie', `${GOOGLE_STATE_COOKIE}=; HttpOnly; Path=/api/auth/google; SameSite=Lax; Max-Age=0`);
    return redirectToLogin(res, { token });
  } catch (oauthError) {
    console.error('Google authentication failed:', oauthError);
    return redirectToLogin(res, { error: 'Google authentication failed. Please try again.' });
  }
});

const fetchRoute = async (waypoints: string[]): Promise<[number, number][] | null> => {
  try {
    const response = await axios.get(`https://router.project-osrm.org/route/v1/driving/${waypoints.join(';')}?overview=full&geometries=geojson`);
    return response.data.routes[0].geometry.coordinates;
  } catch (error) {
    console.error('Error fetching route:', error);
    return null;
  }
};

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = sqlite.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (user && await bcrypt.compare(password, user.password)) {
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    res.json({ token });
  } else { res.status(401).send('Wrong credentials'); }
});

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send('Username and password are required.');
  }

  try {
    const existingUser = sqlite.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(409).send('Username already exists.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = sqlite.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashedPassword);

    res.status(201).json({ message: 'User registered successfully', userId: result.lastInsertRowid });
  } catch (error) {
    console.error('Error during user registration:', error);
    res.status(500).send('Internal server error.');
  }
});

app.post('/api/forgot-password', async (req, res) => {
  const { username } = req.body;

  try {
    const user = sqlite.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!user) {
      // For security, always respond with a generic success message
      // to avoid leaking information about existing usernames.
      return res.status(200).send('If a user with that username exists, a password reset link has been sent.');
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour expiry

    sqlite.prepare('UPDATE users SET resetToken = ?, resetTokenExpiry = ? WHERE id = ?').run(resetToken, resetTokenExpiry, user.id);

    console.log(`Password reset token for ${username}: ${resetToken}`);
    // In a real application, you would email this token to the user.
    // Example: sendEmail(user.email, resetTokenLink);

    res.status(200).send('If a user with that username exists, a password reset link has been sent.');
  } catch (error) {
    console.error('Error during forgot password request:', error);
    res.status(500).send('Internal server error.');
  }
});

app.post('/api/reset-password', async (req, res) => {
  const { username, token, newPassword } = req.body;

  if (!username || !token || !newPassword) {
    return res.status(400).send('Username, token, and new password are required.');
  }

  try {
    const user = sqlite.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

    if (!user || user.resetToken !== token || user.resetTokenExpiry < Date.now()) {
      return res.status(400).send('Invalid or expired reset token.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset token fields
    sqlite.prepare('UPDATE users SET password = ?, resetToken = NULL, resetTokenExpiry = NULL WHERE id = ?').run(hashedPassword, user.id);

    res.status(200).send('Password has been reset successfully.');
  } catch (error) {
    console.error('Error during password reset:', error);
    res.status(500).send('Internal server error.');
  }
});

app.post('/api/generate', auth, async (req: any, res) => {
  if (typeof req.body.prompt !== 'string' || !req.body.prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (event: GenerationEvent) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const sendProgress = (event: Omit<GenerationEvent, 'type'>) => {
    sendEvent({ type: 'progress', ...event });
  };

  try {
    sendProgress({ step: 'started', message: 'Покрећем планирање путовања.', percent: 0 });
    sendProgress({ step: 'ai_started', message: 'AI агент осмишљава руту.', percent: 10 });

    const completion = await client.chat.completions.create({
      messages: [
        { role: "system", content: "Ти си планер путовања. За свако стајалиште наведи назив места и најближи град. Опис и разлог посете објаснити у најмање 3 реченице и да се не понављају. Врати ИСКЉУЧИВО JSON: {\"title\": \"Наслов\", \"stops\": [{\"place\": \"Место\", \"city\": \"Најближи град\", \"lat\": 44, \"lng\": 20, \"description\": \"Опис\", \"reason\": \"Разлог\"}]}" },
        { role: "user", content: req.body.prompt }
      ],
      // model: "mistral-small-latest",
      model: "gemini-3-flash-preview",
      response_format: { type: "json_object" },
    });
    sendProgress({ step: 'ai_completed', message: 'AI агент је направио предлог руте.', percent: 35 });

    let routeData: RouteData;

    try {
      routeData = JSON.parse(completion.choices[0].message.content || '{}') as RouteData;
    } catch (error) {
      console.error('Error parsing route data:', error);
      console.log(completion);
      throw new Error('AI није вратио исправан формат руте.');
    }

    if (!routeData.title || !Array.isArray(routeData.stops)) {
      throw new Error('AI није вратио валидне податке о рути.');
    }

    const generatedStops = routeData.stops;
    sendProgress({
      step: 'geocoding_started',
      message: `Проверавам координате за ${generatedStops.length} стајалишта.`,
      percent: 35,
    });
    const geocodedStops = await geocodeStops(generatedStops, (event) => {
      sendProgress({
        ...event,
        percent: event.percent === undefined ? 35 : 35 + Math.round(event.percent * 0.1),
      });
    });
    sendProgress({ step: 'geocoding_completed', message: 'Координате су проверене преко Nominatim-а.', percent: 45 });

    sendProgress({
      step: 'images_started',
      message: `Обогаћујем ${geocodedStops.length} стајалишта сликама.`,
      percent: 50,
    });
    const stops = await enrichStopsWithImages(geocodedStops, (event) => {
      sendProgress({
        ...event,
        percent: event.percent === undefined ? 50 : 50 + Math.round(event.percent * 0.3),
      });
    });
    sendProgress({ step: 'images_completed', message: 'Обогаћивање сликама је завршено.', percent: 80 });

    sendProgress({ step: 'route_started', message: 'Израчунавам путну трасу.', percent: 85 });
    const waypoints = stops.map(stop => `${stop.lng},${stop.lat}`);
    const routeCoordinates = await fetchRoute(waypoints);
    if (!routeCoordinates) {
      sendProgress({ step: 'route_warning', message: 'Путна траса није доступна, али рута може бити сачувана.', percent: 90 });
    } else {
      sendProgress({ step: 'route_completed', message: 'Путна траса је израчуната.', percent: 90 });
    }

    sendProgress({ step: 'saving_started', message: 'Чувам руту.', percent: 95 });
    const result = await db.insert(schema.routes).values({
      userId: req.user.userId,
      title: routeData.title,
      destination: req.body.prompt,
      data: JSON.stringify(stops),
      path: JSON.stringify((routeCoordinates ?? []).map(coord => [coord[1], coord[0]]))
    }).returning();
    sendEvent({ type: 'complete', step: 'completed', message: 'Путовање је успешно испланирано.', percent: 100, route: result[0] });
  } catch (error) {
    console.error('Error generating route:', error);
    sendEvent({
      type: 'error',
      step: 'failed',
      message: error instanceof Error ? error.message : 'Генерисање руте није успело.',
    });
  } finally {
    res.end();
  }
});

app.get('/api/routes', auth, async (req: any, res) => {
  try {
    const result = await db.select({
      id: schema.routes.id,
      userId: schema.routes.userId,
      title: schema.routes.title,
      destination: schema.routes.destination,
      createdAt: schema.routes.createdAt
    }).from(schema.routes)
      .where(eq(schema.routes.userId, req.user.userId))
      .orderBy(desc(schema.routes.createdAt));
    res.json(result);
  } catch (error) {
    console.error('Error fetching routes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/routes/:id', auth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const result = await db.select().from(schema.routes)
      .where(eq(schema.routes.id, id))
      .limit(1);

    if (result.length === 0) {
      return res.status(404).json({ error: 'Route not found' });
    }

    res.json(result[0]);
  } catch (error) {
    console.error('Error fetching route details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/routes/:id', auth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const result = await db.delete(schema.routes)
      .where(eq(schema.routes.id, id))
      .returning();
    if (result.length === 0) {
      return res.status(404).json({ error: 'Route not found' });
    }
    res.json({ message: 'Route removed from history' });
  } catch (error) {
    console.error('Error removing route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(3000, () => console.log('Backend running on port 3000'));
