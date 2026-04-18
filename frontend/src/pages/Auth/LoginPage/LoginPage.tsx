import { Container } from '@mantine/core';
import { AuthenticationForm } from '../../../components/AuthenticationForm/AuthenticationForm';

export function LoginPage() {
  return (
    <Container size={420} my={40}>
      <AuthenticationForm />
    </Container>
  );
}
