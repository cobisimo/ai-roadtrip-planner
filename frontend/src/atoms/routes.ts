import { atom, useAtom } from 'jotai';

export const routesAtom = atom<any[]>([]);
export const activeRouteAtom = atom<any[] | null>(null);
export const routeCoordinatesAtom = atom<any[] | null>(null);

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tokenAtom } from '../atoms/auth';

export function useRoutes() {
  const [token] = useAtom(tokenAtom);
  const [, setRoutes] = useAtom(routesAtom);
  const [, setActiveRoute] = useAtom(activeRouteAtom);
  const [, setRouteCoordinates] = useAtom(routeCoordinatesAtom);
  const queryClient = useQueryClient();

  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const response = await fetch(`http://localhost:3000/api${url}`, {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json();
  };

  const { data: routes, isLoading: isLoadingRoutes } = useQuery({
    queryKey: ['routes'],
    queryFn: async () => {
      const data = await fetchWithAuth('/routes');
      setRoutes(data);
      return data;
    },
    enabled: !!token,
  });

  const createRouteMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const data = await fetchWithAuth('/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      });
      return data;
    },
    onSuccess: (data) => {
      const stops = JSON.parse(data.data);
      const path = JSON.parse(data.path);
      setActiveRoute(stops);
      setRouteCoordinates(path);
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
  });

  const deleteRouteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetchWithAuth(`/routes/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routes'] });
    },
  });

  const getRouteDetailsMutation = useMutation({
    mutationFn: async (routeId: number) => {
      const data = await fetchWithAuth(`/routes/${routeId}`);
      return data;
    },
    onSuccess: (data) => {
      const stops = JSON.parse(data.data);
      const path = JSON.parse(data.path);
      setActiveRoute(stops);
      setRouteCoordinates(path);
    },
  });

  return {
    routes,
    isLoadingRoutes,
    createRoute: createRouteMutation.mutate,
    isCreatingRoute: createRouteMutation.isPending,
    deleteRoute: deleteRouteMutation.mutate,
    isDeletingRoute: deleteRouteMutation.isPending,
    getRouteDetails: getRouteDetailsMutation.mutate,
    isGettingRouteDetails: getRouteDetailsMutation.isPending,
  };
}
