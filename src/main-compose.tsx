import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ComposePage from './ui/ComposePage';
import ErrorBoundary from './ui/ErrorBoundary';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ComposePage />
    </ErrorBoundary>
  </StrictMode>,
);
