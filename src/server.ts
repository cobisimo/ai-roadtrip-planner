import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
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

// Руте
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = sqlite.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (user && await bcrypt.compare(password, user.password)) {
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    res.json({ token });
  } else { res.status(401).send('Wrong credentials'); }
});

app.post('/api/generate', auth, async (req: any, res) => {
  try {
    const completion = await client.chat.completions.create({
      messages: [
        { role: "system", content: "Ти си планер путовања. Опис и разлог посете објаснити у најмање 3 реченице и да се не понављају. Врати ИСКЉУЧИВО JSON: {\"title\": \"Наслов\", \"stops\": [{\"city\": \"Град\", \"lat\": 44, \"lng\": 20, \"description\": \"Опис\", \"reason\": \"Разлог\"}]}" },
        { role: "user", content: req.body.prompt }
      ],
      // model: "mistral-small-latest",
      model: "gemini-3-flash-preview",
      response_format: { type: "json_object" },
    });

    const routeData = JSON.parse(completion.choices[0].message.content || '{}');
    const waypoints = routeData.stops.map(stop => `${stop.lng},${stop.lat}`);
    const routeCoordinates = await fetchRoute(waypoints);

    const result = await db.insert(schema.routes).values({
      userId: req.user.userId,
      title: routeData.title,
      destination: req.body.prompt,
      data: JSON.stringify(routeData.stops),
      path: JSON.stringify(routeCoordinates.map(coord => [coord[1], coord[0]]))
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
