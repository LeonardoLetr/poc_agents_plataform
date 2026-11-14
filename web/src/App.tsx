import { AnimatePresence, motion } from "motion/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Aurora } from "./components/effects";
import { Sidebar } from "./components/Sidebar";
import type { Health } from "./lib/api";
import { useResource } from "./lib/hooks";
import Agents from "./pages/Agents";
import Audit from "./pages/Audit";
import Dashboard from "./pages/Dashboard";
import Learn from "./pages/Learn";
import Mcp from "./pages/Mcp";
import MemoryPage from "./pages/Memory";
import Playground from "./pages/Playground";
import Prompts from "./pages/Prompts";
import Settings from "./pages/Settings";

export default function App() {
  const location = useLocation();
  const health = useResource<Health>("/api/health");
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <Aurora />
      <Sidebar configured={health.data ? health.data.anthropicConfigured : null} />
      <main className="min-w-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname.split("/")[1]}
            initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-8"
          >
            <Routes location={location}>
              <Route path="/" element={<Dashboard health={health.data} />} />
              <Route path="/playground" element={<Playground />} />
              <Route path="/playground/:runId" element={<Playground />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/mcp" element={<Mcp />} />
              <Route path="/memory" element={<MemoryPage />} />
              <Route path="/prompts" element={<Prompts />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/learn" element={<Learn />} />
              <Route path="/settings" element={<Settings onSaved={health.reload} health={health.data} />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
