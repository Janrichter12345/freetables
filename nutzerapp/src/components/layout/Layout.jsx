import { Link, useLocation } from "react-router-dom";
import { Map, List, User } from "lucide-react";
import logo from "../../assets/logo.png";

export default function Layout({ children }) {
  const { pathname } = useLocation();

  const nav = [
    { to: "/map", label: "Karte", icon: Map },
    { to: "/restaurants", label: "Liste", icon: List },
    { to: "/profile", label: "Profil", icon: User },
  ];

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      {/* FIXED HEADER */}
      <header className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-[#E7E2D7] z-50">
        <div className="h-full max-w-5xl mx-auto flex items-center px-4 gap-3">
          <img src={logo} alt="Free Tables" className="h-9 w-auto" />
          <span className="text-lg font-semibold text-[#2E2E2E]">Free Tables</span>
        </div>
      </header>

      {/* CONTENT (Platz für Header + BottomNav) */}
      <main className="pt-14 pb-14">{children}</main>

      {/* FIXED BOTTOM NAV */}
      <nav className="fixed bottom-0 left-0 right-0 h-14 bg-white border-t border-[#E7E2D7] z-50">
        <div className="h-full max-w-md mx-auto px-4 flex items-center justify-between">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-col items-center justify-center gap-1 px-3 h-full text-[11px] ${
                  active ? "text-[#2E2E2E]" : "text-[#9AA7B8]"
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? "text-[#A8BCA1]" : ""}`} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
