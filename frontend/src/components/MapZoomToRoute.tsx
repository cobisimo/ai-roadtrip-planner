import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

interface MapZoomToRouteProps {
  routeCoordinates: any[] | null;
}

export function MapZoomToRoute({ routeCoordinates }: MapZoomToRouteProps) {
  const map = useMap();

  useEffect(() => {
    if (routeCoordinates && routeCoordinates.length > 0) {
      const bounds = L.latLngBounds(routeCoordinates);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [routeCoordinates, map]);

  return null;
}
