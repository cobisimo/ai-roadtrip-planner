import {
  Alert,
  ActionIcon,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Menu,
  Modal,
  Progress,
  RingProgress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDotsVertical, IconLogout } from '@tabler/icons-react';
import { useState } from 'react';
import { useAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { tokenAtom, useCurrentUser } from '../atoms/auth';
import { type AdminUser, useAdminData } from '../atoms/admin';

type DraftUser = Pick<AdminUser, 'role' | 'plan'>;

const planLimits: Record<Exclude<AdminUser['plan'], null>, number> = {
  free: 3,
  paid_10: 10,
  paid_50: 50,
  paid_100: 100,
};

const roleOptions = [
  { value: 'user', label: 'Корисник' },
  { value: 'admin', label: 'Администратор' },
];

const planOptions = [
  { value: 'free', label: 'Бесплатни · 3 дневно' },
  { value: 'paid_10', label: 'Плаћени · 5 $ · 10 дневно' },
  { value: 'paid_50', label: 'Плаћени · 10 $ · 50 дневно' },
  { value: 'paid_100', label: 'Плаћени · 25 $ · 100 дневно' },
];

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Подаци администрације не могу да се учитају.';

export function AdminPage() {
  const navigate = useNavigate();
  const [, setToken] = useAtom(tokenAtom);
  const { data: currentUser } = useCurrentUser();
  const { stats, users, isLoading, error, updateUser, updatingUserId } = useAdminData();
  const [draftChanges, setDraftChanges] = useState<Record<number, Partial<DraftUser>>>({});
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editModalOpened, setEditModalOpened] = useState(false);

  const drafts = Object.fromEntries((users ?? []).map((user) => [user.id, {
    role: user.role,
    plan: user.plan,
    ...draftChanges[user.id],
  }])) as Record<number, DraftUser>;

  const updateDraft = (user: AdminUser, patch: Partial<DraftUser>) => {
    setDraftChanges((current) => ({
      ...current,
      [user.id]: { ...current[user.id], ...patch },
    }));
  };

  const saveUser = async (user: AdminUser) => {
    const draft = drafts[user.id];
    if (!draft) return;

    try {
      await updateUser({ userId: user.id, ...draft });
      setDraftChanges((current) => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
      notifications.show({ title: 'Корисник је ажуриран', message: `Подаци за ${user.email} су ажурирани.`, color: 'green' });
      setEditModalOpened(false);
    } catch (saveError) {
      notifications.show({ title: 'Ажурирање није успело', message: getErrorMessage(saveError), color: 'red' });
    }
  };

  const editingUser = users?.find((user) => user.id === editingUserId);
  const editingDraft = editingUser ? drafts[editingUser.id] : undefined;
  const totalUsers = stats?.totalUsers ?? 0;
  const freeUsers = stats?.freeUsers ?? 0;
  const paidUsers = stats?.paidUsers ?? 0;
  const adminUsers = stats?.adminUsers ?? 0;
  const userSegments = totalUsers > 0
    ? [
      { value: (freeUsers / totalUsers) * 100, color: 'gray.5', label: 'Бесплатни', count: freeUsers },
      { value: (paidUsers / totalUsers) * 100, color: 'indigo.6', label: 'Плаћени', count: paidUsers },
      { value: (adminUsers / totalUsers) * 100, color: 'orange.6', label: 'Администратори', count: adminUsers },
    ]
    : [{ value: 100, color: 'gray.3', label: 'Нема података', count: 0 }];
  const activityMax = Math.max(stats?.requestsToday ?? 0, stats?.totalRoutes ?? 0, stats?.routesToday ?? 0, 1);

  const handleLogout = () => {
    setToken(null);
    navigate('/login', { replace: true });
  };

  if (currentUser && currentUser.role !== 'admin') {
    return <Container size="xl"><Alert color="red" title="Приступ одбијен">Само администратори могу да отворе овај панел.</Alert></Container>;
  }

  if (error) {
    return <Container size="xl"><Alert color="red" title="Грешка административног панела">{getErrorMessage(error)}</Alert></Container>;
  }

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={1}>Администрација</Title>
            <Text c="dimmed" mt={4}>Управљање улогама корисника, плановима и статистиком коришћења.</Text>
          </div>
          <Button variant="light" leftSection={<IconLogout size={16} />} onClick={handleLogout}>
            Одјава
          </Button>
        </Group>

        <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }}>
          {[
            ['Корисници', stats?.totalUsers ?? 0],
            ['Бесплатни', stats?.freeUsers ?? 0],
            ['Плаћени', stats?.paidUsers ?? 0],
            ['Администратори', stats?.adminUsers ?? 0],
            ['Захтеви данас', stats?.requestsToday ?? 0],
            ['Руте', stats?.totalRoutes ?? 0],
            ['Руте данас', stats?.routesToday ?? 0],
          ].map(([label, value]) => (
            <Card key={String(label)} withBorder padding="md" radius="md">
              <Text size="xs" c="dimmed">{label}</Text>
              <Text size="xl" fw={700} mt={4}>{value}</Text>
            </Card>
          ))}
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Card withBorder padding="lg" radius="md">
            <Group justify="space-between" align="flex-start">
              <div>
                <Title order={3}>Структура корисника</Title>
                <Text size="sm" c="dimmed" mt={4}>Расподела налога по плану и улози.</Text>
              </div>
              <RingProgress
                size={150}
                thickness={18}
                roundCaps
                sections={userSegments}
                label={<Text ta="center" fw={700} size="lg">{totalUsers}</Text>}
              />
            </Group>
            <Stack gap="xs" mt="md">
              {userSegments.map((segment) => (
                <Group key={segment.label} justify="space-between" gap="xs">
                  <Group gap="xs">
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: `var(--mantine-color-${segment.color.replace('.', '-')})` }} />
                    <Text size="sm">{segment.label}</Text>
                  </Group>
                  <Text size="sm" fw={600}>{segment.count}</Text>
                </Group>
              ))}
            </Stack>
          </Card>

          <Card withBorder padding="lg" radius="md">
            <Title order={3}>Активност</Title>
            <Text size="sm" c="dimmed" mt={4}>Кључне метрике коришћења система.</Text>
            <Stack gap="md" mt="xl">
              {[
                ['Захтеви данас', stats?.requestsToday ?? 0, 'indigo'],
                ['Укупно рута', stats?.totalRoutes ?? 0, 'teal'],
                ['Руте данас', stats?.routesToday ?? 0, 'orange'],
              ].map(([label, value, color]) => (
                <div key={String(label)}>
                  <Group justify="space-between" mb={5}>
                    <Text size="sm">{label}</Text>
                    <Text size="sm" fw={700}>{value}</Text>
                  </Group>
                  <Progress value={(Number(value) / activityMax) * 100} color={String(color)} radius="xl" size="md" />
                </div>
              ))}
            </Stack>
          </Card>
        </SimpleGrid>

        <Card withBorder padding="md" radius="md">
          <Stack gap="md">
            <Group justify="space-between">
              <Title order={2}>Корисници</Title>
              <Badge variant="light">{users?.length ?? 0} налога</Badge>
            </Group>

            {isLoading ? <Text c="dimmed">Учитавање корисника...</Text> : (
              <Table.ScrollContainer minWidth={980}>
                <Table verticalSpacing="sm" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Корисник</Table.Th>
                      <Table.Th>Улога</Table.Th>
                      <Table.Th>План</Table.Th>
                      <Table.Th>Дневни лимит</Table.Th>
                      <Table.Th>Искоришћено данас</Table.Th>
                      <Table.Th>Укупно рута</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {users?.map((user) => {
                      const draft = drafts[user.id] ?? user;
                      return (
                        <Table.Tr key={user.id}>
                          <Table.Td>
                            <Text fw={600}>{user.email}</Text>
                            <Text size="xs" c="dimmed">ID {user.id}</Text>
                          </Table.Td>
                          <Table.Td><Badge variant="light">{draft.role}</Badge></Table.Td>
                          <Table.Td>{draft.plan ? planOptions.find((option) => option.value === draft.plan)?.label : 'Без плана'}</Table.Td>
                          <Table.Td>{draft.role === 'admin' ? 'Неограничено' : planLimits[draft.plan ?? 'free']}</Table.Td>
                          <Table.Td>{user.usageCount}</Table.Td>
                          <Table.Td>{user.totalRoutes}</Table.Td>
                          <Table.Td>
                            <Menu position="bottom-end" withArrow>
                              <Menu.Target>
                                <ActionIcon variant="subtle" aria-label={`Actions for ${user.email}`}>
                                  <IconDotsVertical size={18} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item onClick={() => { setEditingUserId(user.id); setEditModalOpened(true); }}>
                                  Уреди приступ
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Stack>
        </Card>
      </Stack>

      <Modal
        opened={editModalOpened}
        onClose={() => setEditModalOpened(false)}
                        title={editingUser ? `Уређивање приступа: ${editingUser.email}` : 'Уређивање приступа'}
        centered
      >
        {editingUser && editingDraft && (
          <Stack>
            <Select
              label="Улога"
              data={roleOptions}
              value={editingDraft.role}
              onChange={(value) => value && updateDraft(editingUser, value === 'admin'
                ? { role: 'admin', plan: null }
                : { role: 'user', plan: editingDraft.plan ?? 'free' })}
              allowDeselect={false}
            />
            <Select
              label="План"
              data={planOptions}
              value={editingDraft.plan}
              placeholder={editingDraft.role === 'admin' ? 'Без плана' : 'Изаберите план'}
              disabled={editingDraft.role === 'admin'}
              onChange={(value) => value && updateDraft(editingUser, { plan: value as DraftUser['plan'] })}
              allowDeselect={false}
            />
            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={() => setEditModalOpened(false)}>Откажи</Button>
              <Button loading={updatingUserId === editingUser.id} onClick={() => void saveUser(editingUser)}>Сачувај измене</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Container>
  );
}
