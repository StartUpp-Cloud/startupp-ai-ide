import { createContext, useContext, useState, useEffect, useCallback } from "react";

const ProjectContext = createContext();

export const useProjects = () => {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProjects must be used within a ProjectProvider");
  }
  return context;
};

export const ProjectProvider = ({ children }) => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notification, setNotification] = useState(null);

  const notify = useCallback((message, type = "success") => {
    const id = Date.now();
    setNotification({ message, type, id });
    setTimeout(() => {
      setNotification((prev) => (prev?.id === id ? null : prev));
    }, 3000);
  }, []);

  const dismissNotification = useCallback(() => {
    setNotification(null);
  }, []);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      const data = await response.json();
      setProjects(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createProject = async (projectData) => {
    try {
      setLoading(true);
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectData),
      });
      if (!response.ok) throw new Error("Failed to create project");
      const newProject = await response.json();
      setProjects((prev) => [newProject, ...prev]);
      notify("Project created");
      return newProject;
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getProject = async (id) => {
    try {
      const response = await fetch(`/api/projects/${id}`);
      if (!response.ok) throw new Error("Failed to fetch project");
      return await response.json();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateProject = async (id, projectData) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectData),
      });
      if (!response.ok) throw new Error("Failed to update project");
      const updatedProject = await response.json();
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? updatedProject : p))
      );
      notify("Project updated");
      return updatedProject;
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const deleteProject = async (id) => {
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete project");
      setProjects((prev) => prev.filter((p) => p.id !== id));
      notify("Project deleted");
      return true;
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
      throw err;
    }
  };

  const cloneProject = async (id, projectData = {}) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectData),
      });
      if (!response.ok) throw new Error("Failed to clone project");
      const clonedProject = await response.json();
      setProjects((prev) => [clonedProject, ...prev]);
      notify("Project cloned");
      return clonedProject;
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const createPrompt = async (projectId, promptData) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(promptData),
      });
      if (!response.ok) throw new Error("Failed to create prompt");
      const newPrompt = await response.json();
      notify("Prompt saved");
      return newPrompt;
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
      throw err;
    }
  };

  const getPrompts = async (projectId, page = 1, limit = 10, search = "") => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(search && { search }),
      });
      const response = await fetch(
        `/api/projects/${projectId}/prompts?${params}`
      );
      if (!response.ok) throw new Error("Failed to fetch prompts");
      return await response.json();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const deletePrompt = async (projectId, promptId) => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/prompts/${promptId}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Failed to delete prompt");
      notify("Prompt deleted");
      return true;
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
      throw err;
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const value = {
    projects,
    loading,
    error,
    notification,
    notify,
    dismissNotification,
    fetchProjects,
    createProject,
    getProject,
    updateProject,
    deleteProject,
    cloneProject,
    createPrompt,
    getPrompts,
    deletePrompt,
  };

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
};
