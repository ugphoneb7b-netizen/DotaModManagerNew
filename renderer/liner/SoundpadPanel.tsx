/* The Soundpad tab: imported clips on a grid, each firing on its own element.
 * Kept out of LinerScreen so the screen file stays about music, and this one about the pad.
 */
import { useEffect, useState } from 'react';
import { soundpad, type SoundpadState } from './soundpad.ts';
import type { SoundpadSound } from '../api/liner.ts';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

function SoundPadButton({ sound, status, onToggle, onStop, onRemove }: {
  sound: SoundpadSound;
  status?: 'playing' | 'paused';
  onToggle: (id: string) => void;
  onStop: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const active = status != null;
  return (
    <div className={`soundpad-pad ${status === 'playing' ? 'playing' : ''} ${status === 'paused' ? 'paused' : ''}`}>
      <button
        className="soundpad-pad-main"
        onClick={() => onToggle(sound.id)}
        title={`${sound.name} · ${formatSize(sound.size)}`}
      >
        <span className="soundpad-pad-icon">
          {status === 'playing' ? (
            <span className="soundpad-eq"><i /><i /><i /><i /></span>
          ) : (
            <span className="ms">{status === 'paused' ? 'pause' : 'graphic_eq'}</span>
          )}
        </span>
        <span className="soundpad-pad-name" title={sound.name}>{sound.name}</span>
        <span className="soundpad-pad-ext">{sound.ext.toUpperCase()}</span>
      </button>
      {active && (
        <button
          className="soundpad-pad-stop"
          onClick={() => onStop(sound.id)}
          title={L`Стоп`}
        >
          <span className="ms">stop</span>
        </button>
      )}
      <button
        className="soundpad-pad-delete"
        onClick={() => {
          if (confirm(L`Удалить «${sound.name}» с пэда?`)) onRemove(sound.id);
        }}
        title={L`Удалить`}
      >
        <span className="ms">close</span>
      </button>
    </div>
  );
}

export function SoundpadPanel() {
  const [state, setState] = useState<SoundpadState>(() => soundpad.getState());

  useEffect(() => {
    const unsub = soundpad.subscribe(setState);
    if (!state.loaded) soundpad.load();
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playingCount = Object.values(state.status).filter((s) => s === 'playing').length;

  return (
    <div className="liner-content soundpad-panel">
      <div className="soundpad-toolbar">
        <div className="soundpad-toolbar-info">
          <h2>{L`Звуковой пэд`}</h2>
          <span className="soundpad-count">
            {state.sounds.length} {L`звуков`}
            {playingCount > 0 && ` · ${playingCount} ${L`играет`}`}
          </span>
        </div>
        <div className="soundpad-toolbar-actions">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => soundpad.importSounds()}
            disabled={state.busy}
          >
            <span className="ms">{state.busy ? 'hourglass_top' : 'upload_file'}</span>
            <span>{state.busy ? L`Импорт…` : L`Импорт звуков`}</span>
          </button>
          <button
            className="btn btn-sm"
            onClick={() => soundpad.stopAll()}
            disabled={Object.keys(state.status).length === 0}
            title={L`Остановить всё`}
          >
            <span className="ms">stop</span>
            <span>{L`Стоп всё`}</span>
          </button>
          <button
            className="btn btn-sm"
            onClick={() => soundpad.reveal()}
            title={L`Открыть папку со звуками`}
          >
            <span className="ms">folder_open</span>
          </button>
          <div className="soundpad-volume">
            <span className="ms">
              {state.volume === 0 ? 'volume_off' : state.volume < 0.5 ? 'volume_down' : 'volume_up'}
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={state.volume}
              onChange={(e) => soundpad.setVolume(parseFloat(e.target.value))}
              className="soundpad-vol-slider"
              title={L`Громкость`}
            />
          </div>
          {state.outputDevices.length > 0 && (
            <div className="soundpad-volume soundpad-output">
              <span className="ms">spatial_audio_off</span>
              <select
                className="soundpad-device-select"
                value={state.outputDeviceId}
                onChange={(e) => soundpad.setOutputDevice(e.target.value)}
                title={L`Выход звука`}
              >
                <option value="">{L`По умолчанию`}</option>
                {state.outputDevices.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {state.sounds.length === 0 ? (
        <div className="liner-empty-search soundpad-empty">
          <span className="ms">graphic_eq</span>
          <p>{L`Звуков пока нет — импортируй mp3, wav, ogg и другие, и запускай их одним кликом`}</p>
        </div>
      ) : (
        <div className="soundpad-grid">
          {state.sounds.map((sound) => (
            <SoundPadButton
              key={sound.id}
              sound={sound}
              status={state.status[sound.id]}
              onToggle={(id) => soundpad.toggle(id)}
              onStop={(id) => soundpad.stop(id)}
              onRemove={(id) => soundpad.remove(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
