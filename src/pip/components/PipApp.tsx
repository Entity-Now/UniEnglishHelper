import React, { useEffect, useMemo, useState } from 'react';
import type { BridgeMessage } from '../../shared/messages/bridge';
import type { SubtitleCue } from '../../shared/domain/types';
import { PipBridge } from '../../content/bridge';
import { SubtitlePanel } from './SubtitlePanel';
import { WordPopup } from './WordPopup';

/**
 * Optional React PiP shell. Content Path A currently mounts inline UI for reliability;
 * this bundle remains available as WAR for future full injection.
 */
export function PipApp() {
  const [bridge, setBridge] = useState<PipBridge | null>(null);
  const [cue, setCue] = useState<SubtitleCue | null>(null);
  const [meta, setMeta] = useState('Waiting for bridge…');
  const [explain, setExplain] = useState<string | null>(null);

  useEffect(() => {
    PipBridge.acceptFromOpener(null, (b) => {
      setBridge(b);
      b.onMessage((msg: BridgeMessage) => {
        if (msg.type === 'pip.subtitleCue') {
          setCue(msg.payload.cue);
        } else if (msg.type === 'pip.playbackState') {
          setMeta(
            `t=${(msg.payload.mediaTimeMs / 1000).toFixed(1)}s · ${
              msg.payload.paused ? 'paused' : 'playing'
            } · capture=${msg.payload.captureState}`,
          );
        } else if (msg.type === 'pip.toast') {
          setMeta(msg.payload.message);
        } else if (msg.type === 'pip.explainResult') {
          setExplain(msg.payload.text);
        }
      });
      b.send({ type: 'bridge.hello', payload: { role: 'pip', token: b.sessionToken } });
    });
  }, []);

  const actions = useMemo(
    () => ({
      playPause: () =>
        bridge?.send({ type: 'pip.command.playPause', payload: {} }),
      exportClip: () =>
        bridge?.send({ type: 'pip.ui.exportClip', payload: {} }),
      tts: () =>
        bridge?.send({
          type: 'pip.ui.tts',
          payload: { text: cue?.text ?? '' },
        }),
      translate: () =>
        bridge?.send({
          type: 'pip.ui.translateRequest',
          payload: { cueId: cue?.id ?? '' },
        }),
      explain: (surface: string) => {
        bridge?.send({
          type: 'pip.ui.explainWord',
          payload: { surface, context: cue?.text ?? '' },
        });
      },
      addWord: (surface: string) => {
        bridge?.send({
          type: 'pip.ui.addWord',
          payload: {
            surface,
            context: cue?.text ?? '',
            cueStartMs: cue?.startMs,
            cueEndMs: cue?.endMs,
          },
        });
      },
    }),
    [bridge, cue],
  );

  return (
    <div className="ueh-pip">
      <SubtitlePanel cue={cue} onWordClick={actions.explain} />
      <div className="ueh-toolbar">
        <button type="button" onClick={actions.playPause}>
          Play/Pause
        </button>
        <button type="button" onClick={actions.exportClip}>
          Save audio
        </button>
        <button type="button" onClick={actions.tts}>
          TTS
        </button>
        <button type="button" onClick={actions.translate}>
          Translate
        </button>
      </div>
      <div className="ueh-meta">{meta}</div>
      {explain && (
        <WordPopup
          text={explain}
          onAdd={() => {
            /* parent handles via explain surface */
          }}
        />
      )}
    </div>
  );
}
