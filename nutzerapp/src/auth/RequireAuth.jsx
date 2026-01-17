import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();

  if (loading) return null; // oder Loader UI
  if (!user) {
    localStorage.setItem("postLoginRedirect", loc.pathname + loc.search);
    return <Navigate to="/login" replace />;
  }
  return children;
}
