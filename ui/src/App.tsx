import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import AuthGuard from "../app/core/auth/AuthGuard";

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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AuthGuard><AuthRedirect /></AuthGuard>} />
        
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
    </BrowserRouter>
  );
}
