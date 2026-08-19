import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import AuthGuard from "../app/core/auth/AuthGuard.desktop";
import * as ConfigService from '../wailsjs/beskar/desktop/config/configservice';
// @ts-ignore
import { Events } from '@wailsio/runtime';

// Layouts
import SpaceLayout from "../app/components/spaceLayout";
import SpaceDetailLayout from "../app/space/[spaceId]/layout";
import SettingsLayout from "../app/space/[spaceId]/settings/layout";
import UserLayout from "../app/user/layout";

// Pages
import SpacePage from "../app/space/page";
import SpaceDetailOverview from "../app/space/[spaceId]/page";
import GeneralSettings from "../app/space/[spaceId]/settings/general/page";
import UsersSettings from "../app/space/[spaceId]/settings/users/page";
import AddUserSettings from "../app/space/[spaceId]/settings/users/add/page";
import InvitesSettings from "../app/space/[spaceId]/settings/invites/page";
import QuotaSettings from "../app/space/[spaceId]/settings/quota/page";
import ViewPage from "../app/space/[spaceId]/view/[page]/page";
import EditPage from "../app/space/[spaceId]/edit/[page]/page";
import WhiteboardVersionsPage from "../app/space/[spaceId]/whiteboard/[pageId]/versions/page";
import WhiteboardVersionViewPage from "../app/space/[spaceId]/whiteboard/[pageId]/versions/[versionId]/page";
import EditSlugPage from "../app/edit/[...slug]/page";
import NotificationsPage from "../app/user/notifications/page";
import StoragePage from "../app/user/storage/page";
import InviteActionPage from "../app/invite/action/page";
import ContactPage from "../app/contact/page";

const RouteWrapper = ({ Component }: { Component: React.ElementType }) => {
  const location = useLocation();
  return <Component key={location.pathname} />;
};

function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    ConfigService.GetInitialRoute().then(route => {
      if (route && route.startsWith('teddox://')) {
        const path = route.replace('teddox://', '/').replace('//', '/');
        if (path !== '/' && path !== '') {
          navigate(path, { replace: true });
        }
      }
    }).catch(console.error);

    const cancel = Events.On('deep-link-opened', (e: any) => {
      const route = e.data[0];
      if (typeof route === 'string' && route.startsWith('teddox://')) {
        const path = route.replace('teddox://', '/').replace('//', '/');
        if (path !== '/' && path !== '') {
          navigate(path);
        }
      }
    });

    return () => {
      if (cancel) cancel();
    };
  }, [navigate]);

  return null;
}

export default function AppDesktop() {
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const checkConfig = async () => {
      try {
        await ConfigService.GetConfig();
      } catch (err) {
        console.error("Failed to fetch config:", err);
      } finally {
        setLoading(false);
      }
    };
    checkConfig();
  }, []);

  if (loading) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;
  }

  return (
    <HashRouter>
      <DeepLinkHandler />
      <Routes>
        <Route path="/" element={<Navigate to="/space" replace />} />
        
        <Route path="/space" element={<AuthGuard><SpaceLayout><SpacePage /></SpaceLayout></AuthGuard>} />
        
        <Route path="/space/:spaceId" element={<AuthGuard><SpaceLayout><SpaceDetailLayout /></SpaceLayout></AuthGuard>}>
          <Route index element={<SpaceDetailOverview />} />
          <Route path="view/:page" element={<RouteWrapper Component={ViewPage} />} />
          <Route path="edit/:page" element={<RouteWrapper Component={EditPage} />} />
          <Route path="whiteboard/:pageId/versions" element={<RouteWrapper Component={WhiteboardVersionsPage} />} />
          <Route path="whiteboard/:pageId/versions/:versionId" element={<RouteWrapper Component={WhiteboardVersionViewPage} />} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="users" replace />} />
            <Route path="general" element={<GeneralSettings />} />
            <Route path="users" element={<UsersSettings />} />
            <Route path="users/add" element={<AddUserSettings />} />
            <Route path="invites" element={<InvitesSettings />} />
            <Route path="quota" element={<QuotaSettings />} />
          </Route>
        </Route>

        <Route path="/edit/:spaceId/:page" element={<AuthGuard><SpaceLayout><RouteWrapper Component={EditSlugPage} /></SpaceLayout></AuthGuard>} />

        <Route path="/user" element={<AuthGuard><UserLayout /></AuthGuard>}>
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="storage" element={<StoragePage />} />
        </Route>

        <Route path="/invite/action" element={<AuthGuard><InviteActionPage /></AuthGuard>} />
        <Route path="/contact" element={<ContactPage />} />
      </Routes>
    </HashRouter>
  );
}
