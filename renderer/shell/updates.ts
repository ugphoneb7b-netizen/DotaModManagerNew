import { state } from '../core/store.ts';
import { render } from '../core/router.ts';
import { switchOffStaleTerrains } from '../core/terrain-age.ts';
import { toast } from '../ui/toast.ts';

window.api.update.onUpdate((evt) => {
  const isBeta = evt.version.toLowerCase().includes('beta');
  const label = isBeta ? `Beta V${evt.version.replace(/^v/i, '')}` : `Release V${evt.version.replace(/^v/i, '')}`;
  if (evt.type === 'available' || evt.type === 'portable') {
    toast(L`Доступна новая версия: ${label}`, 'ok', 12000);
  } else if (evt.type === 'downloaded') {
    toast(L`Обновление ${label} скачано и готово к установке`, 'ok', 15000);
  }
});

// The repair itself runs in the main process whether or not this window is looking; this only
// decides how the user hears about it. On My mods that is the banner, so redraw and let it speak;
// anywhere else a toast, because a patch that ate the mods is news wherever you are standing.
window.api.patch.onRepair((st) => {
  // an update can change the map under a whole-map terrain (core/terrain-age.ts)
  if (st.state === 'done') switchOffStaleTerrains().then((off: unknown[]) => { if (off.length && state.view === 'library') render(); });
  if (state.view === 'library') { render(); return; }
  if (st.state === 'waiting') toast(L`Dota обновилась — вернём моды, как только закроешь игру`, 'warn', 8000);
  else if (st.state === 'failed') toast(L`Dota обновилась, вернуть моды не вышло — загляни в «Мои моды»`, 'error', 8000);
  else if (st.state === 'done') toast(L`Dota обновилась — моды на месте`, 'ok', 6000);
});
