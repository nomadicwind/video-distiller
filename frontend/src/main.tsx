import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles.css'
import './ui/ui.css'
import './shell/shell.css'

createRoot(document.getElementById('root')!).render(<App />)
