import React, { useEffect, useState } from 'react';
import { useGlideboardController } from './GlideboardContext.js';
import { useSignalValue } from './useSignalValue.js';
import { wbTheme } from './theme.js';
import type { GlideboardUser } from './types.js';
import { safeAwarenessEntries } from './collaboration/awareness.js';

export function CollaborationAvatars() {
  const controller = useGlideboardController();
  const [users, setUsers] = useState<Map<number, GlideboardUser>>(new Map());
  const awareness = useSignalValue(controller.awarenessSignal);

  useEffect(() => {
    if (!awareness) {
      setUsers(new Map());
      return;
    }

    const handleAwarenessChange = () => {
      const nextUsers = new Map<number, GlideboardUser>();
      for (const { clientId, user } of safeAwarenessEntries(awareness.getStates())) {
        nextUsers.set(clientId, user);
      }
      setUsers(nextUsers);
    };

    handleAwarenessChange();
    awareness.on('change', handleAwarenessChange);
    return () => {
      awareness.off('change', handleAwarenessChange);
    };
  }, [awareness]);

  if (users.size <= 1) return null; // don't show if just me

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        display: 'flex',
        gap: 8,
        zIndex: 100,
      }}
    >
      {Array.from(users.entries()).map(([clientID, user]) => {
        return (
          <div
            key={clientID}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: user.color || '#2563eb',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              fontWeight: 600,
              boxShadow: wbTheme.shadow,
              border: `2px solid ${wbTheme.surface}`,
              userSelect: 'none',
              cursor: 'default',
            }}
            title={user.name}
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
        );
      })}
    </div>
  );
}
