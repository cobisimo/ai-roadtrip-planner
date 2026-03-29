
import { atomWithStorage } from 'jotai/utils'
import { useMutation } from '@tanstack/react-query';
import { useAtom } from 'jotai';

export const tokenAtom = atomWithStorage<string | null>('token', null);

const loginUser = async (credentials: { username: string; password: string }) => {
  const response = await fetch('http://localhost:3000/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    throw new Error('Login failed');
  }

  const data = await response.json();
  return data.token;
};

export function useAuth() {
  const [, setToken] = useAtom(tokenAtom);

  const loginMutation = useMutation({
    mutationFn: loginUser,
    onSuccess: (token: string) => {
      setToken(token);
    },
  });

  return {
    login: loginMutation.mutateAsync,
    isLoading: loginMutation.isPending,
    error: loginMutation.error,
  };
}
