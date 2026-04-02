import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  X,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ListChecks,
  Calendar,
} from 'lucide-react';

/**
 * NotificationCenter — bell icon with badge + dropdown panel for IDE alerts.
 *
 * Supports desktop (browser) notifications for critical events when the tab
 * is not focused.
 *
 * Integration TODO (IDE.jsx):
 *  1. Track `notifications` array in IDE state:
 *     `const [notifications, setNotifications] = useState([]);`
 *  2. Listen to WebSocket events for session status changes and push new
 *     notification objects: { id, type, title, detail, sessionId, timestamp, read }.
 *  3. Render <NotificationCenter /> inside <TopBar /> (top-right area).
 *  4. Wire `onClickNotification` to switch to the relevant session via
 *     onSwitchSession / setCurrentSessionId.
 *  5. On first mount, call `requestDesktopPermission()` (exported below)
 *     or let the component handle it internally on first interaction.
 */

// ── Notification type config ───────────────────────────────────────────────────
const TYPE_CONFIG = {
  'needs-input': {
    icon: AlertTriangle,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-400/10',
    borderColor: 'border-yellow-400/20',
    label: 'Needs Input',
  },
  'step-complete': {
    icon: CheckCircle2,
    color: 'text-green-400',
    bgColor: 'bg-green-400/10',
    borderColor: 'border-green-400/20',
    label: 'Step Complete',
  },
  'step-failed': {
    icon: AlertCircle,
    color: 'text-danger-400',
    bgColor: 'bg-danger-400/10',
    borderColor: 'border-danger-400/20',
    label: 'Step Failed',
  },
  'error-detected': {
    icon: AlertCircle,
    color: 'text-danger-400',
    bgColor: 'bg-danger-400/10',
    borderColor: 'border-danger-400/20',
    label: 'Error',
  },
  'plan-completed': {
    icon: ListChecks,
    color: 'text-primary-400',
    bgColor: 'bg-primary-400/10',
    borderColor: 'border-primary-400/20',
    label: 'Plan Done',
  },
  'schedule-complete': {
    icon: Calendar,
    color: 'text-primary-400',
    bgColor: 'bg-primary-400/10',
    borderColor: 'border-primary-400/20',
    label: 'Schedule Done',
  },
};

const DEFAULT_CONFIG = {
  icon: Bell,
  color: 'text-surface-400',
  bgColor: 'bg-surface-400/10',
  borderColor: 'border-surface-400/20',
  label: 'Info',
};

// ── Desktop notification helpers ───────────────────────────────────────────────

/**
 * Request permission for desktop notifications. Safe to call multiple times.
 * Returns the current permission state ('granted' | 'denied' | 'default').
 */
export function requestDesktopPermission() {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
  return Notification.permission;
}

/**
 * Send a browser desktop notification.
 * Only fires when:
 *  - The Notification API is available
 *  - Permission has been granted
 *  - The document is NOT focused (tab is in background)
 *
 * @param {string} title
 * @param {string} body
 * @param {object} options  — extra Notification options (icon, tag, etc.)
 * @returns {Notification|null}
 */
export function sendDesktopNotification(title, body, options = {}) {
  if (!('Notification' in window)) return null;
  if (Notification.permission !== 'granted') return null;
  if (document.hasFocus()) return null;

  try {
    const notification = new Notification(title, {
      body,
      icon: options.icon || '/favicon.ico',
      tag: options.tag || undefined,
      silent: options.silent ?? false,
      ...options,
    });

    // Auto-close after 8 seconds
    setTimeout(() => notification.close(), 8000);

    if (options.onClick) {
      notification.onclick = options.onClick;
    }

    return notification;
  } catch {
    // Notification constructor can throw in some environments
    return null;
  }
}

// Types that should trigger desktop notifications
const DESKTOP_NOTIFY_TYPES = new Set(['needs-input', 'error-detected']);

