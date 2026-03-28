import { Link, useLocation } from "react-router-dom";
import {
  LayoutGrid,
  Globe,
  Zap,
  Terminal,
} from "lucide-react";

const Layout = ({ children }) => {
  const location = useLocation();

  const isActive = (path) => {
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
            {/* Logo — goes to IDE (home) */}
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 bg-green-500/10 text-green-400 hover:bg-green-500/20"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>IDE</span>
              </Link>

              <Link
                to="/dashboard"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                  isActive("/dashboard")
                    ? "text-primary-400 bg-primary-500/10"
                    : "text-surface-400 hover:text-surface-100 hover:bg-surface-750"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </Link>

              <Link
                to="/global-rules"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                  isActive("/global-rules")
                    ? "text-primary-400 bg-primary-500/10"
                    : "text-surface-400 hover:text-surface-100 hover:bg-surface-750"
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Global Rules</span>
              </Link>

              <Link
                to="/quick"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                  isActive("/quick")
                    ? "text-primary-400 bg-primary-500/10"
                    : "text-surface-400 hover:text-surface-100 hover:bg-surface-750"
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Quick Build</span>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>
    </div>
  );
};

export default Layout;
