import React from 'react';
import { createRoot } from 'react-dom/client';
import { ApiKeyDialog } from './ApiKeyDialog';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <ApiKeyDialog />
    </React.StrictMode>,
  );
}
