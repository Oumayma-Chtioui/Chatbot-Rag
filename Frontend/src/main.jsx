import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ChatApp.jsx'
import ClientApp from './ClientApp.tsx'
import AdminApp from './AdminApp.tsx'
import WidgetPreview from './WidgetPreview.tsx'
import { GoogleOAuthProvider } from '@react-oauth/google';
import VerifyEmail from './VerifyEmail.tsx'


const path = window.location.pathname
const isAdminPortal = path.startsWith('/admin')
const isClientPortal = path.startsWith('/client')
const isPreviewPage = path.startsWith('/widget-preview')
const isVerifyPage = path.startsWith('/verify-email')

const CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || ""

createRoot(document.getElementById('root')).render(
  <GoogleOAuthProvider clientId={CLIENT_ID}>
      {isAdminPortal ? <AdminApp /> :
      isClientPortal ? <ClientApp /> :
      isPreviewPage ? <WidgetPreview /> :
      isVerifyPage ? <VerifyEmail /> :
      <App />}
    </GoogleOAuthProvider>
)