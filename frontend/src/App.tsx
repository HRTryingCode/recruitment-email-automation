import { Routes, Route } from 'react-router-dom';
import Index from './pages/Index';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Index />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
