import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error) { console.error('CreditGraph could not render:', error); }
  render() {
    if (this.state.error) return <main className="fatal-error"><h1>CreditGraph could not load this view.</h1><p>Your local positions have not been uploaded. Refresh to reopen the historical demo.</p><button onClick={() => window.location.reload()}>Reload workspace</button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
