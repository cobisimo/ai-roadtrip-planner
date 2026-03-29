import { Navigate, Outlet } from 'react-router-dom';
import { useAtom } from 'jotai';
import { tokenAtom } from '../atoms/auth';

export const ProtectedRoute = () => {
  const [token] = useAtom(tokenAtom);

  if (token === null) return;

  if (!token) {
    // Redirect to login if not authenticated
    return <Navigate to="/login" replace />;
  }

  // Render child routes
  return <Outlet />;
};
