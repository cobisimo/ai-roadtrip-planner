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
const JWT_SECRET = 'm3_chip_power_123';

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

const normalizeThumbnailUrl = (url?: string) => {
  if (!url) return undefined;
  return url.replace('60px', '500px').replace('//', 'https://');
};

const getStopSearchLabel = (stop: RouteStop) => stop.place?.trim() || stop.city?.trim() || '';

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

const enrichStopsWithImages = async (stops: RouteStop[]) => {
  return Promise.all(
    stops.map(async (stop) => {
      if (stop.image) {
        return stop;
      }

      try {
        const image = await fetchWikipediaImage(getStopSearchLabel(stop));
        if (image) {
          return { ...stop, image };
        }
      } catch (error) {
        console.error(`Error fetching image for stop "${getStopSearchLabel(stop)}":`, error);
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

const fetchRoute = async (waypoints: string[]) => {
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
  try {
    const completion = await client.chat.completions.create({
      messages: [
        { role: "system", content: "Ти си планер путовања. Опис и разлог посете објаснити у најмање 3 реченице и да се не понављају. Врати ИСКЉУЧИВО JSON: {\"title\": \"Наслов\", \"stops\": [{\"place\": \"Место\", \"lat\": 44, \"lng\": 20, \"description\": \"Опис\", \"reason\": \"Разлог\"}]}" },
        { role: "user", content: req.body.prompt }
      ],
      // model: "mistral-small-latest",
      model: "gemini-3-flash-preview",
      response_format: { type: "json_object" },
    });

    let routeData: RouteData;

    try {
      routeData = JSON.parse(completion.choices[0].message.content || '{}') as RouteData;
    } catch (error) {
      console.error('Error parsing route data:', error);
      console.log(completion);
      return res.status(500).send('Error parsing route data');
    }

    const stops = await enrichStopsWithImages(routeData.stops ?? []);
    const waypoints = stops.map(stop => `${stop.lng},${stop.lat}`);
    const routeCoordinates = await fetchRoute(waypoints);

    const result = await db.insert(schema.routes).values({
      userId: req.user.userId,
      title: routeData.title,
      destination: req.body.prompt,
      data: JSON.stringify(stops),
      path: JSON.stringify((routeCoordinates ?? []).map(coord => [coord[1], coord[0]]))
    }).returning();
    res.json(result[0]);
  } catch (e) { res.status(500).send(e); }
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
