import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './App.css'
import { AuthProvider } from './auth/AuthContext'

// Remove loading screen once app is mounted
const removeLoadingScreen = () => {
  const loadingScreen = document.querySelector('.loading-screen');
  if (loadingScreen) {
    loadingScreen.remove();
  }
};

const root = ReactDOM.createRoot(document.getElementById('app')!);

// Only use StrictMode in development for better performance in production
const AppWithProviders = (
  <AuthProvider>
    <App />
  </AuthProvider>
);

if (import.meta.env.DEV) {
  root.render(
    <React.StrictMode>
      {AppWithProviders}
    </React.StrictMode>
  );
} else {
  root.render(AppWithProviders);
}

// Remove loading screen after a short delay to ensure smooth transition
setTimeout(removeLoadingScreen, 100);
