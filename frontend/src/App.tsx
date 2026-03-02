import {
  MantineProvider, AppShell, Text, TextInput, Button,
  ScrollArea, Card, Group, Stack, Badge, Center, Title, createTheme
} from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { IconCompass, IconSend, IconMapPin } from '@tabler/icons-react';
import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import axios from 'axios';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import 'leaflet/dist/leaflet.css';

const theme = createTheme({
  primaryColor: 'indigo',
});

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [activeRoute, setActiveRoute] = useState<any[] | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<any[] | null>(null);

  const api = axios.create({
    baseURL: 'http://localhost:3000/api',
    headers: { Authorization: `Bearer ${token}` }
  });

  const loadHistory = async () => {
    try {
      const res = await api.get('/routes');
      setHistory(res.data);
    } catch (e) {
      console.error("Грешка при учитавању историје", e);
    }
  };

  useEffect(() => { if (token) loadHistory(); }, [token]);

  const fetchRoute = async (waypoints) => {
    try {
      const response = await axios.get(`https://router.project-osrm.org/route/v1/driving/${waypoints.join(';')}?overview=full&geometries=geojson`);
      return response.data.routes[0].geometry.coordinates;
    } catch (error) {
      console.error('Error fetching route:', error);
      return null;
    }
  };

  useEffect(() => {
    if (activeRoute) {
      const waypoints = activeRoute.map(stop => `${stop.lng},${stop.lat}`);
      fetchRoute(waypoints).then(route => {
        if (route) {
          setRouteCoordinates(route.map(coord => [coord[1], coord[0]]));
        }
      });
    }
  }, [activeRoute]);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await api.post('/generate', { prompt });
      const stops = JSON.parse(res.data.data);
      setActiveRoute(stops);
      loadHistory();
      notifications.show({ title: 'Успех!', message: 'Путовање је испланирано.', color: 'green' });
    } catch (e) {
      notifications.show({ title: 'Грешка', message: 'Провери бекенд и Llama сервер.', color: 'red' });
    } finally { setLoading(false); }
  };

  if (!token) {
    return (
      <MantineProvider theme={theme}>
        <Center h="100vh" bg="gray.0">
          <Card shadow="xl" p="xl" radius="md" withBorder w={400}>
            <Title ta="center" order={2} mb="lg">AI Roadtrip Planner</Title>
            <Button fullWidth onClick={async () => {
              try {
                const res = await axios.post('http://localhost:3000/api/login', {
                  username: 'test_putnik',
                  password: 'lozinka123'
                });
                localStorage.setItem('token', res.data.token);
                setToken(res.data.token);
              } catch (e) {
                alert("Прво покрени бекенд и сеед скрипту!");
              }
            }}>Пријави се (Test)</Button>
          </Card>
        </Center>
      </MantineProvider>
    );
  }

  return (
    <MantineProvider theme={theme}>
      <Notifications />
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
              <Button variant="white" onClick={handleGenerate} loading={loading} leftSection={<IconSend size={16} />}>
                Планирај
              </Button>
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="md">
          <Text fw={600} mb="md">Претходне руте</Text>
          <ScrollArea flex={1}>
            <Stack gap="xs">
              {history.map(r => (
                <Card key={r.id} withBorder p="sm" radius="md" style={{ cursor: 'pointer' }} onClick={() => setActiveRoute(JSON.parse(r.data))}>
                  <Text size="sm" fw={600}>{r.title}</Text>
                  <Text size="xs" c="dimmed">{r.destination}</Text>
                </Card>
              ))}
            </Stack>
          </ScrollArea>
          <Button variant="light" color="red" mt="md" fullWidth onClick={() => { localStorage.clear(); setToken(null); }}>
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
                <Marker key={index} position={[stop.lat, stop.lng]}>
                  <Popup>
                    <div>
                      <Text fw={600}>{stop.city}</Text>
                      <Text size="sm">{stop.description}</Text>
                      {stop.image && <img src={stop.image} alt={stop.city} style={{ width: '100%', marginTop: 8 }} />}
                    </div>
                  </Popup>
                </Marker>
              ))}
              {routeCoordinates && <Polyline positions={routeCoordinates} color="blue" />}
            </>)}
          </MapContainer>
        </AppShell.Main>
      </AppShell>
    </MantineProvider>

  );
}
