import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';

// Ask Chrome not to evict this extension's IndexedDB under storage pressure (best effort).
void navigator.storage?.persist?.();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);