import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './db/schema.js';
import { eq, desc } from 'drizzle-orm';

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

const client = new OpenAI({
  baseURL: 'http://localhost:8080/v1',
  apiKey: 'local-no-key',
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
        { role: "system", content: "Ти си планер путовања. Врати ИСКЉУЧИВО JSON: {\"title\": \"Наслов\", \"stops\": [{\"city\": \"Град\", \"lat\": 44, \"lng\": 20, \"description\": \"Опис\", \"reason\": \"Разлог\"}]}" },
        { role: "user", content: req.body.prompt }
      ],
      model: "llama-3",
      response_format: { type: "json_object" }
    });

    const routeData = JSON.parse(completion.choices[0].message.content || '{}');
    const result = await db.insert(schema.routes).values({
      userId: req.user.userId,
      title: routeData.title,
      destination: req.body.prompt,
      data: JSON.stringify(routeData.stops)
    }).returning();
    res.json(result[0]);
  } catch (e) { res.status(500).send(e); }
});

app.get('/api/routes', auth, async (req: any, res) => {
  const result = await db.select().from(schema.routes)
    .where(eq(schema.routes.userId, req.user.userId))
    .orderBy(desc(schema.routes.createdAt));
  res.json(result);
});

app.listen(3000, () => console.log('Backend running on port 3000'));
