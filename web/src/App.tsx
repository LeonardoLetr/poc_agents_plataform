import { AnimatePresence, motion } from "motion/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Aurora } from "./components/effects";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
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
import Llms from "./pages/Llms";

export default function App() {
  const location = useLocation();
  const health = useResource<Health>("/api/health");
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <Aurora />
      <Sidebar health={health.data} />
      <main className="min-w-0 flex-1">
        <TopBar />
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname.split("/")[1]}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-6"
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
              <Route path="/llms" element={<Llms health={health.data} onChange={health.reload} />} />
              <Route path="/settings" element={<Llms health={health.data} onChange={health.reload} />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
