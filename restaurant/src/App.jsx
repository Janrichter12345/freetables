import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Restaurant/Dashboard";
import Login from "./pages/Login";
import RestaurantDetails from "./pages/Restaurant/RestaurantDetails";

export default function App() {
  return (
    // ✅ alles in dieser App hängt unter /partner
    <BrowserRouter basename="/partner">
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/restaurant-details" element={<RestaurantDetails />} />
      </Routes>
    </BrowserRouter>
  );
}
