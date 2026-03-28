import { X, CheckCircle2, AlertCircle } from "lucide-react";
import { useProjects } from "../contexts/ProjectContext";

const NotificationToast = () => {
  const { notification, dismissNotification } = useProjects();

  if (!notification) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[200] animate-toast-in">
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-modal backdrop-blur-xl border text-sm font-medium ${
          notification.type === "error"
            ? "bg-danger-500/15 border-danger-500/30 text-danger-400"
            : "bg-success-500/15 border-success-500/30 text-success-400"
        }`}
      >
        {notification.type === "error" ? (
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
        ) : (
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        )}
        <span>{notification.message}</span>
        <button
          onClick={dismissNotification}
          className="ml-2 p-0.5 rounded hover:bg-white/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default NotificationToast;
