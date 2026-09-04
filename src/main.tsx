import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import TeamApp from './team/TeamApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TeamApp />
  </StrictMode>,
)
