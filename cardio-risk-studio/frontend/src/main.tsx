import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import './index.css';
import { HeaderNav } from './HeaderNav';
import { PredictionCardDeck } from './PredictionCardDeck';
import '../assets/styles.css';

const root = document.getElementById('nav-root');
if (!root) throw new Error('Missing #nav-root mount point');

const cardRoot = document.getElementById('card-swap-root');
if (!cardRoot) throw new Error('Missing #card-swap-root mount point');

const nav = createRoot(root);
const deck = createRoot(cardRoot);
flushSync(() => {
  nav.render(<StrictMode><HeaderNav /></StrictMode>);
  deck.render(<StrictMode><PredictionCardDeck /></StrictMode>);
});
