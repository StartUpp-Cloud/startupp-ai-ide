import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import ProjectDetail from "./pages/ProjectDetail";
import CreateProject from "./pages/CreateProject";
import EditProject from "./pages/EditProject";
import { ProjectProvider } from "./contexts/ProjectContext";

function App() {
  return (
    <ProjectProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/new" element={<CreateProject />} />
          <Route path="/project/:id" element={<ProjectDetail />} />
          <Route path="/project/:id/edit" element={<EditProject />} />
        </Routes>
      </Layout>
    </ProjectProvider>
  );
}

export default App;
