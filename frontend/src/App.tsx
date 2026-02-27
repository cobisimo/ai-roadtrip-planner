import {
  MantineProvider, AppShell, Text, TextInput, Button,
  ScrollArea, Card, Group, Stack, Badge, Center, Title, createTheme
} from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { IconCompass, IconSend, IconMapPin } from '@tabler/icons-react';
import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import axios from 'axios';

// ОБАВЕЗНО: Импортуј стилове за Mantine v7
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

        <AppShell.Main style={{ height: '100vh', padding: 0, position: 'relative' }}>
          <div style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1
          }}>
            <MapContainer
              center={[44.78, 20.44]}
              zoom={7}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap'
              />

              {activeRoute && (
                <>
                  {activeRoute.map((stop, i) => (
                    <Marker key={i} position={[stop.lat, stop.lng]}>
                      <Popup>
                        <Text fw={700}>{stop.city}</Text>
                        <Text size="xs">{stop.description}</Text>
                      </Popup>
                    </Marker>
                  ))}
                  <Polyline
                    positions={activeRoute.map(s => [s.lat, s.lng])}
                    color="#4c6ef5"
                  />
                </>
              )}
            </MapContainer>
          </div>
        </AppShell.Main>
      </AppShell>
    </MantineProvider>
  );
}
