import { Container, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconDeviceMobile, IconMapPin, IconRoute } from '@tabler/icons-react';
import { AuthenticationForm } from '../../../components/AuthenticationForm/AuthenticationForm';
import logoImg from '../../../assets/logo.png';
import classes from './LoginPage.module.css';

const features = [
  {
    icon: IconRoute,
    title: 'Паметно вођене руте',
    description: 'Опишите жељено путовање, а апликација га претвара у руту са градовима, описима и разлозима за свако стајање.',
  },
  {
    icon: IconDeviceMobile,
    title: 'Мапа и план на једном месту',
    description: 'Прегледајте стајалишта, трасу и детаље пута на интерактивној мапи без преласка кроз више екрана.',
  },
  {
    icon: IconMapPin,
    title: 'Сачувани предлози за следећи полазак',
    description: 'Креиране руте остају доступне да бисте им се вратили, дорадили их или обрисали када планирате нову авантуру.',
  },
];

export function LoginPage() {
  return (
    <div className={classes.page}>
      <Container size="lg" className={classes.container}>
        <div className={classes.layout}>
          <section className={classes.heroPanel}>
            <div className={classes.heroCard}>
              <Text className={classes.heroEyebrow}>АИ ПЛАНЕР ПУТОВАЊА</Text>
              <Title order={1} className={classes.heroTitle}>
                Испланирајте путовање, означите стајалишта и сачувајте целу руту на мапи.
              </Title>
              <Text className={classes.heroText}>
                Од викенд бекства до дужег road trip-а, апликација вам помаже да брзо добијете предлог руте, прегледате
                кључне тачке и наставите планирање кад год вам затреба.
              </Text>

              <div className={classes.featureList}>
                {features.map(({ icon: Icon, title, description }) => (
                  <div key={title} className={classes.featureItem}>
                    <ThemeIcon radius="xl" size={44} variant="light" color="indigo">
                      <Icon size={20} stroke={1.8} />
                    </ThemeIcon>
                    <div>
                      <Text fw={600}>{title}</Text>
                      <Text size="sm" c="dimmed" className={classes.featureText}>
                        {description}
                      </Text>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className={classes.formPanel}>
            <Stack gap="lg">
              <div className={classes.brandBlock}>
                <img src={logoImg} alt="АИ Планер Путовања" className={classes.logo} />
                <Text className={classes.brandText}>
                  Пријавите се или направите налог да бисте сачували своје руте и наставили планирање путовања.
                </Text>
              </div>
              <AuthenticationForm />
            </Stack>
          </section>
        </div>
      </Container>
    </div>
  );
}
