import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import ProjectDetail from "./pages/ProjectDetail";
import CreateProject from "./pages/CreateProject";
import EditProject from "./pages/EditProject";
import GlobalRules from "./pages/GlobalRules";
import QuickPrompt from "./pages/QuickPrompt";
import IDE from "./pages/IDE";
import { ProjectProvider } from "./contexts/ProjectContext";

function App() {
  return (
    <ProjectProvider>
      <Routes>
        {/* IDE route - full screen, no layout */}
        <Route path="/ide" element={<IDE />} />

        {/* Regular routes with layout */}
        <Route element={<Layout><Routes><Route path="*" element={null} /></Routes></Layout>}>
        </Route>
        <Route path="/" element={<Layout><Dashboard /></Layout>} />
        <Route path="/project/new" element={<Layout><CreateProject /></Layout>} />
        <Route path="/project/:id" element={<Layout><ProjectDetail /></Layout>} />
        <Route path="/project/:id/edit" element={<Layout><EditProject /></Layout>} />
        <Route path="/global-rules" element={<Layout><GlobalRules /></Layout>} />
        <Route path="/quick" element={<Layout><QuickPrompt /></Layout>} />
      </Routes>
    </ProjectProvider>
  );
}

export default App;
