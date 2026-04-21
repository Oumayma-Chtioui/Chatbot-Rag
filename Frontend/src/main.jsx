import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ChatApp.jsx'
import ClientApp from './ClientApp.tsx'
import AdminApp from './AdminApp.tsx'
import WidgetPreview from './WidgetPreview.tsx'
import { GoogleOAuthProvider } from '@react-oauth/google';

const path = window.location.pathname
const isAdminPortal = path.startsWith('/admin')
const isClientPortal = path.startsWith('/client')
const isPreviewPage = path.startsWith('/widget-preview')

createRoot(document.getElementById('root')).render(


  <GoogleOAuthProvider clientId="970335989460-el84bl527om9eftfscr0vdurf0d7uek6.apps.googleusercontent.com">
    {isAdminPortal ? <AdminApp /> : isClientPortal ? <ClientApp /> : isPreviewPage ? <WidgetPreview /> : <App />}
  </GoogleOAuthProvider>

)