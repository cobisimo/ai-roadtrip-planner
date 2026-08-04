import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  googleId: text('google_id').unique(),
  role: text('role').notNull().default('user'),
  plan: text('plan').notNull().default('free'),
  dailyLimit: integer('daily_limit').notNull().default(3),
  usageDate: text('usage_date'),
  usageCount: integer('usage_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export const routes = sqliteTable('routes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  title: text('title').notNull(),
  destination: text('destination').notNull(),
  data: text('data').notNull(),
  path: text('path'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