// ── Relative time formatter ────────────────────────────────────────────────────
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Single notification row ────────────────────────────────────────────────────
function NotificationRow({ notification, onClick, onDismiss }) {
  const [hovered, setHovered] = useState(false);
  const config = TYPE_CONFIG[notification.type] || DEFAULT_CONFIG;
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={() => onClick(notification)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`
        w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors cursor-pointer
        border-b border-surface-700/50 last:border-b-0
        ${notification.read
          ? 'opacity-60 hover:opacity-80'
          : 'hover:bg-surface-700/40'
        }
      `}
    >
      {/* Type icon */}
      <div className={`flex-shrink-0 mt-0.5 p-1 rounded ${config.bgColor}`}>
        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-surface-200 leading-tight">
          {notification.title}
        </div>
        {notification.detail && (
          <div className="text-[10px] text-surface-400 mt-0.5 truncate leading-tight">
            {notification.detail}
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-1">
          <Clock className="w-2.5 h-2.5 text-surface-500" />
          <span className="text-[9px] text-surface-500">
            {formatRelativeTime(notification.timestamp)}
          </span>
          {notification.projectName && (
            <>
              <span className="text-[9px] text-surface-600">·</span>
              <span className="text-[9px] text-surface-500 truncate">
                {notification.projectName}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Dismiss button — visible on hover */}
      {hovered && (
        <span
          role="button"
          tabIndex={-1}
          title="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
          className="flex-shrink-0 p-0.5 rounded hover:bg-surface-600 text-surface-500 hover:text-surface-300 transition-colors"
        >
          <X className="w-3 h-3" />
        </span>
      )}

      {/* Unread dot */}
      {!notification.read && (
        <span className="flex-shrink-0 w-1.5 h-1.5 mt-1.5 rounded-full bg-primary-400" />
      )}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function NotificationCenter({
  notifications = [],
  onDismiss,
  onDismissAll,
  onClickNotification,
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const bellRef = useRef(null);

  // Track the last notification count so we can fire desktop notifications
  // for newly added items only.
  const prevCountRef = useRef(notifications.length);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // ── Close dropdown on outside click ────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        bellRef.current && !bellRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Request desktop notification permission on mount ────────────────────────
  useEffect(() => {
    requestDesktopPermission();
  }, []);

  // ── Fire desktop notifications for new critical items ──────────────────────
  useEffect(() => {
    if (notifications.length <= prevCountRef.current) {
      prevCountRef.current = notifications.length;
      return;
    }

    // New notifications are the ones added since last render
    const newItems = notifications.slice(0, notifications.length - prevCountRef.current);
    prevCountRef.current = notifications.length;

    for (const item of newItems) {
      if (DESKTOP_NOTIFY_TYPES.has(item.type)) {
        sendDesktopNotification(item.title, item.detail || '', {
          tag: `ide-notification-${item.id}`,
          onClick: () => {
            window.focus();
            onClickNotification?.(item);
          },
        });
      }
    }
  }, [notifications, onClickNotification]);

  // ── Relative time updater (re-render every 30s to keep times fresh) ────────
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const handleClickNotification = useCallback(
    (notification) => {
      setOpen(false);
      onClickNotification?.(notification);
    },
    [onClickNotification],
  );

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`
          relative p-1.5 rounded-md transition-colors
          ${open
            ? 'bg-surface-700 text-surface-100'
            : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/60'
          }
        `}
        title="Notifications"
      >
        <Bell className="w-4 h-4" />

        {/* Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-danger-500 text-[8px] text-white font-bold leading-none tabular-nums">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[150] flex flex-col bg-surface-800 border border-surface-700 rounded-xl shadow-modal overflow-hidden"
            style={{
              top: (bellRef.current?.getBoundingClientRect().bottom ?? 40) + 6,
              right: Math.max(
                8,
                window.innerWidth -
                  (bellRef.current?.getBoundingClientRect().right ?? window.innerWidth),
              ),
              width: 320,
              maxHeight: 420,
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700 flex-shrink-0">
              <span className="text-[11px] font-medium text-surface-300 uppercase tracking-wide">
                Notifications
              </span>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onDismissAll?.();
                    setOpen(false);
                  }}
                  className="text-[10px] text-surface-500 hover:text-surface-300 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Notification list */}
            <div className="flex-1 min-h-0 overflow-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell className="w-6 h-6 text-surface-600 mx-auto mb-2" />
                  <div className="text-[11px] text-surface-500">
                    No notifications yet
                  </div>
                </div>
              ) : (
                notifications.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    onClick={handleClickNotification}
                    onDismiss={onDismiss}
                  />
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
