import React from 'react';
import type { GlideboardController } from './GlideboardController';

const GlideboardContext = React.createContext<GlideboardController | null>(null);

export function GlideboardProvider({
  controller,
  children,
}: {
  controller: GlideboardController;
  children: React.ReactNode;
}) {
  return (
    <GlideboardContext.Provider value={controller}>
      {children}
    </GlideboardContext.Provider>
  );
}

export function useGlideboardController(): GlideboardController {
  const controller = React.useContext(GlideboardContext);
  if (!controller) {
    throw new Error('Glideboard components must be rendered inside a GlideboardProvider.');
  }
  return controller;
}
