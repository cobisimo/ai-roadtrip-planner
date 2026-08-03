import { sqlite } from "./client.js";

const userColumns = sqlite.prepare("PRAGMA table_info(users)").all() as Array<{
  name: string;
}>;

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

if (process.env.ADMIN_USERNAME?.trim()) {
  sqlite
    .prepare(
      "UPDATE users SET role = 'admin', plan = '', daily_limit = 0 WHERE username = ?",
    )
    .run(process.env.ADMIN_USERNAME.trim());
}
