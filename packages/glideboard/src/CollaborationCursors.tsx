import React, { useEffect, useState } from 'react';
import { awarenessSignal, wbEditor } from './editor';
import { useSignalValue } from './useSignalValue';
import type { Vec2 } from '@durgakiran/glideline';
import type { GlideboardUser } from './types';

interface CursorState {
  user: GlideboardUser;
  cursor: Vec2;
}

export function CollaborationCursors() {
  const [cursors, setCursors] = useState<Map<number, CursorState>>(new Map());
  const camera = useSignalValue(wbEditor.camera.signal)!;
  const awareness = useSignalValue(awarenessSignal);

  useEffect(() => {
    if (!awareness) return;

    const handleAwarenessChange = () => {
      const states = awareness.getStates();
      const nextCursors = new Map<number, CursorState>();
      states.forEach((state: any, clientID: number) => {
        if (clientID !== awareness.clientID && state.user && state.cursor) {
          nextCursors.set(clientID, { user: state.user, cursor: state.cursor });
        }
      });
      setCursors(nextCursors);
    };

    handleAwarenessChange();
    awareness.on('change', handleAwarenessChange);
    return () => {
      awareness.off('change', handleAwarenessChange);
    };
  }, [awareness]);

  if (cursors.size === 0) return null;

  const { x: cx, y: cy, z: zoom } = camera;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 100,
      }}
    >
      {Array.from(cursors.entries()).map(([clientID, { user, cursor }]) => {
        const screenX = (cursor.x - cx) * zoom;
        const screenY = (cursor.y - cy) * zoom;

        return (
          <div
            key={clientID}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(${screenX}px, ${screenY}px)`,
              transition: 'transform 0.1s linear',
              pointerEvents: 'none',
            }}
          >
            <svg
              width="24"
              height="36"
              viewBox="0 0 24 36"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{
                position: 'absolute',
                left: -4,
                top: -4,
                filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.2))'
              }}
            >
              <path
                d="M5.65376 2.15376C5.40134 1.90134 5 2.08036 5 2.43769V26.2415C5 26.6576 5.50346 26.8658 5.79796 26.5713L11.5303 20.8389C11.671 20.6983 11.8617 20.6193 12.0607 20.6193H21.5C21.8573 20.6193 22.0363 20.1806 21.7839 19.9282L5.65376 2.15376Z"
                fill={user.color || '#2563eb'}
                stroke="white"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                left: 12,
                top: 24,
                background: user.color || '#2563eb',
                color: 'white',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                fontFamily: 'inherit',
              }}
            >
              {user.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
