import { Navigate, Outlet } from 'react-router-dom';
import { useAtom } from 'jotai';
import { tokenAtom, useCurrentUser } from '../atoms/auth';

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

export const RoleRoute = ({ adminOnly = false, userOnly = false }: { adminOnly?: boolean; userOnly?: boolean }) => {
  const { data: currentUser, isLoading, isError } = useCurrentUser();

  if (isLoading) return null;
  if (isError || !currentUser) return <Navigate to="/login" replace />;

  if (adminOnly && currentUser.role !== 'admin') {
    return <Navigate to="/map" replace />;
  }

  if (userOnly && currentUser.role === 'admin') {
    return <Navigate to="/admin" replace />;
  }

  return <Outlet />;
};
