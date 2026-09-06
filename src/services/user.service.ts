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
  email: string;
  role: UserRole;
  plan: UserPlan;
  dailyLimit: number;
  usageDate: string | null;
  usageCount: number;
};

type StoredUser = {
  id: number;
  email: string;
  role: string;
  plan: string;
  daily_limit: number;
  usage_date: string | null;
  usage_count: number;
};

export class UserService {
  getPlanLimit(plan: UserPlan) {
    return plan === "none" ? 0 : (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free);
  }

  getUserById(userId: number): AuthenticatedUser | undefined {
    const user = sqlite
      .prepare("SELECT id, email, role, plan, daily_limit, usage_date, usage_count FROM users WHERE id = ?")
      .get(userId) as StoredUser | undefined;

    if (!user) return undefined;
    const role: UserRole = user.role === "admin" ? "admin" : "user";
    const plan: UserPlan = role === "admin" ? "none" : (user.plan as UserPlan);

    return {
      userId: user.id,
      email: user.email,
      role,
      plan,
      dailyLimit: this.getPlanLimit(plan),
      usageDate: user.usage_date,
      usageCount: user.usage_count,
    };
  }

  toPublicUser(user: AuthenticatedUser | undefined) {
    return user && { ...user, plan: user.role === "admin" ? null : user.plan };
  }

  consumeGenerationQuota(userId: number) {
    const user = this.getUserById(userId);
    if (!user) return { allowed: false, reason: "Корисник није пронађен." };
    if (user.role === "admin") return { allowed: true, remaining: null, limit: null, resetAt: null };

    const today = new Date().toISOString().slice(0, 10);
    const usageCount = user.usageDate === today ? user.usageCount : 0;
    const limit = this.getPlanLimit(user.plan);
    if (usageCount >= limit) {
      return {
        allowed: false,
        reason: `Достигнут је дневни лимит захтева (${limit}).`,
        remaining: 0,
        limit,
        resetAt: this.getNextResetAt(),
      };
    }

    const nextUsageCount = usageCount + 1;
    sqlite.prepare("UPDATE users SET usage_date = ?, usage_count = ? WHERE id = ?").run(today, nextUsageCount, userId);
    return { allowed: true, remaining: limit - nextUsageCount, limit, resetAt: this.getNextResetAt() };
  }

  private getNextResetAt() {
    const reset = new Date();
    reset.setUTCHours(24, 0, 0, 0);
    return reset.toISOString();
  }
}

export const userService = new UserService();
