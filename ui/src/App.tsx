import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import AuthGuard from "../app/core/auth/AuthGuard";
import { useBrowserTabTitle } from "../app/core/hooks/useBrowserTabTitle";

// Layouts
import SpaceLayout from "../app/components/spaceLayout";
import SpaceDetailLayout from "../app/space/[spaceId]/layout";
import SettingsLayout from "../app/space/[spaceId]/settings/layout";
import UserLayout from "../app/user/layout";

// Pages
import AuthRedirect from "../app/internal/AuthRedirect";
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
const WhiteboardVersionViewPage = lazy(() => import("../app/space/[spaceId]/whiteboard/[pageId]/versions/[versionId]/page"));
import EditSlugPage from "../app/edit/[...slug]/page";
import NotificationsPage from "../app/user/notifications/page";
import StoragePage from "../app/user/storage/page";
import InviteActionPage from "../app/invite/action/page";
import ContactPage from "../app/contact/page";

const RouteWrapper = ({ Component }: { Component: React.ElementType }) => {
  const location = useLocation();
  return <Component key={location.pathname} />;
};

function TitledPage({ title, children }: { title: string; children: React.ReactNode }) {
  useBrowserTabTitle(title);
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AuthGuard><AuthRedirect /></AuthGuard>} />
        
        <Route path="/space" element={<AuthGuard><SpaceLayout><TitledPage title="Spaces"><SpacePage /></TitledPage></SpaceLayout></AuthGuard>} />
        
        <Route path="/space/:spaceId" element={<AuthGuard><SpaceDetailLayout /></AuthGuard>}>
          <Route index element={<RouteWrapper Component={SpaceDetailOverview} />} />
          <Route path="view/:page" element={<RouteWrapper Component={ViewPage} />} />
          <Route path="edit/:page" element={<RouteWrapper Component={EditPage} />} />
          <Route path="whiteboard/:pageId/versions" element={<TitledPage title="Whiteboard Version History"><RouteWrapper Component={WhiteboardVersionsPage} /></TitledPage>} />
          <Route path="whiteboard/:pageId/versions/:versionId" element={<TitledPage title="Whiteboard Version"><Suspense fallback={<div>Loading…</div>}><RouteWrapper Component={WhiteboardVersionViewPage} /></Suspense></TitledPage>} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="users" replace />} />
            <Route path="general" element={<TitledPage title="Space Settings"><GeneralSettings /></TitledPage>} />
            <Route path="users" element={<TitledPage title="Active Users"><UsersSettings /></TitledPage>} />
            <Route path="users/add" element={<TitledPage title="Invite User"><AddUserSettings /></TitledPage>} />
            <Route path="invites" element={<TitledPage title="Invited Users"><InvitesSettings /></TitledPage>} />
            <Route path="quota" element={<TitledPage title="Storage & Limits"><QuotaSettings /></TitledPage>} />
          </Route>
        </Route>

        <Route path="/edit/:spaceId/:page" element={<AuthGuard><SpaceLayout><RouteWrapper Component={EditSlugPage} /></SpaceLayout></AuthGuard>} />

        <Route path="/user" element={<AuthGuard><UserLayout /></AuthGuard>}>
          <Route path="notifications" element={<TitledPage title="Notifications"><NotificationsPage /></TitledPage>} />
          <Route path="storage" element={<TitledPage title="Account Storage"><StoragePage /></TitledPage>} />
        </Route>

        <Route path="/invite/action" element={<AuthGuard><TitledPage title="Invitation"><InviteActionPage /></TitledPage></AuthGuard>} />
        <Route path="/contact" element={<TitledPage title="Contact"><ContactPage /></TitledPage>} />
      </Routes>
    </BrowserRouter>
  );
}
