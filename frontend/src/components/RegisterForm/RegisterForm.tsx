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
        Регистрација
      </Title>

      <Paper withBorder shadow="sm" p={22} mt={30} radius="md">
        <TextInput label="Имејл" placeholder="ви@пример.срб" required radius="md" />
        <PasswordStrength />
        <Button fullWidth mt="xl" radius="md">
          Региструј се
        </Button>
      </Paper>
    </Container>
  );
}
