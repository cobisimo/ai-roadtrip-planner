import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getUserById, type AuthenticatedUser } from "../services/users.js";

const jwtSecret = process.env.JWT_SECRET || "m3_chip_power_123";

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

export const auth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).send("Недостаје токен.");
  try {
    const decoded = jwt.verify(token, jwtSecret) as { userId: number };
    const user = getUserById(decoded.userId);
    if (!user) return res.status(401).send("Корисник није пронађен.");
    req.user = user;
    next();
  } catch {
    res.status(401).send("Неважећи токен.");
  }
};

export const adminOnly = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Потребан је администраторски приступ." });
  next();
};

export const nonAdminOnly = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.user?.role === "admin") return res.status(403).json({ error: "Администратори имају приступ само административним функцијама." });
  next();
};
