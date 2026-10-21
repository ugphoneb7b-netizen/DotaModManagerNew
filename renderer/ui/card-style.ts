/* Card style helper: 3D tilted cards vs classic flat layout. */
import { state } from '../core/store.ts';

export function applyCardStyle(cardTilt?: boolean | null): void {
  const isFlat = cardTilt === false;
  document.documentElement.dataset.cardStyle = isFlat ? 'flat' : 'tilted';
}

export function initCardStyle(): void {
  applyCardStyle(state.settings?.cardTilt);
}
