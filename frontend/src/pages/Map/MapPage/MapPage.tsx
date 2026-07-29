import {
  AppShell, Text, Button,
  ScrollArea, Card, Group, Stack,
  ActionIcon,
  Affix,
  Burger,
  Accordion,
  Image,
  Modal,
  NativeSelect,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconPlus, IconLogout, IconSun, IconMoon, IconArrowBackUp } from '@tabler/icons-react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { type UserPlan, tokenAtom, useCurrentUser, useUpgradePlan } from '../../../atoms/auth';
import { activeRouteAtom, routeCoordinatesAtom, useRoutes } from '../../../atoms/routes';
import { MapZoomToRoute } from '../../../components/MapZoomToRoute';
import { useColorScheme, useDisclosure } from '@mantine/hooks';
import flagIconSvg from '../../../assets/flag.svg?raw';
import logoImg from '../../../assets/logo.png';
import logoImgDark from '../../../assets/logo-dark.png';
import { useEffect, useState } from 'react';

const planOptions: Array<{ value: UserPlan; label: string }> = [
  { value: 'free', label: 'Бесплатни · 3 дневно' },
  { value: 'paid_10', label: 'Плаћени · 5 $ месечно · 10 дневно' },
  { value: 'paid_50', label: 'Плаћени · 10 $ месечно · 50 дневно' },
  { value: 'paid_100', label: 'Плаћени · 25 $ месечно · 100 дневно' },
];

