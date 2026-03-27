import Dashboard from "./pages/Dashboard";
import { AppLoader } from "./components/AppLoader";

export function App() {
  return (
    <AppLoader>
      <Dashboard />
    </AppLoader>
  );
}
