import {
  Anchor,
  Button,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../../atoms/auth';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

type AuthFormValues = {
  username: string;
  password: string;
  confirmPassword: string;
  token: string;
};

const authCopy: Record<AuthMode, { title: string; description: string; submitLabel: string }> = {
  login: {
    title: 'Prijava',
    description: 'Unesite korisnicko ime i lozinku za nastavak.',
    submitLabel: 'Prijavi se',
  },
  register: {
    title: 'Registracija',
    description: 'Napravite novi nalog za planiranje putovanja.',
    submitLabel: 'Registruj se',
  },
  forgot: {
    title: 'Zaboravljena lozinka',
    description: 'Poslacemo zahtev za resetovanje lozinke za uneto korisnicko ime.',
    submitLabel: 'Posalji zahtev',
  },
  reset: {
    title: 'Reset lozinke',
    description: 'Unesite reset token i postavite novu lozinku.',
    submitLabel: 'Sacuvaj novu lozinku',
  },
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Doslo je do greske pri obradi zahteva.';
};

export function AuthenticationForm() {
  const navigate = useNavigate();
  const { login, register, forgotPassword, resetPassword, isLoading } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const form = useForm({
    initialValues: {
      username: '',
      password: '',
      confirmPassword: '',
      token: '',
    },
    validate: {
      username: (value) => (value.trim().length === 0 ? 'Korisnicko ime je obavezno.' : null),
      password: (value) => {
        if (mode === 'forgot') {
          return null;
        }

        return value.length < 6 ? 'Lozinka mora da sadrzi najmanje 6 karaktera.' : null;
      },
      confirmPassword: (value, values) => {
        if (mode !== 'register' && mode !== 'reset') {
          return null;
        }

        if (value.length === 0) {
          return 'Potvrdite lozinku.';
        }

        return value !== values.password ? 'Lozinke se ne poklapaju.' : null;
      },
      token: (value) => {
        if (mode !== 'reset') {
          return null;
        }

        return value.trim().length === 0 ? 'Reset token je obavezan.' : null;
      },
    },
  });

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    form.clearErrors();
    form.setFieldValue('password', '');
    form.setFieldValue('confirmPassword', '');
    if (nextMode !== 'reset') {
      form.setFieldValue('token', '');
    }
  };

  const handleSubmit = form.onSubmit(async (values: AuthFormValues) => {
    const username = values.username.trim();

    try {
      if (mode === 'login') {
        await login({
          username,
          password: values.password,
        });
        notifications.show({
          title: 'Uspesna prijava',
          message: 'Dobrodosli nazad.',
          color: 'green',
        });
        navigate('/map');
        return;
      }

      if (mode === 'register') {
        await register({
          username,
          password: values.password,
        });
        notifications.show({
          title: 'Nalog je kreiran',
          message: 'Mozete da se prijavite novim kredencijalima.',
          color: 'green',
        });
        switchMode('login');
        return;
      }

      if (mode === 'forgot') {
        await forgotPassword({ username });
        notifications.show({
          title: 'Zahtev je poslat',
          message: 'U development okruzenju reset token proverite u backend konzoli.',
          color: 'blue',
        });
        switchMode('reset');
        return;
      }

      await resetPassword({
        username,
        token: values.token.trim(),
        newPassword: values.password,
      });
      notifications.show({
        title: 'Lozinka je promenjena',
        message: 'Sada mozete da se prijavite novom lozinkom.',
        color: 'green',
      });
      switchMode('login');
    } catch (error) {
      notifications.show({
        title: 'Greska',
        message: getErrorMessage(error),
        color: 'red',
      });
    }
  });

  const copy = authCopy[mode];
  const showPasswordFields = mode !== 'forgot';
  const showConfirmPassword = mode === 'register' || mode === 'reset';
  const showResetToken = mode === 'reset';

  return (
    <Paper radius="md" p="lg" withBorder>
      <Text size="xl" fw={700}>
        {copy.title}
      </Text>
      <Text c="dimmed" size="sm" mt={4} mb="lg">
        {copy.description}
      </Text>

      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            required
            label="Korisnicko ime"
            placeholder="npr. test_putnik"
            value={form.values.username}
            onChange={(event) => form.setFieldValue('username', event.currentTarget.value)}
            error={form.errors.username}
            autoComplete="username"
            radius="md"
          />

          {showResetToken && (
            <TextInput
              required
              label="Reset token"
              placeholder="Nalepite token iz backend konzole"
              value={form.values.token}
              onChange={(event) => form.setFieldValue('token', event.currentTarget.value)}
              error={form.errors.token}
              autoComplete="one-time-code"
              radius="md"
            />
          )}

          {showPasswordFields && (
            <PasswordInput
              required
              label={mode === 'reset' ? 'Nova lozinka' : 'Lozinka'}
              placeholder={mode === 'reset' ? 'Unesite novu lozinku' : 'Unesite lozinku'}
              value={form.values.password}
              onChange={(event) => form.setFieldValue('password', event.currentTarget.value)}
              error={form.errors.password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              radius="md"
            />
          )}

          {showConfirmPassword && (
            <PasswordInput
              required
              label="Potvrdite lozinku"
              placeholder="Ponovite lozinku"
              value={form.values.confirmPassword}
              onChange={(event) => form.setFieldValue('confirmPassword', event.currentTarget.value)}
              error={form.errors.confirmPassword}
              autoComplete="new-password"
              radius="md"
            />
          )}

          {(mode === 'forgot' || mode === 'reset') && (
            <Text c="dimmed" size="sm">
              U development okruzenju reset token se ispisuje u backend konzoli.
            </Text>
          )}
        </Stack>

        <Group justify="space-between" mt="xl" align="flex-start">
          <Stack gap={6}>
            {mode !== 'login' && (
              <Anchor component="button" type="button" onClick={() => switchMode('login')} size="xs">
                Povratak na prijavu
              </Anchor>
            )}
            {mode === 'login' && (
              <>
                <Anchor component="button" type="button" onClick={() => switchMode('register')} size="xs">
                  Nemate nalog? Registrujte se
                </Anchor>
                <Anchor component="button" type="button" onClick={() => switchMode('forgot')} size="xs">
                  Zaboravili ste lozinku?
                </Anchor>
              </>
            )}
            {mode === 'forgot' && (
              <Anchor component="button" type="button" onClick={() => switchMode('reset')} size="xs">
                Vec imate token? Resetujte lozinku
              </Anchor>
            )}
            {mode === 'reset' && (
              <Anchor component="button" type="button" onClick={() => switchMode('forgot')} size="xs">
                Zatrazite novi reset token
              </Anchor>
            )}
          </Stack>
          <Button type="submit" loading={isLoading} radius="xl">
            {copy.submitLabel}
          </Button>
        </Group>
      </form>
    </Paper>
  );
}
