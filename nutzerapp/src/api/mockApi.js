const LS_KEY = "ft_data_v1";

function load() {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) return JSON.parse(raw);

  const seed = {
    user: { id: "u1", full_name: "Gast", email: "gast@demo.ch" },
    restaurants: [
      {
        id: "r1",
        name: "Trattoria Roma",
        cuisine_type: "Italienisch",
        address: "Wien 1010",
        latitude: 48.2082,
        longitude: 16.3738,
        available_tables: 4,
        rating: 4.6,
        review_count: 128,
        price_level: "$$",
      },
      {
        id: "r2",
        name: "Sushi Hana",
        cuisine_type: "Japanisch",
        address: "Wien 1060",
        latitude: 48.1966,
        longitude: 16.3550,
        available_tables: 2,
        rating: 4.7,
        review_count: 90,
        price_level: "$$",
      },
    ],
    favorites: [],
    reservations: [],
    reviews: [],
  };
  localStorage.setItem(LS_KEY, JSON.stringify(seed));
  return seed;
}

function save(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export const api = {
  me: async () => load().user,

  listRestaurants: async () => load().restaurants,

  getRestaurant: async (id) => load().restaurants.find((r) => r.id === id),

  listFavorites: async () => load().favorites,

  toggleFavorite: async (restaurant) => {
    const data = load();
    const exists = data.favorites.find((f) => f.restaurant_id === restaurant.id);
    if (exists) {
      data.favorites = data.favorites.filter((f) => f.restaurant_id !== restaurant.id);
    } else {
      data.favorites.push({
        id: uid("fav"),
        restaurant_id: restaurant.id,
        restaurant_name: restaurant.name,
      });
    }
    save(data);
    return true;
  },

  listMyReservations: async (email) => {
    const data = load();
    return data.reservations.filter((r) => r.created_by === email).reverse();
  },

  createReservation: async ({ restaurantId, restaurantName, partySize, createdBy }) => {
    const data = load();
    const r = data.restaurants.find((x) => x.id === restaurantId);
    if (!r) throw new Error("Restaurant nicht gefunden");
    if (r.available_tables <= 0) throw new Error("Keine Tische verfügbar");

    r.available_tables -= 1;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

    const reservation = {
      id: uid("res"),
      restaurant_id: restaurantId,
      restaurant_name: restaurantName,
      party_size: partySize,
      reservation_time: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: "confirmed",
      qr_code: `FT-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      created_by: createdBy,
    };

    data.reservations.push(reservation);
    save(data);
    return reservation;
  },

  getReservation: async (reservationId) => {
    const data = load();
    return data.reservations.find((r) => r.id === reservationId);
  },

  updateReservation: async (reservationId, patch) => {
    const data = load();
    const idx = data.reservations.findIndex((r) => r.id === reservationId);
    if (idx === -1) throw new Error("Reservierung nicht gefunden");
    data.reservations[idx] = { ...data.reservations[idx], ...patch };
    save(data);
    return data.reservations[idx];
  },

  createReview: async ({ reservationId, restaurantId, rating, comment }) => {
    const data = load();
    data.reviews.push({
      id: uid("rev"),
      reservation_id: reservationId,
      restaurant_id: restaurantId,
      rating,
      comment,
      created_at: new Date().toISOString(),
    });

    // Update restaurant rating (simpler average)
    const reviews = data.reviews.filter((x) => x.restaurant_id === restaurantId);
    const avg = reviews.reduce((a, b) => a + b.rating, 0) / reviews.length;

    const r = data.restaurants.find((x) => x.id === restaurantId);
    if (r) {
      r.rating = Math.round(avg * 10) / 10;
      r.review_count = reviews.length;
    }

    save(data);
    return true;
  },
};
