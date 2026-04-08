import React from 'react';
import { Box, Text } from 'ink';
import type { SessionInfo } from '../client.js';

interface SessionListProps {
  sessions: SessionInfo[];
  selectedIndex: number;
}

export function SessionList({ sessions, selectedIndex }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">No active sessions</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold underline color="cyan">
        Sessions
      </Text>
      {sessions.map((session, index) => {
        const isSelected = index === selectedIndex;
        const statusColor = session.status === 'running' ? 'green' :
                           session.status === 'error' ? 'red' : 'gray';

        return (
          <Box key={session.sessionId} paddingY={0.5}>
            <Text color={isSelected ? 'cyan' : undefined}>
              {isSelected ? '▶ ' : '  '}
              <Text color={statusColor}>
                {session.status === 'running' ? '●' : '○'}
              </Text>
              {' '}
              <Text bold={isSelected}>
                {session.sessionId.slice(0, 30)}
                {session.sessionId.length > 30 ? '...' : ''}
              </Text>
            </Text>
            {session.activePersona && (
              <Text color="yellow"> [{session.activePersona}]</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
