import { useState } from "react";

const defaultFormData = {
  name: "",
  description: "",
  rules: [""],
  selectedPresets: [],
  gitUrl: "",
  anthropicApiKey: "",
  ghToken: "",
  ports: "",
};

export default function useProjectForm(initialData) {
  const [formData, setFormData] = useState(initialData || defaultFormData);
  const [errors, setErrors] = useState({});
  const [draggedRuleIndex, setDraggedRuleIndex] = useState(null);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handleRuleChange = (index, value) => {
    const newRules = [...formData.rules];
    newRules[index] = value;
    setFormData((prev) => ({ ...prev, rules: newRules }));
  };

  const addRule = () => {
    setFormData((prev) => ({ ...prev, rules: [...prev.rules, ""] }));
  };

  const removeRule = (index) => {
    if (formData.rules.length > 1) {
      const newRules = formData.rules.filter((_, i) => i !== index);
      setFormData((prev) => ({ ...prev, rules: newRules }));
    }
  };

  const moveRule = (fromIndex, toIndex) => {
    const newRules = [...formData.rules];
    const [moved] = newRules.splice(fromIndex, 1);
    newRules.splice(toIndex, 0, moved);
    setFormData((prev) => ({ ...prev, rules: newRules }));
  };

  const handlePresetsChange = (presets) => {
    setFormData((prev) => ({ ...prev, selectedPresets: presets }));
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Project name is required";
    if (!formData.description.trim())
      newErrors.description = "Description is required";
    const validRules = formData.rules.filter((r) => r.trim());
    const hasPresets = formData.selectedPresets.length > 0;
    if (validRules.length === 0 && !hasPresets)
      newErrors.rules = "Add at least one rule or select a preset";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const resetForm = (data) => {
    setFormData(data || defaultFormData);
    setErrors({});
    setDraggedRuleIndex(null);
  };

  const populateFromProject = (project) => {
    setFormData({
      name: project.name,
      description: project.description,
      rules: project.rules?.length > 0 ? [...project.rules] : [""],
      selectedPresets: project.selectedPresets || [],
      gitUrl: project.gitUrl || "",
      anthropicApiKey: project.containerEnv?.ANTHROPIC_API_KEY || "",
      ghToken: project.containerEnv?.GH_TOKEN || "",
      ports: (project.containerPorts || []).join(", "),
    });
    setErrors({});
  };

  return {
    formData,
    setFormData,
    errors,
    setErrors,
    draggedRuleIndex,
    setDraggedRuleIndex,
    handleInputChange,
    handleRuleChange,
    addRule,
    removeRule,
    moveRule,
    handlePresetsChange,
    validateForm,
    resetForm,
    populateFromProject,
  };
}
