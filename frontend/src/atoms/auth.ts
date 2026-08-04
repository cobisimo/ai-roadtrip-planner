
import { atomWithStorage } from 'jotai/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';

export const tokenAtom = atomWithStorage<string | null>('token', null);

type LoginCredentials = {
  email: string;
  password: string;
};

type RegisterCredentials = LoginCredentials;

type ForgotPasswordPayload = {
  email: string;
};

type ResetPasswordPayload = {
  email: string;
  token: string;
  newPassword: string;
};

export const AUTH_API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export type CurrentUser = {
  userId: number;
  email: string;
  role: 'user' | 'admin';
  plan: 'free' | 'paid_10' | 'paid_50' | 'paid_100' | null;
  dailyLimit: number;
  usageDate: string | null;
  usageCount: number;
};

export type UserPlan = Exclude<CurrentUser['plan'], null>;

const startGoogleAuth = () => {
  window.location.assign(`${AUTH_API_URL}/auth/google`);
};

const requestAuth = async <T>(path: string, body: unknown) => {
  const response = await fetch(`${AUTH_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(
      typeof payload === 'string'
        ? payload
        : payload && typeof payload === 'object' && 'message' in payload
          ? String(payload.message)
          : 'Захтев за аутентификацију није успео.',
    );
  }

  return payload as T;
};

const loginUser = async (credentials: LoginCredentials) => {
  const data = await requestAuth<{ token: string }>('/login', credentials);
  return data.token;
};

const registerUser = async (credentials: RegisterCredentials) => {
  return requestAuth<{ message: string; userId: number }>('/register', credentials);
};

const forgotPassword = async (payload: ForgotPasswordPayload) => {
  return requestAuth<string>('/forgot-password', payload);
};

const resetPassword = async (payload: ResetPasswordPayload) => {
  return requestAuth<string>('/reset-password', payload);
};

const fetchCurrentUser = async (token: string) => {
  const response = await fetch(`${AUTH_API_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Тренутног корисника није могуће учитати.');
  return response.json() as Promise<CurrentUser>;
};

export function useCurrentUser() {
  const [token] = useAtom(tokenAtom);

  return useQuery({
    queryKey: ['current-user', token],
    queryFn: () => fetchCurrentUser(token as string),
    enabled: Boolean(token),
  });
}

export function useUpgradePlan() {
  const [token] = useAtom(tokenAtom);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (plan: UserPlan) => {
      const response = await fetch(`${AUTH_API_URL}/me/plan`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Активирање плана није успело.');
      return payload as CurrentUser;
    },
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: ['current-user', token] });
      queryClient.setQueryData(['current-user', token], user);
    },
  });

  return {
    upgradePlan: mutation.mutateAsync,
    isUpgrading: mutation.isPending,
  };
}

export function useAuth() {
  const [, setToken] = useAtom(tokenAtom);

  const loginMutation = useMutation({
    mutationFn: loginUser,
    onSuccess: (token: string) => {
      setToken(token);
    },
  });

  const registerMutation = useMutation({
    mutationFn: registerUser,
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: forgotPassword,
  });

  const resetPasswordMutation = useMutation({
    mutationFn: resetPassword,
  });

  return {
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    forgotPassword: forgotPasswordMutation.mutateAsync,
    resetPassword: resetPasswordMutation.mutateAsync,
    startGoogleAuth,
    isLoading:
      loginMutation.isPending ||
      registerMutation.isPending ||
      forgotPasswordMutation.isPending ||
      resetPasswordMutation.isPending,
  };
}