export function MapPage() {
  const [, setToken] = useAtom(tokenAtom);
  const [activeRoute, setActiveRoute] = useAtom(activeRouteAtom);
  const [routeCoordinates] = useAtom(routeCoordinatesAtom);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const preferredColorScheme = useColorScheme();
  const [colorScheme, setColorScheme] = useState(preferredColorScheme);
  const [opened, { toggle, close }] = useDisclosure();
  const {
    routes,
    isLoadingRoutes,
    deleteRoute,
    isDeletingRoute,
    getRouteDetails,
  } = useRoutes();

  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const { upgradePlan, isUpgrading } = useUpgradePlan();
  const [planModalOpened, setPlanModalOpened] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<UserPlan | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = currentUser?.usageDate === today ? currentUser.usageCount : 0;
  const remainingRequests = currentUser?.role === 'admin' ? null : Math.max(0, (currentUser?.dailyLimit ?? 0) - usedToday);
  const planLabel = currentUser?.plan === 'free'
    ? 'Бесплатни'
    : currentUser?.plan === 'paid_10'
      ? 'Плаћени 5 $'
      : currentUser?.plan === 'paid_50'
        ? 'Плаћени 10 $'
        : currentUser?.plan === 'paid_100'
          ? 'Плаћени 25 $'
          : null;

  const handlePlanChange = async () => {
    if (!selectedPlan || selectedPlan === currentUser?.plan) {
      setPlanModalOpened(false);
      return;
    }

    try {
      await upgradePlan(selectedPlan);
      setPlanModalOpened(false);
      notifications.show({ title: 'План је ажуриран', message: 'Нови план и дневни лимит су активни.', color: 'green' });
    } catch (error) {
      notifications.show({ title: 'Промена плана није успела', message: error instanceof Error ? error.message : 'Покушајте поново.', color: 'red' });
    }
  };

  useEffect(() => {
    setColorScheme(preferredColorScheme);
  }, [preferredColorScheme]);

  useEffect(() => {
    if (!isLoadingRoutes && routes && routes.length === 0 && !activeRoute) {
      navigate('/prompt', { replace: true });
    }
  }, [activeRoute, isLoadingRoutes, navigate, routes]);

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
        }} hiddenFrom="sm" size="md" aria-label="Пребаци навигацију" />
      </Affix>
      <AppShell.Navbar p="md" zIndex={1001}>
        <Group mb="md" justify="center">
          <img src={preferredColorScheme === 'dark' ? logoImgDark : logoImg} alt="Логотип" style={{ width: 266 }} />
        </Group>
        {currentUser && (
          <Button
            type="button"
            variant="subtle"
            color="gray"
            fullWidth
            size="compact-sm"
            mb="sm"
            aria-label="Промени план"
            onClick={() => {
              setSelectedPlan(currentUser.plan ?? 'free');
              setPlanModalOpened(true);
            }}
            disabled={currentUser.role === 'admin'}
          >
            {currentUser.role === 'admin'
              ? 'Неограничено генерисање'
              : `${planLabel} · ${remainingRequests}/${currentUser.dailyLimit} захтева преостало`}
          </Button>
        )}
        <ScrollArea flex={1}>
          <Stack gap="xs">
            {activeRoute ?
              <>
                <Group justify="space-between">
                  <Button onClick={deselectRoute}>
                    <IconArrowBackUp size={16} />
                  </Button>
                  <Button color="red" onClick={openDeleteModal} loading={isDeletingRoute}>
                    <IconTrash size={16} />
                  </Button>
                </Group>
                <Accordion>
                  {
                    activeRoute?.map(item => (
                      <Accordion.Item key={`${item.place}-${item.city ?? ''}`} value={`${item.place}-${item.city ?? ''}`}>
                        <Accordion.Control>
                          {item.place}
                          {item.city && <Text component="span" size="sm" c="dimmed">{`, ${item.city}`}</Text>}
                        </Accordion.Control>
                        <Accordion.Panel>
                          <Stack gap="sm">
                            {item.image && (
                              <Image
                                src={item.image}
                                alt={item.place}
                                radius="md"
                                mah={180}
                                fit="cover"
                              />
                            )}
                            <Text size="sm" fw={600}>{item.reason}</Text>
                            <Text size="sm" c="dimmed">{item.description}</Text>
                          </Stack>
                        </Accordion.Panel>
                      </Accordion.Item>
                    ))}
                </Accordion>
              </>
              : routes?.map((r) => (
                <Card key={r.id} withBorder p="sm" radius="md" style={{ cursor: 'pointer' }}>
                  <div onClick={() => selectRoute(r.id)}>
                    <Text size="sm" fw={600}>{r.title}</Text>
                    <Text size="xs" c="dimmed">{r.destination}</Text>
                  </div>
                </Card>
              ))}
          </Stack>
        </ScrollArea>
        <Button variant="light" color="orange" mt="md" fullWidth onClick={handleLogout}>
          <IconLogout stroke={1.5} />
          <span>Одјава</span>
        </Button>
      </AppShell.Navbar>

      <Modal
        opened={planModalOpened}
        onClose={() => setPlanModalOpened(false)}
        title="Промена плана"
        centered
        zIndex={2000}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            План можете променити у било ком тренутку. Плаћање тренутно није потребно.
          </Text>
          <NativeSelect
            label="План"
            data={planOptions.map((option) => ({ value: option.value, label: option.label }))}
            value={selectedPlan ?? 'free'}
            onChange={(event) => setSelectedPlan(event.currentTarget.value as UserPlan)}
          />
          <Button loading={isUpgrading} disabled={!selectedPlan} onClick={() => void handlePlanChange()}>
            Сачувај план
          </Button>
        </Stack>
      </Modal>

      <AppShell.Main p={0} style={{ display: 'flex' }}>
        <MapContainer
          style={{ flex: 1 }}
          center={activeRoute ? [activeRoute[0].lat, activeRoute[0].lng] : [43.89139, 20.34972]}
          zoom={activeRoute ? 6 : 7}
        >
          <TileLayer
            url={colorScheme === 'dark' ? "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png" : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
            attribution="&copy; OpenStreetMap contributors"
          />
          {activeRoute && (<>
            {activeRoute.map((stop, index) => (
              <Marker key={index} position={[stop.lat, stop.lng]} icon={customIcon}>
                <Popup>
                  <div>
                    <Text fw={600}>
                      {stop.place}
                      {stop.city && <Text component="span" size="sm" c="dimmed">{`, ${stop.city}`}</Text>}
                    </Text>
                    <Text size="sm">{stop.reason}</Text>
                    {stop.image && <img src={stop.image} alt={stop.place} style={{ width: '100%', marginTop: 8 }} />}
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

        <Affix position={{ top: 20, right: 20 }} zIndex={1000}>
          <ActionIcon
            onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
            variant="default"
            radius="xl"
            size={60}
            aria-label="Промени тему"
          >
            {colorScheme === 'dark' ? <IconSun stroke={1.5} size={30} /> : <IconMoon stroke={1.5} size={30} />}
          </ActionIcon>
        </Affix>
        <Affix position={{ bottom: 20, right: 20 }} zIndex={1000}>
          <ActionIcon radius="xl" size={60} onClick={() => navigate('/prompt')}>
            <IconPlus stroke={1.5} size={30} />
          </ActionIcon>
        </Affix>
      </AppShell.Main>
    </AppShell>
  );
}
