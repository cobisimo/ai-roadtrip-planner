import type { RequestHandler } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { sqlite } from "../db/client.js";

const jwtSecret = process.env.JWT_SECRET || "m3_chip_power_123";
const genericResetResponse =
  "Ако корисник са тим именом постоји, линк за ресетовање лозинке је послат.";

export const login: RequestHandler = async (req, res) => {
  const { username, password } = req.body;
  const user = sqlite.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
  if (user && (await bcrypt.compare(password, user.password))) {
    return res.json({ token: jwt.sign({ userId: user.id }, jwtSecret) });
  }
  res.status(401).send("Погрешни подаци за пријаву.");
};

export const register: RequestHandler = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send("Корисничко име и лозинка су обавезни.");
  }
  try {
    const existingUser = sqlite.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (existingUser) return res.status(409).send("Корисничко име већ постоји.");

    const result = sqlite
      .prepare("INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)")
      .run(username, await bcrypt.hash(password, 10), Date.now());
    res.status(201).json({ message: "Корисник је успешно регистрован.", userId: result.lastInsertRowid });
  } catch (error) {
    console.error("Error during user registration:", error);
    res.status(500).send("Интерна грешка сервера.");
  }
};

export const forgotPassword: RequestHandler = async (req, res) => {
  const { username } = req.body;
  try {
    const user = sqlite.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
    if (!user) return res.status(200).send(genericResetResponse);

    const resetToken = randomBytes(32).toString("hex");
    sqlite
      .prepare("UPDATE users SET resetToken = ?, resetTokenExpiry = ? WHERE id = ?")
      .run(resetToken, Date.now() + 3_600_000, user.id);
    console.log(`Password reset token for ${username}: ${resetToken}`);
    res.status(200).send(genericResetResponse);
  } catch (error) {
    console.error("Error during forgot password request:", error);
    res.status(500).send("Интерна грешка сервера.");
  }
};

export const resetPassword: RequestHandler = async (req, res) => {
  const { username, token, newPassword } = req.body;
  if (!username || !token || !newPassword) {
    return res.status(400).send("Корисничко име, токен и нова лозинка су обавезни.");
  }
  try {
    const user = sqlite.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
    if (!user || user.resetToken !== token || user.resetTokenExpiry < Date.now()) {
      return res.status(400).send("Ресет токен је неважећи или је истекао.");
    }

    sqlite
      .prepare("UPDATE users SET password = ?, resetToken = NULL, resetTokenExpiry = NULL WHERE id = ?")
      .run(await bcrypt.hash(newPassword, 10), user.id);
    res.status(200).send("Лозинка је успешно ресетована.");
  } catch (error) {
    console.error("Error during password reset:", error);
    res.status(500).send("Интерна грешка сервера.");
  }
};
