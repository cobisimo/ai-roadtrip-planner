import {
  Button,
  Container,
  Paper,
  TextInput,
  Title,
} from '@mantine/core';
import classes from './RegisterForm.module.css';
import { PasswordStrength } from '../PasswordStrength/PasswordStrength';

export function RegisterForm() {
  return (
    <Container size={420} my={40}>
      <Title ta="center" className={classes.title}>
        Register
      </Title>

      <Paper withBorder shadow="sm" p={22} mt={30} radius="md">
        <TextInput label="Email" placeholder="you@mantine.dev" required radius="md" />
        <PasswordStrength />
        <Button fullWidth mt="xl" radius="md">
          Register
        </Button>
      </Paper>
    </Container>
  );
}
