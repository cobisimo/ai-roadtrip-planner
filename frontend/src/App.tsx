import {
  createTheme,
  ColorSchemeScript,
  MantineProvider,
} from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import 'leaflet/dist/leaflet.css';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { LoginPage } from './pages/Auth/LoginPage/LoginPage';
import { MapPage } from './pages/Map/MapPage/MapPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PromptPage } from './pages/Map/PromptPage';

const theme = createTheme({
  primaryColor: 'indigo',
});

export default function App() {
  return (
    <>
      <ColorSchemeScript defaultColorScheme="auto" />
      <MantineProvider defaultColorScheme="auto" theme={theme}>
        <Notifications />
        <ModalsProvider />
        <Router>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/map" element={<MapPage />} />
              <Route path="/prompt" element={<PromptPage />} />
            </Route>
            <Route path="/" element={<LoginPage />} />
          </Routes>
        </Router>
      </MantineProvider>
    </>
  );
}
