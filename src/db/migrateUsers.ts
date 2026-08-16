import { sqlite } from "./client.js";

// Create the current schema when the database is new. Existing tables are
// left untouched so the column migrations below can upgrade older databases.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    google_id TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'user',
    plan TEXT NOT NULL DEFAULT 'free',
    daily_limit INTEGER NOT NULL DEFAULT 3,
    usage_date TEXT,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    title TEXT NOT NULL,
    destination TEXT NOT NULL,
    data TEXT NOT NULL,
    path TEXT,
    created_at INTEGER
  );
`);

const userColumns = sqlite.prepare("PRAGMA table_info(users)").all() as Array<{
  name: string;
}>;

if (
  !userColumns.some((column) => column.name === "email") &&
  userColumns.some((column) => column.name === "username")
) {
  sqlite.exec("ALTER TABLE users RENAME COLUMN username TO email");
}

const addUserColumn = (name: string, definition: string) => {
  if (!userColumns.some((column) => column.name === name)) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  }
};

addUserColumn("google_id", "TEXT");
addUserColumn("role", "TEXT NOT NULL DEFAULT 'user'");
addUserColumn("plan", "TEXT NOT NULL DEFAULT 'free'");
addUserColumn("daily_limit", "INTEGER NOT NULL DEFAULT 3");
addUserColumn("usage_date", "TEXT");
addUserColumn("usage_count", "INTEGER NOT NULL DEFAULT 0");
addUserColumn("created_at", "INTEGER");
sqlite.exec(
  "UPDATE users SET role = 'user' WHERE role IS NULL OR role IN ('free', 'paid')",
);

const adminEmail = (process.env.ADMIN_EMAIL ?? process.env.ADMIN_USERNAME)?.trim();
if (adminEmail) {
  sqlite
    .prepare(
      "UPDATE users SET role = 'admin', plan = '', daily_limit = 0 WHERE email = ?",
    )
    .run(adminEmail);
}
