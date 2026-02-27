import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import bcrypt from 'bcryptjs';

const sqlite = new Database('roadtrip.db');
const db = drizzle(sqlite, { schema });

async function seed() {
  console.log('🌱 Попуњавам базу подацима...');

  const hashedPassword = await bcrypt.hash('lozinka123', 10);

  try {
    await db.insert(schema.users).values({
      username: 'test_putnik',
      password: hashedPassword,
    });
    console.log('✅ Корисник "test_putnik" је креиран. Лозинка: lozinka123');
  } catch (e) {
    console.log('⚠️ Корисник вероватно већ постоји у бази.');
  }

  sqlite.close();
}

seed();
