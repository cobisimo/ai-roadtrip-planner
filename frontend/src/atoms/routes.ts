import { atom, useAtom } from 'jotai';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tokenAtom } from '../atoms/auth';

export type RouteStop = {
  city: string;
  lat: number;
  lng: number;
  description: string;
  reason: string;
  image?: string;
};

export type RouteCoordinate = [number, number];

export type SavedRoute = {
  id: number;
  title: string;
  destination: string;
  data: string;
  path: string;
};

export const routesAtom = atom<SavedRoute[]>([]);
export const activeRouteAtom = atom<RouteStop[] | null>(null);
export const routeCoordinatesAtom = atom<RouteCoordinate[] | null>(null);

const parseStops = (value: string) => JSON.parse(value) as RouteStop[];
const parsePath = (value: string) => JSON.parse(value) as RouteCoordinate[];

export function useRoutes() {
  const [token] = useAtom(tokenAtom);
  const [, setRoutes] = useAtom(routesAtom);
  const [, setActiveRoute] = useAtom(activeRouteAtom);
  const [, setRouteCoordinates] = useAtom(routeCoordinatesAtom);
  const queryClient = useQueryClient();

  const fetchWithAuth = async <T>(url: string, options: RequestInit = {}) => {
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

    return response.json() as Promise<T>;
  };

  const { data: routes, isLoading: isLoadingRoutes } = useQuery({
    queryKey: ['routes'],
    queryFn: async () => {
      const data = await fetchWithAuth<SavedRoute[]>('/routes');
      setRoutes(data);
      return data;
    },
    enabled: !!token,
  });

  const createRouteMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const data = await fetchWithAuth<SavedRoute>('/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      });
      return data;
    },
    onSuccess: (data) => {
      const stops = parseStops(data.data);
      const path = parsePath(data.path);
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
      const data = await fetchWithAuth<SavedRoute>(`/routes/${routeId}`);
      return data;
    },
    onSuccess: (data) => {
      const stops = parseStops(data.data);
      const path = parsePath(data.path);
      setActiveRoute(stops);
      setRouteCoordinates(path);
    },
  });

  return {
    routes,
    isLoadingRoutes,
    createRoute: createRouteMutation.mutateAsync,
    isCreatingRoute: createRouteMutation.isPending,
    deleteRoute: deleteRouteMutation.mutateAsync,
    isDeletingRoute: deleteRouteMutation.isPending,
    getRouteDetails: getRouteDetailsMutation.mutateAsync,
    isGettingRouteDetails: getRouteDetailsMutation.isPending,
  };
}
