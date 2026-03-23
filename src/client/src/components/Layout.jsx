import { Link, useLocation } from "react-router-dom";
import { Plus, LayoutGrid, X, CheckCircle2, AlertCircle } from "lucide-react";
import { useProjects } from "../contexts/ProjectContext";

const Layout = ({ children }) => {
  const location = useLocation();
  const { notification, dismissNotification } = useProjects();

  const isActive = (path) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-surface-900 flex flex-col">
      {/* Signature gradient accent bar */}
      <div className="gradient-bar h-[2px] w-full flex-shrink-0" />

      {/* Header */}
      <header className="bg-surface-850/80 backdrop-blur-xl border-b border-surface-700/60 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="w-7 h-7 rounded-lg bg-primary-500 flex items-center justify-center shadow-glow group-hover:shadow-glow-lg transition-shadow duration-300">
                <span className="text-surface-950 font-display font-bold text-xs">
                  P
                </span>
              </div>
              <span className="font-display font-semibold text-[15px] text-surface-100 tracking-tight">
                Prompt Maker
              </span>
            </Link>

            {/* Nav */}
            <nav className="flex items-center gap-1">
              <Link
                to="/"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                  isActive("/")
                    ? "text-primary-400 bg-primary-500/10"
                    : "text-surface-400 hover:text-surface-100 hover:bg-surface-750"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Projects</span>
              </Link>

              <div className="w-px h-5 bg-surface-700 mx-1" />

              <Link to="/project/new" className="btn-primary !py-1.5 !px-3 !text-xs !gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                <span>New</span>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>

      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 animate-toast-in">
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
      )}
    </div>
  );
};

export default Layout;
