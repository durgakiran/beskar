"use client";
import { useEffect } from "react";
import { useSessions } from "../hooks/useSessions";
import { useFocusContext } from "../../core/context/FocusContext";
import { Session } from "../types";

export default function SessionList() {
  const { sessions, loading, error, loadSessions } = useSessions();
  const { setSessions, currentSession, setCurrentSession } = useFocusContext();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    setSessions(sessions);
  }, [sessions, setSessions]);

  const handleSessionClick = (session: Session) => {
    setCurrentSession(session);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'completed': return 'bg-blue-100 text-blue-800';
      case 'interrupted': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  if (loading) {
    return (
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-4">Recent Sessions</h3>
        <div className="text-center text-gray-500">Loading sessions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-4">Recent Sessions</h3>
        <div className="text-center text-red-500">Failed to load sessions</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold mb-4">Recent Sessions</h3>
      {sessions.length === 0 ? (
        <div className="text-center text-gray-500">No sessions yet</div>
      ) : (
        <div className="space-y-2">
          {sessions.slice(0, 5).map((session) => (
            <div
              key={session.id}
              className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                currentSession?.id === session.id 
                  ? 'border-blue-500 bg-blue-50' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              onClick={() => handleSessionClick(session)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-medium capitalize">
                    {session.sessionType.replace('_', ' ')}
                  </h4>
                  <p className="text-sm text-gray-600">
                    {formatDuration(session.duration)} • {new Date(session.startedAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(session.status)}`}>
                  {session.status}
                </span>
              </div>
              {session.notes && (
                <p className="text-sm text-gray-600 mt-2">{session.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 