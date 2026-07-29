import { atom, useAtom } from 'jotai';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tokenAtom } from '../atoms/auth';

export type RouteStop = {
  place: string;
  city?: string;
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

export type GenerationProgress = {
  step: string;
  message: string;
  percent?: number;
};

export class GenerationLimitError extends Error {
  readonly limit: number | null;
  readonly resetAt: string | null;

  constructor(message: string, limit: number | null, resetAt: string | null) {
    super(message);
    this.name = 'GenerationLimitError';
    this.limit = limit;
    this.resetAt = resetAt;
  }
}

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
      throw new Error(`Захтев није успео (статус ${response.status}).`);
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

  type GenerateRouteInput = {
    prompt: string;
    onProgress?: (progress: GenerationProgress) => void;
  };

  const createRouteMutation = useMutation({
    mutationFn: async ({ prompt, onProgress }: GenerateRouteInput) => {
      const response = await fetch(`http://localhost:3000/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const responseText = await response.text();
        let message = responseText;
        let payload: { error?: string; limit?: number | null; resetAt?: string | null } | null = null;
        try {
          payload = JSON.parse(responseText) as { error?: string; limit?: number | null; resetAt?: string | null };
          message = payload.error || responseText;
        } catch {
          // Keep the raw response when the server did not return JSON.
        }
        if (response.status === 429) {
          throw new GenerationLimitError(message || 'Достигнут је дневни лимит захтева.', payload?.limit ?? null, payload?.resetAt ?? null);
        }
        throw new Error(message || `Захтев није успео (статус ${response.status}).`);
      }

      if (!response.body) {
        throw new Error('Сервер није вратио ток напретка.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completedRoute: SavedRoute | undefined;

      const processEvent = (rawEvent: string) => {
        const lines = rawEvent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        let eventType = 'message';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice('event:'.length).trim();
          } else if (line.startsWith('data:')) {
            eventData += line.slice('data:'.length).trim();
          }
        }

        if (!eventData) return;

        const event = JSON.parse(eventData) as {
          type: string;
          step?: string;
          message?: string;
          percent?: number;
          route?: SavedRoute;
        };

        const resolvedEventType = eventType === 'message' ? event.type : eventType;

        if (resolvedEventType === 'progress' && event.step && event.message) {
          onProgress?.({ step: event.step, message: event.message, percent: event.percent });
        }

        if (resolvedEventType === 'error') {
          throw new Error(event.message || 'Генерисање руте није успело.');
        }

        if (resolvedEventType === 'complete' && event.route) {
          completedRoute = event.route;
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';

          for (const rawEvent of events) {
            processEvent(rawEvent);
          }

          if (done) break;
        }

        if (buffer.trim()) {
          processEvent(buffer);
        }
      } finally {
        reader.releaseLock();
      }

      if (!completedRoute) {
        throw new Error('Ток генерисања руте је завршен пре него што је процес довршен.');
      }

      return completedRoute;
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
    createRoute: (prompt: string, onProgress?: (progress: GenerationProgress) => void) =>
      createRouteMutation.mutateAsync({ prompt, onProgress }),
    isCreatingRoute: createRouteMutation.isPending,
    deleteRoute: deleteRouteMutation.mutateAsync,
    isDeletingRoute: deleteRouteMutation.isPending,
    getRouteDetails: getRouteDetailsMutation.mutateAsync,
    isGettingRouteDetails: getRouteDetailsMutation.isPending,
  };
}
