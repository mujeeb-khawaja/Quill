import { useState, useEffect } from "react";
import Dashboard from "./pages/Dashboard";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import { AppLoader } from "./components/AppLoader";

type View = "main" | "admin-login" | "admin-dashboard";

function getInitialView(): View {
  const hash = window.location.hash;
  if (hash === "#/admin" || hash.startsWith("#/admin/")) {
    return localStorage.getItem("quill_admin_token") ? "admin-dashboard" : "admin-login";
  }
  return "main";
}

export function App() {
  const [view, setView] = useState<View>(getInitialView);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      if (hash === "#/admin" || hash.startsWith("#/admin/")) {
        setView(localStorage.getItem("quill_admin_token") ? "admin-dashboard" : "admin-login");
      } else {
        setView("main");
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleLogin = () => setView("admin-dashboard");

  const handleLogout = () => {
    localStorage.removeItem("quill_admin_token");
    localStorage.removeItem("quill_admin_username");
    setView("admin-login");
  };

  if (view === "admin-login") return <AdminLogin onLogin={handleLogin} />;
  if (view === "admin-dashboard") return <AdminDashboard onLogout={handleLogout} />;

  return (
    <AppLoader>
      <Dashboard />
    </AppLoader>
  );
}
