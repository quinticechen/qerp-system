
import { Navigate } from 'react-router-dom';

// The role overview now lives on the permission page; keep the old address working
const OrganizationRolePage = () => <Navigate to="/permission" replace />;

export default OrganizationRolePage;
