import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { ReservationProvider } from "./context/ReservationContext";
import { AuthProvider } from "./auth/AuthProvider";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ReservationProvider>
          <App />
        </ReservationProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
