import {
  createTheme,
  ColorSchemeScript,
  MantineProvider,
} from '@mantine/core';
import { Notifications } from '@mantine/notifications';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import 'leaflet/dist/leaflet.css';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { LoginPage } from './pages/Auth/LoginPage/LoginPage';
import { MapPage } from './pages/Map/MapPage/MapPage';
import { ProtectedRoute } from './components/ProtectedRoute';

const theme = createTheme({
  primaryColor: 'indigo',
});

export default function App() {
  return (
    <>
      <ColorSchemeScript defaultColorScheme="auto" />
      <MantineProvider defaultColorScheme="auto" theme={theme}>
        <Notifications />
        <Router>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/map" element={<MapPage />} />
            </Route>
            <Route path="/" element={<LoginPage />} />
          </Routes>
        </Router>
      </MantineProvider>
    </>
  );
}
