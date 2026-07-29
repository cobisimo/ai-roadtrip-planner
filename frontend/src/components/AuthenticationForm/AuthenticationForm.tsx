import {
  Anchor,
  Button,
  Divider,
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
import { GoogleButton } from './GoogleButton';
import classes from './AuthenticationForm.module.css';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

type AuthFormValues = {
  username: string;
  password: string;
  confirmPassword: string;
  token: string;
};

const authCopy: Record<AuthMode, { title: string; description: string; submitLabel: string }> = {
  login: {
    title: 'Пријава',
    description: 'Унесите корисничко име и лозинку да бисте наставили.',
    submitLabel: 'Пријави се',
  },
  register: {
    title: 'Регистрација',
    description: 'Направите нови налог за планирање путовања.',
    submitLabel: 'Региструј се',
  },
  forgot: {
    title: 'Заборављена лозинка',
    description: 'Послаћемо захтев за ресетовање лозинке за унето корисничко име.',
    submitLabel: 'Пошаљи захтев',
  },
  reset: {
    title: 'Ресет лозинке',
    description: 'Унесите ресет токен и поставите нову лозинку.',
    submitLabel: 'Сачувај нову лозинку',
  },
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Дошло је до грешке при обради захтева.';
};

export function AuthenticationForm() {
  const navigate = useNavigate();
  const { login, register, forgotPassword, resetPassword, startGoogleAuth, isLoading } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const form = useForm({
    initialValues: {
      username: '',
      password: '',
      confirmPassword: '',
      token: '',
    },
    validate: {
      username: (value) => (value.trim().length === 0 ? 'Корисничко име је обавезно.' : null),
      password: (value) => {
        if (mode === 'forgot') {
          return null;
        }

        return value.length < 6 ? 'Лозинка мора да садржи најмање 6 карактера.' : null;
      },
      confirmPassword: (value, values) => {
        if (mode !== 'register' && mode !== 'reset') {
          return null;
        }

        if (value.length === 0) {
          return 'Потврдите лозинку.';
        }

        return value !== values.password ? 'Лозинке се не поклапају.' : null;
      },
      token: (value) => {
        if (mode !== 'reset') {
          return null;
        }

        return value.trim().length === 0 ? 'Ресет токен је обавезан.' : null;
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
          title: 'Успешна пријава',
          message: 'Добро дошли назад.',
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
          title: 'Налог је креиран',
          message: 'Можете да се пријавите новим креденцијалима.',
          color: 'green',
        });
        switchMode('login');
        return;
      }

      if (mode === 'forgot') {
        await forgotPassword({ username });
        notifications.show({
          title: 'Захтев је послат',
          message: 'У развојном окружењу ресет токен проверите у бекенд конзоли.',
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
        title: 'Лозинка је промењена',
        message: 'Сада можете да се пријавите новом лозинком.',
        color: 'green',
      });
      switchMode('login');
    } catch (error) {
      notifications.show({
        title: 'Грешка',
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
    <Paper radius="xl" p="lg" withBorder shadow="xl" className={classes.card}>
      <Text size="xl" fw={700}>
        {copy.title}
      </Text>
      <Text c="dimmed" size="sm" mt={4} mb="lg">
        {copy.description}
      </Text>

      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            required
            label="Корисничко име"
            placeholder="нпр. test_putnik"
            value={form.values.username}
            onChange={(event) => form.setFieldValue('username', event.currentTarget.value)}
            error={form.errors.username}
            autoComplete="username"
            radius="md"
            size="md"
          />

          {showResetToken && (
            <TextInput
              required
              label="Ресет токен"
              placeholder="Налепите токен из бекенд конзоле"
              value={form.values.token}
              onChange={(event) => form.setFieldValue('token', event.currentTarget.value)}
              error={form.errors.token}
              autoComplete="one-time-code"
              radius="md"
              size="md"
            />
          )}

          {showPasswordFields && (
            <PasswordInput
              required
              label={mode === 'reset' ? 'Нова лозинка' : 'Лозинка'}
              placeholder={mode === 'reset' ? 'Унесите нову лозинку' : 'Унесите лозинку'}
              value={form.values.password}
              onChange={(event) => form.setFieldValue('password', event.currentTarget.value)}
              error={form.errors.password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              radius="md"
              size="md"
            />
          )}

          {showConfirmPassword && (
            <PasswordInput
              required
              label="Потврдите лозинку"
              placeholder="Поновите лозинку"
              value={form.values.confirmPassword}
              onChange={(event) => form.setFieldValue('confirmPassword', event.currentTarget.value)}
              error={form.errors.confirmPassword}
              autoComplete="new-password"
              radius="md"
              size="md"
            />
          )}

          {(mode === 'forgot' || mode === 'reset') && (
            <Text c="dimmed" size="sm" className={classes.helperText}>
              У развојном окружењу ресет токен се исписује у бекенд конзоли.
            </Text>
          )}
        </Stack>

        <div className={classes.footer}>
          <Stack gap={6} className={classes.linkGroup}>
            {mode !== 'login' && (
              <Anchor component="button" type="button" onClick={() => switchMode('login')} size="xs">
                Повратак на пријаву
              </Anchor>
            )}
            {mode === 'login' && (
              <>
                <Anchor component="button" type="button" onClick={() => switchMode('register')} size="xs">
                  Немате налог? Региструјте се
                </Anchor>
                <Anchor component="button" type="button" onClick={() => switchMode('forgot')} size="xs">
                  Заборавили сте лозинку?
                </Anchor>
              </>
            )}
            {mode === 'forgot' && (
              <Anchor component="button" type="button" onClick={() => switchMode('reset')} size="xs">
                Већ имате токен? Ресетујте лозинку
              </Anchor>
            )}
            {mode === 'reset' && (
              <Anchor component="button" type="button" onClick={() => switchMode('forgot')} size="xs">
                Затражите нови ресет токен
              </Anchor>
            )}
          </Stack>
          <Button type="submit" loading={isLoading} radius="xl" size="md" className={classes.submitButton}>
            {copy.submitLabel}
          </Button>
        </div>

        {(mode === 'login' || mode === 'register') && (
          <Stack gap="sm" mt="lg">
            <Divider label="или" labelPosition="center" />
            <GoogleButton
              type="button"
              fullWidth
              radius="xl"
              size="md"
              onClick={startGoogleAuth}
              disabled={isLoading}
            >
              Наставите са Google налогом
            </GoogleButton>
          </Stack>
        )}
      </form>
    </Paper>
  );
}
