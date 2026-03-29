import {
  AppShell, Text, TextInput, Button,
  ScrollArea, Card, Group, Stack
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCompass, IconSend, IconMapPin, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import { renderToString } from 'react-dom/server';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { tokenAtom } from '../../../atoms/auth';
import { activeRouteAtom, routeCoordinatesAtom, useRoutes } from '../../../atoms/routes';
import { MapZoomToRoute } from '../../../components/MapZoomToRoute';

export function MapPage() {
  const [, setToken] = useAtom(tokenAtom);
  const [activeRoute] = useAtom(activeRouteAtom);
  const [routeCoordinates] = useAtom(routeCoordinatesAtom);
  const [prompt, setPrompt] = useState('');
  const {
    routes,
    createRoute,
    isCreatingRoute,
    deleteRoute,
    isDeletingRoute,
    getRouteDetails,
  } = useRoutes();

  const navigate = useNavigate();

  const iconSvg = renderToString(<IconMapPin />);

  // Create a custom icon using the SVG string
  const customIcon = L.icon({
    iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });

  const handleGenerate = async () => {
    try {
      await createRoute(prompt);
      notifications.show({ title: 'Успех!', message: 'Путовање је испланирано.', color: 'green' });
    } catch (e) {
      notifications.show({ title: 'Грешка', message: 'Провери бекенд и Llama сервер.', color: 'red' });
    }
  };

  const handleRouteClick = async (routeId: number) => {
    try {
      await getRouteDetails(routeId);
    } catch (error) {
      console.error('Error loading route details:', error);
      notifications.show({
        title: 'Грешка',
        message: 'Не могу да учитам детаље руте',
        color: 'red'
      });
    }
  };

  const handleLogout = async () => {
    setToken('');
    navigate('/');
  };
  return (
    <AppShell
      header={{ height: 70 }}
      navbar={{ width: 300, breakpoint: 'sm' }}
      padding="md"
    >
      <AppShell.Header p="md" bg="indigo.6">
        <Group h="100%" justify="space-between">
          <Group>
            <IconCompass color="white" />
            <Text c="white" fw={700} size="xl">ПЛАНЕР</Text>
          </Group>
          <Group style={{ flex: 1, maxWidth: 600 }}>
            <TextInput
              style={{ flex: 1 }}
              placeholder="Нпр. Пут од Београда до Прага..."
              value={prompt}
              onChange={(e) => setPrompt(e.currentTarget.value)}
            />
            <Button variant="white" onClick={handleGenerate} loading={isCreatingRoute} leftSection={<IconSend size={16} />}>
              Планирај
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Text fw={600} mb="md">Претходне руте</Text>
        <ScrollArea flex={1}>
          <Stack gap="xs">
            {routes?.map(r => (
              <Card key={r.id} withBorder p="sm" radius="md" style={{ cursor: 'pointer' }}>
                <Group justify="space-between">
                  <div onClick={() => handleRouteClick(r.id)}>
                    <Text size="sm" fw={600}>{r.title}</Text>
                    <Text size="xs" c="dimmed">{r.destination}</Text>
                  </div>
                  <Button variant="subtle" color="red" onClick={() => deleteRoute(r.id)} loading={isDeletingRoute}>
                    <IconTrash size={16} />
                  </Button>
                </Group>
              </Card>
            ))}
          </Stack>
        </ScrollArea>
        <Button variant="light" color="red" mt="md" fullWidth onClick={handleLogout}>
          Одјава
        </Button>
      </AppShell.Navbar>

      <AppShell.Main style={{ display: 'flex' }}>
        <MapContainer
          style={{ flex: 1 }}
          center={activeRoute ? [activeRoute[0].lat, activeRoute[0].lng] : [43.89139, 20.34972]}
          zoom={activeRoute ? 6 : 7}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {activeRoute && (<>
            {activeRoute.map((stop, index) => (
              <Marker key={index} position={[stop.lat, stop.lng]} icon={customIcon}>
                <Popup>
                  <div>
                    <Text fw={600}>{stop.city}</Text>
                    <Text size="sm">{stop.reason}</Text>
                    {stop.image && <img src={stop.image} alt={stop.city} style={{ width: '100%', marginTop: 8 }} />}
                  </div>
                </Popup>
              </Marker>
            ))}
            {routeCoordinates && routeCoordinates.length > 0 && (
              <>
                <Polyline
                  positions={routeCoordinates}
                  color="blue"
                  weight={4}
                />
                <MapZoomToRoute routeCoordinates={routeCoordinates} />
              </>
            )}
          </>)}
        </MapContainer>
      </AppShell.Main>
    </AppShell>
  );
}
