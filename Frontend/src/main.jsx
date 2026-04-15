import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ChatApp.jsx'
import ClientApp from './ClientApp.tsx'
import AdminApp from './AdminApp.tsx'
import WidgetPreview from './WidgetPreview.tsx'

const path = window.location.pathname
const isAdminPortal = path.startsWith('/admin')
const isClientPortal = path.startsWith('/client')
const isPreviewPage = path.startsWith('/widget-preview')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isAdminPortal ? <AdminApp /> : isClientPortal ? <ClientApp /> : isPreviewPage ? <WidgetPreview /> : <App />}
  </StrictMode>,
)