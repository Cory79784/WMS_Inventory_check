import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SessionGate } from './components/SessionGate';

const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  if (response.status === 401) window.dispatchEvent(new Event('wms-session-expired'));
  return response;
};
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SessionGate><App /></SessionGate>
  </React.StrictMode>
);
