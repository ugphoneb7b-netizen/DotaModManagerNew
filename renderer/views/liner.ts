/* The Liner screen view coordinator. */
import { registerView } from '../core/router.ts';
import { showLiner } from '../liner/LinerScreen.tsx';

async function load(): Promise<void> {
  showLiner();
}

registerView('liner', () => load());
