import React from 'react';
import { createRoot } from 'react-dom/client';
import { PipApp } from './components/PipApp';
import '../styles/design-tokens.css';
import './pip.css';

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <PipApp />
    </React.StrictMode>,
  );
}
