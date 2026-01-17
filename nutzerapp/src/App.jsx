import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/layout/Layout";

import MapPage from "./pages/Map";
import RestaurantsPage from "./pages/Restaurants";
import RestaurantDetailPage from "./pages/RestaurantDetail";
import ProfilePage from "./pages/Profile";
import QRCheckinPage from "./pages/QRCheckin";
import RatingPage from "./pages/Rating";

import LoginPage from "./pages/Login";
import AuthCallbackPage from "./pages/AuthCallback";
import RequireAuth from "./auth/RequireAuth";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/restaurants" replace />} />

        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        <Route path="/map" element={<MapPage />} />
        <Route path="/restaurants" element={<RestaurantsPage />} />
        <Route path="/restaurant/:id" element={<RestaurantDetailPage />} />

        {/* Protected */}
        <Route
          path="/profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />
        <Route
          path="/qr/:reservationId"
          element={
            <RequireAuth>
              <QRCheckinPage />
            </RequireAuth>
          }
        />
        <Route
          path="/rating/:reservationId"
          element={
            <RequireAuth>
              <RatingPage />
            </RequireAuth>
          }
        />
      </Routes>
    </Layout>
  );
}
