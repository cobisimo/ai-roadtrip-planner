import bcrypt from 'bcryptjs';
import { sqlite } from './client.js';
import './migrateUsers.js';

const users = [
  { email: 'admin@example.com', password: 'admin123', role: 'admin', plan: 'none', dailyLimit: 0 },
  { email: 'free@example.com', password: 'free123', role: 'user', plan: 'free', dailyLimit: 3 },
  { email: 'paid@example.com', password: 'paid123', role: 'user', plan: 'paid_10', dailyLimit: 10 },
] as const;

async function seed() {
  console.log('🌱 Попуњавам базу подацима...');

  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password, 10);
    sqlite
      .prepare(
        `INSERT INTO users (email, password, role, plan, daily_limit, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           password = excluded.password,
           role = excluded.role,
           plan = excluded.plan,
           daily_limit = excluded.daily_limit`,
      )
      .run(user.email, hashedPassword, user.role, user.plan, user.dailyLimit, Date.now());
    console.log(`✅ ${user.email} (${user.role}, ${user.plan})`);
  }

  sqlite.close();
}

seed();
