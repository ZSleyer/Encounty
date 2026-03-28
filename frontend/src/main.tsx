/**
 * main.tsx — Application entry point.
 * Mounts the React tree into the #root element with a data router so that
 * data-router hooks like useBlocker work alongside client-side navigation.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { App } from './App'
import './locales'
import './index.css'

const router = createBrowserRouter([
  { path: '*', Component: App },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
