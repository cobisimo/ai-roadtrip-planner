import { Affix, Burger, Container, LoadingOverlay } from '@mantine/core';
import { SimpleInput } from '../../components/SimpleInput/SimpleInput';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { useRoutes } from '../../atoms/routes';
import { useState } from 'react';

export function PromptPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const {
    createRoute,
    isCreatingRoute,
  } = useRoutes();

  const handleGenerate = async () => {
    try {
      await createRoute(prompt);
      notifications.show({ title: 'Успех!', message: 'Путовање је испланирано.', color: 'green' });
      navigate('/map')
    } catch (e) {
      console.error(e);
      notifications.show({ title: 'Грешка', message: 'Провери бекенд и Llama сервер.', color: 'red' });
    }
  };

  return (
    <Container size={640} style={{ display: 'flex', alignItems: 'center', height: '100vh' }}>
      <Affix position={{ top: 20, right: 20 }} zIndex={1001}>
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
      <LoadingOverlay visible={isCreatingRoute} zIndex={1000} overlayProps={{ radius: "sm", blur: 2 }} />
      <SimpleInput onChange={(e) => setPrompt(e.currentTarget.value)} onClick={handleGenerate} />
    </Container>
  );
}
