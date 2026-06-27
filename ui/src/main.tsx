import React from 'react';
import ReactDOM from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import App from './App';
import '../app/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Theme accentColor="blue" grayColor="slate" panelBackground="solid" radius="small" appearance="light">
    <App />
  </Theme>
);
