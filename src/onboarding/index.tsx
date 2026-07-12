import React from 'react';
import { createRoot } from 'react-dom/client';
import { OnboardingApp } from './OnboardingApp';
import '../styles/design-tokens.css';
import './onboarding.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OnboardingApp />
  </React.StrictMode>,
);
