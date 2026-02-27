import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const SECRET_KEY = process.env.JWT_SECRET || 'moja_super_tajna_123';

export interface AuthRequest extends Request {
  user?: { userId: number; username: string };
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Приступ одбијен' });

  try {
    const decoded = jwt.verify(token, SECRET_KEY) as { userId: number; username: string };
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Неважећи токен' });
  }
};
