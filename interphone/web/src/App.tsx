import { Navigate, Route, Routes } from "react-router";
import VisitorPage from "./pages/VisitorPage";
import ResidentPage from "./pages/ResidentPage";

export default function App() {
  return (
    <Routes>
      <Route path="/d/:slug" element={<VisitorPage />} />
      <Route path="/app" element={<ResidentPage />} />
      {/* Push notifications deep-link here (see supabase/functions/ring). The dashboard shows the active visit. */}
      <Route path="/app/visit/:visitId" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
