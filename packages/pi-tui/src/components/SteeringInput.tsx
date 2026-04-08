import React from 'react';
import { Box, Text } from 'ink';

interface SteeringInputProps {
  value: string;
  isActive: boolean;
  onChange?: (value: string) => void;
}

export function SteeringInput({ value, isActive }: SteeringInputProps) {
  return (
    <Box padding={1} borderStyle="single" borderColor={isActive ? 'cyan' : 'gray'}>
      <Text color={isActive ? 'cyan' : 'gray'}>
        {isActive ? '▶ ' : '  '}
        Steering: <Text color="white">{value || '_'}</Text>
      </Text>
    </Box>
  );
}
