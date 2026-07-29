import { Affix, Burger, Container, Paper, Progress, Stack, Text } from '@mantine/core';
import { SimpleInput } from '../../components/SimpleInput/SimpleInput';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { type GenerationProgress, useRoutes } from '../../atoms/routes';
import { useState } from 'react';

export function PromptPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const {
    createRoute,
    isCreatingRoute,
  } = useRoutes();

  const handleGenerate = async () => {
    if (!prompt.trim() || isCreatingRoute) return;

    setGenerationProgress([]);
    setGenerationError(null);

    try {
      await createRoute(prompt, (progress) => {
        setGenerationProgress((current) => [...current, progress]);
      });
      notifications.show({ title: 'Успех!', message: 'Путовање је испланирано.', color: 'green' });
      navigate('/map')
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : 'Генерисање путовања није успело.';
      setGenerationError(message);
      notifications.show({
        title: 'Грешка',
        message,
        color: 'red',
      });
    }
  };

  const latestProgress = generationProgress.at(-1);
  const progressPercent = latestProgress?.percent ?? 0;

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
        }} size="md" aria-label="Toggle navigation" />
      </Affix>
      <Stack w="100%" gap="lg">
        <SimpleInput
          onChange={(e) => setPrompt(e.currentTarget.value)}
          onClick={handleGenerate}
          disabled={isCreatingRoute}
        />

        {generationProgress.length > 0 && (
          <Paper withBorder p="md" radius="lg">
            <Stack gap="sm">
              <Text fw={600} c={generationError ? 'red' : undefined}>
                {generationError ? 'Генерисање није успело' : isCreatingRoute ? 'Генерисање путовања' : 'Генерисање завршено'}
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
    </Container>
  );
}
