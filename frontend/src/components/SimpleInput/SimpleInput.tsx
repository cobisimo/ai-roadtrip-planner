import { IconArrowRight, IconSearch } from '@tabler/icons-react';
import { ActionIcon, TextInput, useMantineTheme } from '@mantine/core';
import { getHotkeyHandler } from '@mantine/hooks';

export function SimpleInput({ onChange, onClick }: { onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; onClick: () => void }) {
  const theme = useMantineTheme();

  return (
    <TextInput
      radius="xl"
      size="xl"
      placeholder="Нпр. Пут од Београда до Прага..."
      rightSectionWidth={60}
      leftSection={<IconSearch size={24} stroke={1.5} />}
      rightSection={
        <ActionIcon
          size={48}
          radius="xl"
          color={theme.primaryColor}
          variant="filled"
          aria-label="Search"
          onClick={onClick}
        >
          <IconArrowRight size={24} stroke={1.5} />
        </ActionIcon>
      }
      onChange={onChange}
      onKeyDown={getHotkeyHandler([
        ['Enter', onClick],
      ])}
      flex={1}
      aria-label="Search questions"
    />
  );
}
