import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import ProjectDetail from "./pages/ProjectDetail";
import CreateProject from "./pages/CreateProject";
import EditProject from "./pages/EditProject";
import GlobalRules from "./pages/GlobalRules";
import QuickPrompt from "./pages/QuickPrompt";
import IDE from "./pages/IDE";
import Onboarding from "./pages/Onboarding";
import { ProjectProvider } from "./contexts/ProjectContext";
import NotificationToast from "./components/NotificationToast";

function SetupGate({ children }) {
  const [status, setStatus] = useState(null); // null = loading, object = result

  useEffect(() => {
    checkSetup();
  }, []);

  const checkSetup = async () => {
    try {
      const res = await fetch("/api/setup-status");
      const data = await res.json();
      setStatus(data);
    } catch {
      // If API is down, show app anyway (don't block forever)
      setStatus({ setupComplete: true });
    }
  };

  // Called by Onboarding when setup is finished — re-check and unlock the gate
  const handleSetupComplete = () => {
    setStatus({ setupComplete: true });
  };

  // Loading
  if (status === null) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center shadow-glow">
            <span className="text-surface-950 font-display font-bold text-sm">P</span>
          </div>
          <div className="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Not set up — show onboarding
  if (!status.setupComplete) {
    return (
      <Routes>
        <Route path="/setup" element={<Onboarding onSetupComplete={handleSetupComplete} />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  // Set up — show normal app
  return children;
}

function App() {
  return (
    <ProjectProvider>
      <SetupGate>
        <Routes>
          {/* IDE is the default view - full screen, no layout */}
          <Route path="/" element={<IDE />} />
          <Route path="/ide" element={<Navigate to="/" replace />} />

          {/* Regular routes with layout */}
          <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
          <Route path="/project/new" element={<Layout><CreateProject /></Layout>} />
          <Route path="/project/:id" element={<Layout><ProjectDetail /></Layout>} />
          <Route path="/project/:id/edit" element={<Layout><EditProject /></Layout>} />
          <Route path="/global-rules" element={<Layout><GlobalRules /></Layout>} />
          <Route path="/quick" element={<Layout><QuickPrompt /></Layout>} />

          {/* Onboarding accessible even after setup */}
          <Route path="/setup" element={<Onboarding />} />
        </Routes>
      </SetupGate>
      <NotificationToast />
    </ProjectProvider>
  );
}

export default App;
