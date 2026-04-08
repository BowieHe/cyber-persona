import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { DebugClient, type SessionInfo, type DebugEvent } from './client.js';
import { SessionList } from './components/SessionList.js';
import { EventStream } from './components/EventStream.js';
import { SteeringInput } from './components/SteeringInput.js';

const POLL_INTERVAL = 2000; // 2 seconds

export function App() {
  const { exit } = useApp();
  const [client] = useState(() => new DebugClient());

  // State
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [selectedSessionIndex, setSelectedSessionIndex] = useState(0);
  const [steeringInput, setSteeringInput] = useState('');
  const [isInputActive, setIsInputActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch sessions periodically
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const data = await client.listSessions();
        setSessions(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
      }
    };

    fetchSessions();
    const interval = setInterval(fetchSessions, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [client]);

  // Fetch events for selected session
  useEffect(() => {
    const selectedSession = sessions[selectedSessionIndex];
    if (!selectedSession) return;

    const fetchEvents = async () => {
      try {
        const data = await client.getEvents(selectedSession.sessionId);
        setEvents(data);
      } catch (err) {
        // Silent fail for events, don't spam error
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [client, sessions, selectedSessionIndex]);

  // Keyboard handling
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      exit();
      return;
    }

    if (isInputActive) {
      // Input mode
      if (key.return) {
        // Send steering
        const session = sessions[selectedSessionIndex];
        if (session && steeringInput.trim()) {
          client.steer(session.sessionId, steeringInput.trim());
          setSteeringInput('');
        }
        setIsInputActive(false);
      } else if (key.escape) {
        // Cancel input
        setSteeringInput('');
        setIsInputActive(false);
      } else if (key.backspace || key.delete) {
        setSteeringInput(prev => prev.slice(0, -1));
      } else if (input) {
        setSteeringInput(prev => prev + input);
      }
    } else {
      // Navigation mode
      if (key.upArrow) {
        setSelectedSessionIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedSessionIndex(prev => Math.min(sessions.length - 1, prev + 1));
      } else if (input === 's') {
        // Enter steering mode
        const session = sessions[selectedSessionIndex];
        if (session && session.status === 'running') {
          setIsInputActive(true);
        }
      }
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      {/* Error bar */}
      {error && (
        <Box padding={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {/* Main content */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Left: Session list */}
        <Box width="40%" flexDirection="column" borderStyle="single">
          <SessionList
            sessions={sessions}
            selectedIndex={selectedSessionIndex}
          />
        </Box>

        {/* Right: Events */}
        <Box width="60%" flexDirection="column" borderStyle="single">
          <EventStream events={events} />
        </Box>
      </Box>

      {/* Bottom: Input */}
      <Box flexDirection="column">
        <SteeringInput
          value={steeringInput}
          isActive={isInputActive}
        />
        {!isInputActive && (
          <Box padding={1}>
            <Text color="gray">
              ↑↓ Navigate | s: Steering | ESC/q: Quit
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
