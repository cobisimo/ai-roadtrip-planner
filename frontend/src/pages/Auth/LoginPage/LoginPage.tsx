import { useNavigate } from 'react-router-dom';
import { Container } from '@mantine/core';
import { AuthenticationForm } from '../../../components/AuthenticationForm/AuthenticationForm';
import { useAuth } from '../../../atoms/auth';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading } = useAuth();

  const handleLogin = async () => {
    await login({
      username: 'test_putnik',
      password: 'lozinka123'
    });
    navigate('/map');
  };

  return (
    <Container size={420} my={40}>
      <AuthenticationForm onLogin={handleLogin} isLoading={isLoading} />
    </Container>
  );
}
