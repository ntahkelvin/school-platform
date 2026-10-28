import { useEffect, useState } from "react";
import { api, ApiError, getToken, setToken, type Me } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";
import SchoolPage from "./SchoolPage";
import BranchPage from "./BranchPage";
import StudentPage from "./StudentPage";
import { useRoute } from "./router";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const route = useRoute();

  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setToken(null);
      })
      .finally(() => setChecking(false));
  }, []);

  function logout() {
    setToken(null);
    setMe(null);
    window.location.hash = "";
  }

  if (checking) return <div className="center muted">Loading…</div>;
  if (!me) return <Login onLoggedIn={setMe} />;

  const common = { me, onLogout: logout };
  switch (route.page) {
    case "school":
      return <SchoolPage key={route.id} {...common} schoolId={route.id} />;
    case "branch":
      return <BranchPage key={route.id} {...common} branchId={route.id} tab={route.tab} />;
    case "student":
      return <StudentPage key={route.id} {...common} studentId={route.id} />;
    default:
      return <Dashboard {...common} />;
  }
}
