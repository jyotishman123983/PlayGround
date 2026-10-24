import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './components/App'
import './styles.css'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

const boot = document.getElementById('boot')
if (boot) {
  boot.classList.add('boot-hide')
  window.setTimeout(() => boot.remove(), 500)
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Offline caching is optional; ignore registration failures. */
    })
  })
}
