/**
 * main.tsx — Application entry point.
 * Mounts the React tree into the #root element with BrowserRouter so that
 * React Router can handle client-side navigation for Dashboard, Settings,
 * Overlay, and Hotkeys pages.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import './locales'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
