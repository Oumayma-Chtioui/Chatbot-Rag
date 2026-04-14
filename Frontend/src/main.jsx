import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ChatApp.jsx'
import ClientApp from './ClientApp.tsx'

const isClientPortal = window.location.pathname.startsWith('/client')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isClientPortal ? <ClientApp /> : <App />}
  </StrictMode>,
)