import { Navigate, useLocation } from 'react-router-dom';
import { legacyRedirect } from '../lib/legacyRedirect';

/** `/` → /inbox; pre-R1 `/?tab=…` deep links → their new route. */
export default function RootRedirect() {
  const { search } = useLocation();
  return <Navigate to={legacyRedirect(search)} replace />;
}
