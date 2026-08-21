import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles.css'
import './ui/ui.css'
import './shell/shell.css'
import './player/player.css'
import './strip/strip.css'

createRoot(document.getElementById('root')!).render(<App />)
