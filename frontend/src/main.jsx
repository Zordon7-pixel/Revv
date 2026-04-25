import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import { initErrorReporter } from './lib/errorReporter'
import { initSentry } from './lib/sentry'
import './index.css'

// Auto-report unhandled JS errors + promise rejections to /api/feedback
initSentry()
initErrorReporter()

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
