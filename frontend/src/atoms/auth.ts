
import { atomWithStorage } from 'jotai/utils'
import { useMutation } from '@tanstack/react-query';
import { useAtom } from 'jotai';

export const tokenAtom = atomWithStorage<string | null>('token', null);

type LoginCredentials = {
  username: string;
  password: string;
};

type RegisterCredentials = LoginCredentials;

type ForgotPasswordPayload = {
  username: string;
};

type ResetPasswordPayload = {
  username: string;
  token: string;
  newPassword: string;
};

const AUTH_API_URL = 'http://localhost:3000/api';

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
          : 'Authentication request failed.',
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
    isLoading:
      loginMutation.isPending ||
      registerMutation.isPending ||
      forgotPasswordMutation.isPending ||
      resetPasswordMutation.isPending,
  };
}
