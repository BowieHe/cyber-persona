import React from 'react';
import { Box, Text } from 'ink';
import type { DebugEvent } from '../client.js';

interface EventStreamProps {
  events: DebugEvent[];
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toTimeString().slice(0, 8);
}

function getEventIcon(type: DebugEvent['type']): string {
  switch (type) {
    case 'plan': return '📋';
    case 'announce': return '🎭';
    case 'persona_start': return '⏳';
    case 'persona_output': return '💬';
    case 'steering': return '✏️';
    case 'done': return '✅';
    case 'error': return '❌';
    default: return '•';
  }
}

function getEventColor(type: DebugEvent['type']): string {
  switch (type) {
    case 'plan': return 'blue';
    case 'announce': return 'cyan';
    case 'persona_start': return 'yellow';
    case 'persona_output': return 'green';
    case 'steering': return 'magenta';
    case 'done': return 'gray';
    case 'error': return 'red';
    default: return 'white';
  }
}

function renderEventContent(event: DebugEvent): string {
  switch (event.type) {
    case 'plan': {
      const steps = (event.payload as { steps: Array<{ type: string; personaId?: string }> }).steps;
      return `Plan: ${steps.map(s => s.personaId || s.type).join(' → ')}`;
    }
    case 'announce':
      return (event.payload as { text: string }).text;
    case 'persona_start': {
      const { personaId, dependsOn } = event.payload as { personaId: string; dependsOn: string[] };
      return dependsOn.length > 0
        ? `${personaId} (after: ${dependsOn.join(', ')})`
        : personaId;
    }
    case 'persona_output': {
      const { displayName, text } = event.payload as { displayName: string; text: string };
      return `[${displayName}] ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`;
    }
    case 'steering':
      return `User: "${(event.payload as { message: string }).message}"`;
    case 'done':
      return 'Session complete';
    case 'error':
      return `Error: ${(event.payload as { error: string }).error}`;
    default:
      return JSON.stringify(event.payload);
  }
}

export function EventStream({ events }: EventStreamProps) {
  if (events.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">No events yet</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold underline color="cyan">
        Events
      </Text>
      <Box flexDirection="column" paddingTop={1}>
        {events.map((event, index) => (
          <Box key={index} paddingY={0.5}>
            <Text color="gray">{formatTime(event.timestamp)} </Text>
            <Text color={getEventColor(event.type)}>
              {getEventIcon(event.type)} {renderEventContent(event)}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
