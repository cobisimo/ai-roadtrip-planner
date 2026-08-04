import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { AUTH_API_URL, tokenAtom } from './auth';

export type AdminStats = {
  totalUsers: number;
  freeUsers: number;
  paidUsers: number;
  adminUsers: number;
  requestsToday: number;
  totalRoutes: number;
  routesToday: number;
};

export type AdminUser = {
  id: number;
  email: string;
  role: 'user' | 'admin';
  plan: 'free' | 'paid_10' | 'paid_50' | 'paid_100' | null;
  dailyLimit: number;
  usageDate: string | null;
  usageCount: number;
  totalRoutes: number;
  createdAt: number | null;
};

type UpdateUserInput = {
  userId: number;
  role: AdminUser['role'];
  plan: AdminUser['plan'];
};

const useAdminRequest = () => {
  const [token] = useAtom(tokenAtom);

  return async <T>(path: string, options: RequestInit = {}) => {
    const response = await fetch(`${AUTH_API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || 'Администраторски захтев није успео.');
    }
    return payload as T;
  };
};

export function useAdminData() {
  const request = useAdminRequest();
  const queryClient = useQueryClient();

  const statsQuery = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => request<AdminStats>('/admin/stats'),
  });
  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => request<AdminUser[]>('/admin/users'),
  });
  const updateUserMutation = useMutation({
    mutationFn: ({ userId, role, plan }: UpdateUserInput) => request<AdminUser>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role, plan }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  return {
    stats: statsQuery.data,
    users: usersQuery.data,
    isLoading: statsQuery.isLoading || usersQuery.isLoading,
    error: statsQuery.error || usersQuery.error,
    updateUser: updateUserMutation.mutateAsync,
    updatingUserId: updateUserMutation.variables?.userId,
  };
}
