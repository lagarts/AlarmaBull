import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerPwa } from './lib/pwa'
import './styles/index.css'

registerPwa()

const container = document.getElementById('root')
if (!container) {
  throw new Error('No se encontró el elemento #root en index.html')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
