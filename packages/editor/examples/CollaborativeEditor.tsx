import React, { useEffect, useState } from 'react';
import { Editor } from '@beskar/editor';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import '@beskar/editor/styles.css';

/**
 * Collaborative Editor Example
 * 
 * This example shows how to set up real-time collaboration:
 * - Y.js document
 * - Hocuspocus provider for WebSocket sync
 * - User presence with colored cursors
 * - Connection status
 */

interface User {
  id: string;
  name: string;
  color: string;
}

const WEBSOCKET_URL = 'ws://localhost:1234';
const DOCUMENT_NAME = 'demo-document';

// Generate random color for user
const generateColor = () => {
  const colors = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#10b981', // green
    '#f59e0b', // amber
    '#8b5cf6', // purple
    '#ec4899', // pink
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

export function CollaborativeEditorExample() {
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [user, setUser] = useState<User>({
    id: `user-${Math.random().toString(36).substr(2, 9)}`,
    name: `User ${Math.floor(Math.random() * 100)}`,
    color: generateColor(),
  });
  const [isConnected, setIsConnected] = useState(false);
  const [activeUsers, setActiveUsers] = useState<User[]>([]);

  useEffect(() => {
    // Create Y.js document
    const doc = new Y.Doc();

    // Create Hocuspocus provider
    const hocuspocusProvider = new HocuspocusProvider({
      url: WEBSOCKET_URL,
      name: DOCUMENT_NAME,
      document: doc,
      onConnect: () => {
        console.log('Connected to collaboration server');
        setIsConnected(true);
      },
      onDisconnect: () => {
        console.log('Disconnected from collaboration server');
        setIsConnected(false);
      },
      onStatus: ({ status }) => {
        console.log('Status:', status);
      },
    });

    setProvider(hocuspocusProvider);

    // Cleanup on unmount
    return () => {
      hocuspocusProvider.destroy();
    };
  }, []);

  const handleNameChange = (newName: string) => {
    setUser({ ...user, name: newName });
  };

  if (!provider) {
    return <div>Loading editor...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-4">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Collaborative Editor</h1>
          <div className="flex items-center gap-4">
            <div className={`px-3 py-1 rounded text-sm ${isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {isConnected ? '● Connected' : '● Disconnected'}
            </div>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Your Name:</label>
              <input
                type="text"
                value={user.name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Your Color:</label>
              <div
                className="w-12 h-10 rounded border border-gray-300"
                style={{ backgroundColor: user.color }}
              />
            </div>
          </div>
          <p className="text-sm text-gray-600 mt-2">
            Open this page in multiple tabs or browsers to see real-time collaboration!
          </p>
        </div>

        {activeUsers.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium mb-2">Active Users:</h3>
            <div className="flex gap-2">
              {activeUsers.map((u) => (
                <div
                  key={u.id}
                  className="px-3 py-1 rounded text-sm"
                  style={{
                    backgroundColor: `${u.color}20`,
                    borderLeft: `3px solid ${u.color}`,
                  }}
                >
                  {u.name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border border-gray-300 rounded-lg p-4 min-h-[500px]">
        <Editor
          editable={true}
          placeholder="Start collaborating..."
          collaboration={{
            provider,
            user,
          }}
          onUpdate={(content) => {
            console.log('Content updated:', content);
          }}
          onReady={(editor) => {
            console.log('Editor ready with collaboration:', editor);
          }}
        />
      </div>

      <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
        <h3 className="font-semibold mb-2">Setup Instructions:</h3>
        <ol className="text-sm space-y-1 list-decimal list-inside">
          <li>Make sure your Hocuspocus server is running on {WEBSOCKET_URL}</li>
          <li>Open this page in multiple tabs to see real-time collaboration</li>
          <li>Watch as cursors and changes sync across all instances</li>
        </ol>
      </div>
    </div>
  );
}

