import {
  AppShell, Text, Button,
  ScrollArea, Card, Group, Stack,
  ActionIcon,
  Affix,
  Burger,
  Accordion
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconPlus, IconLogout } from '@tabler/icons-react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { tokenAtom } from '../../../atoms/auth';
import { activeRouteAtom, routeCoordinatesAtom, useRoutes } from '../../../atoms/routes';
import { MapZoomToRoute } from '../../../components/MapZoomToRoute';
import { useDisclosure } from '@mantine/hooks';
import flagIconSvg from '../../../assets/flag.svg?raw';
import logoImg from '../../../assets/logo.png';
import { useState } from 'react';

export function MapPage() {
  const [, setToken] = useAtom(tokenAtom);
  const [activeRoute, setActiveRoute] = useAtom(activeRouteAtom);
  const [routeCoordinates] = useAtom(routeCoordinatesAtom);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [opened, { toggle, close }] = useDisclosure();
  const {
    routes,
    deleteRoute,
    isDeletingRoute,
    getRouteDetails,
  } = useRoutes();

  const navigate = useNavigate();

  // Create a custom icon using the SVG string
  const customIcon = L.icon({
    iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(flagIconSvg)}`,
    iconSize: [38, 38],
    iconAnchor: [3, 40],
  });

  const selectRoute = async (routeId: number) => {
    try {
      setActiveRouteId(routeId.toString());
      await getRouteDetails(routeId);
      close();
    } catch (error) {
      console.error('Error loading route details:', error);
      notifications.show({
        title: 'Грешка',
        message: 'Не могу да учитам детаље руте',
        color: 'red'
      });
    }
  };

  const deselectRoute = async () => {
    setActiveRoute(null);
  };

  const handleLogout = async () => {
    setToken('');
    navigate('/');
  };

  const openDeleteModal = () => {
    if (!activeRouteId) return;
    return modals.openConfirmModal({
      title: 'Да ли сте сигурни да желите да избришете руту?',
      centered: true,
      labels: { confirm: 'Избриши', cancel: "Одустани" },
      confirmProps: { color: 'red' },
      zIndex: 1000,
      onConfirm: () => {
        deleteRoute(activeRouteId);
        setActiveRoute(null);
        setActiveRouteId(null);
      },
    });
  }

  return (
    <AppShell
      navbar={{ width: 300, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <Affix position={{ top: 20, right: 20 }} zIndex={1002}>
        <Burger opened={opened} onClick={toggle} style={{
          '--ai-size': 'calc(3.75rem * var(--mantine-scale))',
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 'var(--mantine-radius-xl)',
          backgroundColor: 'var(--mantine-color-default)',
          width: 'var(--ai-size)',
          height: 'var(--ai-size)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }} hiddenFrom="sm" size="md" aria-label="Toggle navigation" />
      </Affix>
      <AppShell.Navbar p="md" zIndex={1001}>
        <Group mb="md">
          <img src={logoImg} alt="logo" style={{ width: 266 }} />
        </Group>
        <ScrollArea flex={1}>
          <Stack gap="xs">
            {activeRoute ?
              <>
                <Group justify="space-between">
                  <Button onClick={deselectRoute}>Back</Button>
                  <Button variant="subtle" color="red" onClick={openDeleteModal} loading={isDeletingRoute}>
                    <IconTrash size={16} />
                  </Button>
                </Group>
                <Accordion>
                  {
                    activeRoute?.map(item => (
                      <Accordion.Item key={item.city} value={item.city}>
                        <Accordion.Control>{item.city}</Accordion.Control>
                        <Accordion.Panel>{item.description}</Accordion.Panel>
                      </Accordion.Item>
                    ))}
                </Accordion>
              </>
              : routes?.map(r => (
                <Card key={r.id} withBorder p="sm" radius="md" style={{ cursor: 'pointer' }}>
                  <div onClick={() => selectRoute(r.id)}>
                    <Text size="sm" fw={600}>{r.title}</Text>
                    <Text size="xs" c="dimmed">{r.destination}</Text>
                  </div>
                </Card>
              ))}
          </Stack>
        </ScrollArea>
        <Button variant="light" color="red" mt="md" fullWidth onClick={handleLogout}>
          <IconLogout stroke={1.5} />
          <span>Одјава</span>
        </Button>
      </AppShell.Navbar>

      <AppShell.Main p={0} style={{ display: 'flex' }}>
        <MapContainer
          style={{ flex: 1 }}
          center={activeRoute ? [activeRoute[0].lat, activeRoute[0].lng] : [43.89139, 20.34972]}
          zoom={activeRoute ? 6 : 7}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
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
        <Affix position={{ bottom: 20, right: 20 }} zIndex={1000}>
          <ActionIcon radius="xl" size={60} onClick={() => navigate('/prompt')}>
            <IconPlus stroke={1.5} size={30} />
          </ActionIcon>
        </Affix>
      </AppShell.Main>
    </AppShell>
  );
}
