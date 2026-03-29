import {
  Anchor,
  Button,
  Checkbox,
  Divider,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { upperFirst, useToggle } from '@mantine/hooks';
import { GoogleButton } from './GoogleButton';

export function AuthenticationForm({ onLogin, isLoading }: { onLogin: () => void; isLoading: boolean }) {
  const [type, toggle] = useToggle(['login', 'register']);
  const form = useForm({
    initialValues: {
      email: '',
      name: '',
      password: '',
      terms: true,
    },

    validate: {
      email: (val) => (/^\S+@\S+$/.test(val) ? null : 'Invalid email'),
      password: (val) => (val.length <= 6 ? 'Password should include at least 6 characters' : null),
    },
  });

  return (
    <Paper radius="md" p="lg" withBorder>
      <Text size="lg" fw={500} c="bright">
        Welcome to Mantine, {type} with
      </Text>

      <Group grow mb="md" mt="md">
        <GoogleButton radius="xl">Google</GoogleButton>
      </Group>

      <Divider
        label="Or continue with email"
        labelPosition="center"
        my="lg"
        styles={{ label: { color: 'var(--mantine-color-bright)', opacity: 0.85 } }}
      />

      <form onSubmit={form.onSubmit(() => { onLogin() })}>
        <Stack>
          {type === 'register' && (
            <TextInput
              label="Name"
              placeholder="Your name"
              value={form.values.name}
              onChange={(event) => form.setFieldValue('name', event.currentTarget.value)}
              radius="md"
            />
          )}

          <TextInput
            required
            label="Email"
            placeholder="hello@mantine.dev"
            value={form.values.email}
            onChange={(event) => form.setFieldValue('email', event.currentTarget.value)}
            error={form.errors.email && 'Invalid email'}
            radius="md"
          />

          <PasswordInput
            required
            label="Password"
            placeholder="Your password"
            value={form.values.password}
            onChange={(event) => form.setFieldValue('password', event.currentTarget.value)}
            error={form.errors.password && 'Password should include at least 6 characters'}
            radius="md"
          />

          {type === 'register' && (
            <Checkbox
              label="I accept terms and conditions"
              checked={form.values.terms}
              onChange={(event) => form.setFieldValue('terms', event.currentTarget.checked)}
            />
          )}
        </Stack>

        <Group justify="space-between" mt="xl">
          <Anchor
            component="button"
            type="button"
            c="bright"
            opacity={0.85}
            onClick={() => toggle()}
            size="xs"
          >
            {type === 'register'
              ? 'Already have an account? Login'
              : "Don't have an account? Register"}
          </Anchor>
          <Button type="submit" loading={isLoading} radius="xl">
            {upperFirst(type)}
          </Button>
        </Group>
      </form>
    </Paper>
  );
}
