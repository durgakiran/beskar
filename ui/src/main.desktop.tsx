import React from 'react';
import ReactDOM from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import AppDesktop from './App.desktop';
import '../app/global.css';
import { setupApiClient } from '../app/core/http/setupApiClient';
import { setupDesktopTransport } from '../app/core/desktop/transport';
import { setupDesktopDownloads } from '../app/core/desktop/downloads';
import { downloadAttachmentBlob } from '../app/core/http/uploadAttachmentData';
import { Call, Events } from '@wailsio/runtime';
// @ts-ignore
import { Logout } from '../wailsjs/beskar/desktop/auth/authservice';

async function startDesktop() {
    setupDesktopTransport(await Call.ByName('beskar/desktop/transport.Service.GetBaseURL'));
    const resetAuthentication = setupApiClient(() => {
      void Logout().catch(error => console.error('Failed to clear expired desktop session:', error));
    });
    Events.On('auth:ready', resetAuthentication);
    setupDesktopDownloads(downloadAttachmentBlob);

    ReactDOM.createRoot(document.getElementById('root')!).render(
      <Theme accentColor="blue" grayColor="slate" panelBackground="solid" radius="small" appearance="light">
        <AppDesktop />
      </Theme>
    );
}

void startDesktop().catch(error => {
    console.error('Desktop startup failed', error);
    document.getElementById('root')!.textContent = 'Unable to start desktop connection. Restart the app to retry.';
});
