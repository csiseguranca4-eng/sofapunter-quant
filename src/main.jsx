import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro) {
    console.warn('[SofaPunter] A tela foi preservada após um erro de renderização.', erro);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', background: '#121212', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, background: '#1c1c1c', border: '1px solid #333', borderRadius: 12, padding: 24 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>A tela encontrou um erro e foi preservada.</p>
          <p style={{ margin: '0 0 16px', color: '#cbd5e1', fontSize: 14 }}>Recarregue para continuar de onde a auditoria parou.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ background: '#00c853', color: '#000', border: 0, borderRadius: 8, padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
