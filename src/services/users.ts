import { sqlite } from "../db/client.js";

export type UserRole = "user" | "admin";
export type UserPlan = "free" | "paid_10" | "paid_50" | "paid_100" | "none";

export const PLAN_LIMITS: Record<Exclude<UserPlan, "none">, number> = {
  free: 3,
  paid_10: 10,
  paid_50: 50,
  paid_100: 100,
};
export const USER_PLANS = ["free", "paid_10", "paid_50", "paid_100"] as const;

export type AuthenticatedUser = {
  userId: number;
  username: string;
  role: UserRole;
  plan: UserPlan;
  dailyLimit: number;
  usageDate: string | null;
  usageCount: number;
};

export const getPlanLimit = (plan: UserPlan) =>
  plan === "none" ? 0 : (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free);

export const getUserById = (userId: number): AuthenticatedUser | undefined => {
  const user = sqlite
    .prepare(
      "SELECT id, username, role, plan, daily_limit, usage_date, usage_count FROM users WHERE id = ?",
    )
    .get(userId) as
    | {
        id: number;
        username: string;
        role: string;
        plan: string;
        daily_limit: number;
        usage_date: string | null;
        usage_count: number;
      }
    | undefined;

  if (!user) return undefined;
  const role: UserRole = user.role === "admin" ? "admin" : "user";
  const plan: UserPlan = role === "admin" ? "none" : (user.plan as UserPlan);

  return {
    userId: user.id,
    username: user.username,
    role,
    plan,
    dailyLimit: getPlanLimit(plan),
    usageDate: user.usage_date,
    usageCount: user.usage_count,
  };
};

export const toPublicUser = (user: AuthenticatedUser | undefined) =>
  user && { ...user, plan: user.role === "admin" ? null : user.plan };

const getToday = () => new Date().toISOString().slice(0, 10);
const getNextResetAt = () => {
  const reset = new Date();
  reset.setUTCHours(24, 0, 0, 0);
  return reset.toISOString();
};

export const consumeGenerationQuota = (userId: number) => {
  const user = getUserById(userId);
  if (!user) return { allowed: false, reason: "Корисник није пронађен." };
  if (user.role === "admin")
    return { allowed: true, remaining: null, limit: null, resetAt: null };

  const today = getToday();
  const usageCount = user.usageDate === today ? user.usageCount : 0;
  const limit = getPlanLimit(user.plan);
  if (usageCount >= limit) {
    return { allowed: false, reason: `Достигнут је дневни лимит захтева (${limit}).`, remaining: 0, limit, resetAt: getNextResetAt() };
  }

  const nextUsageCount = usageCount + 1;
  sqlite.prepare("UPDATE users SET usage_date = ?, usage_count = ? WHERE id = ?")
    .run(today, nextUsageCount, userId);
  return { allowed: true, remaining: limit - nextUsageCount, limit, resetAt: getNextResetAt() };
};
