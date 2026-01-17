import { createContext, useContext, useEffect, useState } from "react";

const ReservationContext = createContext();

export function ReservationProvider({ children }) {
  const [reservations, setReservations] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setReservations((prev) =>
        prev.filter(
          (r) => Date.now() - r.createdAt < 15 * 60 * 1000
        )
      );
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const addReservation = (reservation) => {
    setReservations((prev) => [...prev, reservation]);
  };

  return (
    <ReservationContext.Provider value={{ reservations, addReservation }}>
      {children}
    </ReservationContext.Provider>
  );
}

export const useReservations = () => useContext(ReservationContext);
