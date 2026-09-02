import { Affix, Burger, Button, Container, Modal, Paper, Progress, Select, Stack, Text } from '@mantine/core';
import { SimpleInput } from '../../components/SimpleInput/SimpleInput';
import { useLocation, useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { GenerationLimitError, type GenerationProgress, useRoutes } from '../../atoms/routes';
import { activeRouteAtom, activeRouteIdAtom } from '../../atoms/routes';
import { type UserPlan, useCurrentUser, useUpgradePlan } from '../../atoms/auth';
import { useState } from 'react';
import { useAtom } from 'jotai';

const planOptions: Array<{ value: UserPlan; label: string; limit: number }> = [
  { value: 'free', label: 'Бесплатни · 3 дневно', limit: 3 },
  { value: 'paid_10', label: 'Плаћени · 5 $ месечно · 10 дневно', limit: 10 },
  { value: 'paid_50', label: 'Плаћени · 10 $ месечно · 50 дневно', limit: 50 },
  { value: 'paid_100', label: 'Плаћени · 25 $ месечно · 100 дневно', limit: 100 },
];

export function PromptPage() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { data: currentUser } = useCurrentUser();
  const [activeRoute] = useAtom(activeRouteAtom);
  const [activeRouteId] = useAtom(activeRouteIdAtom);
  const { upgradePlan, isUpgrading } = useUpgradePlan();
  const [prompt, setPrompt] = useState('');
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [upgradeModalOpened, setUpgradeModalOpened] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<UserPlan | null>(null);
  const {
    createRoute,
    editRoute,
    isCreatingRoute,
  } = useRoutes();
  const isEditingRoute = Boolean(new URLSearchParams(search).get('edit') === '1' && activeRoute && activeRouteId !== null);

  const handleGenerate = async () => {
    if (!prompt.trim() || isCreatingRoute) return;

    setGenerationProgress([]);
    setGenerationError(null);

    try {
      const onProgress = (progress: GenerationProgress) => {
        setGenerationProgress((current) => [...current, progress]);
      };
      if (isEditingRoute && activeRouteId !== null) {
        await editRoute(activeRouteId, prompt, onProgress);
        notifications.show({ title: 'Рута је измењена', message: 'Додатни захтев је примењен на руту.', color: 'green' });
      } else {
        await createRoute(prompt, onProgress);
        notifications.show({ title: 'Успех!', message: 'Путовање је испланирано.', color: 'green' });
      }
      navigate('/map')
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : 'Генерисање путовања није успело.';
      setGenerationError(message);
      if (e instanceof GenerationLimitError) {
        const nextPlan = planOptions.find((option) => option.limit > (e.limit ?? currentUser?.dailyLimit ?? 0));
        setSelectedPlan(nextPlan?.value ?? null);
        setUpgradeModalOpened(true);
        notifications.show({ title: 'Дневни лимит је достигнут', message: 'Изаберите већи план за наставак.', color: 'yellow' });
        return;
      }
      notifications.show({
        title: 'Грешка',
        message,
        color: 'red',
      });
    }
  };

  const latestProgress = generationProgress.at(-1);
  const progressPercent = latestProgress?.percent ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = currentUser?.usageDate === today ? currentUser.usageCount : 0;
  const remainingRequests = currentUser ? Math.max(0, currentUser.dailyLimit - usedToday) : null;
  const handleUpgrade = async () => {
    if (!selectedPlan) return;
    try {
      await upgradePlan(selectedPlan);
      setUpgradeModalOpened(false);
      setGenerationError(null);
      notifications.show({ title: 'План је активиран', message: 'Нови лимит је сада доступан.', color: 'green' });
    } catch (error) {
      notifications.show({ title: 'План није активиран', message: error instanceof Error ? error.message : 'Покушајте поново.', color: 'red' });
    }
  };

  return (
    <Container size={640} style={{ display: 'flex', alignItems: 'center', height: '100vh' }}>
      <Affix position={{ top: 20, right: 20 }}>
        <Burger opened={true} onClick={() => navigate('/map')} style={{
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
        }} size="md" aria-label="Пребаци навигацију" />
      </Affix>
      <Stack w="100%" gap="lg">
        {currentUser && (
          <Text size="sm" c="dimmed" ta="center">
            План: {planOptions.find((option) => option.value === currentUser.plan)?.label ?? 'Администратор'}
            {remainingRequests !== null && ` · Преостало данас: ${remainingRequests}/${currentUser.dailyLimit}`}
          </Text>
        )}
        <SimpleInput
          onChange={(e) => setPrompt(e.currentTarget.value)}
          onClick={handleGenerate}
          disabled={isCreatingRoute}
        />

        {generationProgress.length > 0 && (
          <Paper withBorder p="md" radius="lg">
            <Stack gap="sm">
              <Text fw={600} c={generationError ? 'red' : undefined}>
                {generationError ? 'Обрада није успела' : isCreatingRoute ? (isEditingRoute ? 'Измена руте' : 'Генерисање путовања') : 'Обрада завршена'}
              </Text>
              <Progress value={progressPercent} animated={isCreatingRoute} />
              {latestProgress && <Text size="sm">{latestProgress.message}</Text>}
              {generationError && <Text size="sm" c="red">{generationError}</Text>}
              <Stack gap={4}>
                {generationProgress.slice(-6).map((progress, index) => (
                  <Text key={`${progress.step}-${index}`} size="xs" c="dimmed">
                    {progress.message}
                  </Text>
                ))}
              </Stack>
            </Stack>
          </Paper>
        )}
      </Stack>

      <Modal
        opened={upgradeModalOpened}
        onClose={() => setUpgradeModalOpened(false)}
        title="Промена плана"
        centered
        closeOnClickOutside={false}
        closeOnEscape={false}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            План можете променити у било ком тренутку. Плаћање тренутно није потребно; избор плана је виртуелан.
          </Text>
          <Select
            label="План"
            data={planOptions.map((option) => ({ value: option.value, label: option.label }))}
            value={selectedPlan}
            onChange={(value) => setSelectedPlan(value as UserPlan | null)}
            allowDeselect={false}
          />
          <Button loading={isUpgrading} disabled={!selectedPlan} onClick={() => void handleUpgrade()}>
            Активирај план
          </Button>
        </Stack>
      </Modal>
    </Container>
  );
}
