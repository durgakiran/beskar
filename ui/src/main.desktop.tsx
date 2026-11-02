import React from 'react';
import ReactDOM from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import AppDesktop from './App.desktop';
import '../app/global.css';
import { setupDesktopClient } from '../app/core/http/desktopClient';
import { setupApiClient } from '../app/core/http/setupApiClient';
import { Events } from '@wailsio/runtime';
// @ts-ignore
import { Logout } from '../wailsjs/beskar/desktop/auth/authservice';

setupDesktopClient();
const resetAuthentication = setupApiClient(() => {
  void Logout().catch(error => console.error('Failed to clear expired desktop session:', error));
});
Events.On('auth:ready', resetAuthentication);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Theme accentColor="blue" grayColor="slate" panelBackground="solid" radius="small" appearance="light">
    <AppDesktop />
  </Theme>
);
