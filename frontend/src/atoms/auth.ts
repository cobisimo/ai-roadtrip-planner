
import { atomWithStorage } from 'jotai/utils'
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { useAtom } from 'jotai';

export const tokenAtom = atomWithStorage('token', '');

const loginUser = async (credentials: { username: string; password: string }) => {
  const res = await axios.post('http://localhost:3000/api/login', credentials);
  return res.data.token;
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
    login: loginMutation.mutate,
    isLoading: loginMutation.isPending,
    error: loginMutation.error,
  };
}
