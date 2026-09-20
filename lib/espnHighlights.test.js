// Picking a game's highlights out of everything ESPN files against it, inside
// a two-minute watch.
import { describe, it, expect } from 'vitest';
import { pickHighlightClips, fmtClipLength } from './espnHighlights.js';

const video = (coverageType, headline, duration, id = headline) => ({
  headline,
  duration,
  tracking: { coverageType },
  links: { web: { href: `https://www.espn.com/video/clip/_/id/${encodeURIComponent(id)}` } },
});

describe('pickHighlightClips', () => {
  it('takes the reel alone when ESPN cut one', () => {
    const out = pickHighlightClips([
      video('Final Game Highlight', 'Yankees vs. Diamondbacks: Game Highlights', 57),
      video('OnePlay', 'Corbin Carroll crushes a home run', 21),
      video('OnePlay', 'Ben Rice crushes a home run', 30),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'reel', duration: 57 });
  });

  it('falls back to the plays when there is no reel', () => {
    const out = pickHighlightClips([
      video('OnePlay', 'Austin Wells smashes a home run', 34),
      video('OnePlay', "D-backs walk-off in 9th on Pavin Smith's 2-run homer", 45),
    ]);
    expect(out.map((c) => c.title)).toEqual([
      'Austin Wells smashes a home run',
      "D-backs walk-off in 9th on Pavin Smith's 2-run homer",
    ]);
    expect(out.every((c) => c.kind === 'play')).toBe(true);
  });

  it('keeps the biggest moments but plays them back in order, under the budget', () => {
    const out = pickHighlightClips([
      video('OnePlay', 'Talty makes 32-yard field goal', 9),
      video('OnePlay', 'Daniels connects for a 20-yard touchdown', 35),
      video('OnePlay', 'Kromah rushes in for 12-yard TD', 50),
      video('OnePlay', 'Talty kicks 43-yard field goal', 8),
      video('OnePlay', 'Russell throws 46-yard TD', 61),
      video('OnePlay', 'Crowell hurdles a defender down the sideline', 31),
    ]);
    // 61 + 50 + 9 fits; the 35 in between would have blown the two minutes.
    expect(out.map((c) => c.duration)).toEqual([9, 50, 61]);
    expect(out.reduce((n, c) => n + c.duration, 0)).toBeLessThanOrEqual(120);
  });

  it('never lists more than four clips', () => {
    const many = Array.from({ length: 10 }, (_, i) => video('OnePlay', `Play ${i}`, 5, i));
    expect(pickHighlightClips(many)).toHaveLength(4);
  });

  it('drops studio analysis, press conferences and postgame talk', () => {
    expect(pickHighlightClips([
      video('Analysis', 'Nicol believes Hull City deserved all three points', 125),
      video('Analysis', 'Marcotti: Carrick has work to do', 105),
      video('PressConference', 'Carrick describes the defeat as hugely disappointing', 85),
      video('OnePlay', "Russell elaborates on Bama's preparedness", 97),
    ])).toEqual([]);
  });

  it('skips a reel that runs past the budget and uses the plays instead', () => {
    const out = pickHighlightClips([
      video('Final Game Highlight', 'Extended Game Highlights', 480),
      video('OnePlay', 'Danault lights the lamp', 34),
    ]);
    expect(out.map((c) => c.kind)).toEqual(['play']);
  });

  it('reads the headline when ESPN files a clip without a coverage type', () => {
    const bare = { headline: 'Game Highlights', duration: 60, links: { web: { href: 'https://espn.com/x' } } };
    expect(pickHighlightClips([bare])).toHaveLength(1);
  });

  it('ignores clips with no link or no runtime', () => {
    expect(pickHighlightClips([
      { headline: 'Game Highlights', duration: 60, tracking: { coverageType: 'Final Game Highlight' } },
      { ...video('OnePlay', 'Unknown length', 0) },
    ])).toEqual([]);
    expect(pickHighlightClips(undefined)).toEqual([]);
  });
});

describe('fmtClipLength', () => {
  it('reads as a clock', () => {
    expect(fmtClipLength(57)).toBe('0:57');
    expect(fmtClipLength(84)).toBe('1:24');
    expect(fmtClipLength(120)).toBe('2:00');
    expect(fmtClipLength(9)).toBe('0:09');
  });
});
