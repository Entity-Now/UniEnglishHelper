import { describe, expect, it } from 'vitest';
import { findActiveCue, parseVtt } from './parser';

const SAMPLE = `WEBVTT

1
00:00:00.000 --> 00:00:02.000
Hello world

2
00:00:02.000 --> 00:00:04.500
How are you?
`;

describe('subtitle parser', () => {
  it('parses VTT cues', () => {
    const cues = parseVtt(SAMPLE);
    expect(cues.length).toBe(2);
    expect(cues[0].text).toBe('Hello world');
    expect(cues[1].endMs).toBe(4500);
  });

  it('finds active cue', () => {
    const cues = parseVtt(SAMPLE);
    expect(findActiveCue(cues, 1000)?.text).toBe('Hello world');
    expect(findActiveCue(cues, 3000)?.text).toBe('How are you?');
    expect(findActiveCue(cues, 9000)).toBeNull();
  });
});
