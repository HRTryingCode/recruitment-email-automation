import { Navigate, Route, Routes } from 'react-router-dom';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import RootRedirect from './pages/RootRedirect';
import InboxPage from './pages/InboxPage';
import CandidatesPage from './pages/CandidatesPage';
import TodayPage from './pages/TodayPage';
import SettingsLayout from './pages/settings/SettingsLayout';
import MailboxesSettings from './pages/settings/MailboxesSettings';
import IntegrationsSettings from './pages/settings/IntegrationsSettings';
import TeamSettings from './pages/settings/TeamSettings';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/shell/AppShell';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<RootRedirect />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="candidates" element={<CandidatesPage />} />
          <Route path="today" element={<TodayPage />} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="mailboxes" replace />} />
            <Route path="mailboxes" element={<MailboxesSettings />} />
            <Route path="integrations" element={<IntegrationsSettings />} />
            <Route path="team" element={<TeamSettings />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
