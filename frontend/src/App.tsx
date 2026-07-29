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
import { ProtectedRoute, RoleRoute } from './components/ProtectedRoute';
import { PromptPage } from './pages/Map/PromptPage';
import { AdminPage } from './pages/AdminPage';

const theme = createTheme({
  primaryColor: 'indigo',
});

export default function App() {
  return (
    <>
      <ColorSchemeScript defaultColorScheme="auto" />
      <MantineProvider defaultColorScheme="auto" theme={theme}>
        <Notifications position="top-right" />
        <ModalsProvider />
        <Router>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<RoleRoute userOnly />}>
                <Route path="/map" element={<MapPage />} />
                <Route path="/prompt" element={<PromptPage />} />
              </Route>
              <Route element={<RoleRoute adminOnly />}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
            </Route>
            <Route path="/" element={<LoginPage />} />
          </Routes>
        </Router>
      </MantineProvider>
    </>
  );
}
