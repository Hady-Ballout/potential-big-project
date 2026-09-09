import { Navigate, Route, Routes } from "react-router";
import VisitorPage from "./pages/VisitorPage";
import ResidentPage from "./pages/ResidentPage";

export default function App() {
  return (
    <Routes>
      <Route path="/d/:slug" element={<VisitorPage />} />
      <Route path="/app" element={<ResidentPage />} />
      <Route path="/app/visit/:visitId" element={<ResidentPage />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
