// Backwards-compatible export for code that still imports `src/auth.ts`.
export { auth as authMiddleware } from "./middleware/auth.js";
export type { AuthenticatedRequest as AuthRequest } from "./middleware/auth.js";
