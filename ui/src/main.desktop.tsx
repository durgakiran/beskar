import React from 'react';
import ReactDOM from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import AppDesktop from './App.desktop';
import '../app/global.css';
import { setupDesktopClient } from '../app/core/http/desktopClient';

setupDesktopClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Theme accentColor="blue" grayColor="slate" panelBackground="solid" radius="small" appearance="light">
    <AppDesktop />
  </Theme>
);
