import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  chatAppearanceCssVars,
  DEFAULT_CHAT_APPEARANCE,
  loadChatAppearance,
  saveChatAppearance,
} from '../utils/chatAppearance.js';

const ChatAppearanceContext = createContext(null);

export function ChatAppearanceProvider({ children }) {
  const [appearance, setAppearanceState] = useState(() => loadChatAppearance());

  const updateAppearance = useCallback((updates = {}) => {
    setAppearanceState((prev) => saveChatAppearance({ ...prev, ...updates }));
  }, []);

  const resetAppearance = useCallback(() => {
    setAppearanceState(saveChatAppearance(DEFAULT_CHAT_APPEARANCE));
  }, []);

  const cssVars = useMemo(() => chatAppearanceCssVars(appearance), [appearance]);

  const value = useMemo(
    () => ({ appearance, cssVars, updateAppearance, resetAppearance }),
    [appearance, cssVars, updateAppearance, resetAppearance],
  );

  return (
    <ChatAppearanceContext.Provider value={value}>
      {children}
    </ChatAppearanceContext.Provider>
  );
}

export function useChatAppearance() {
  const context = useContext(ChatAppearanceContext);
  if (!context) {
    const appearance = DEFAULT_CHAT_APPEARANCE;
    return {
      appearance,
      cssVars: chatAppearanceCssVars(appearance),
      updateAppearance: () => {},
      resetAppearance: () => {},
    };
  }
  return context;
}
