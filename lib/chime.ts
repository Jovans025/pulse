// A soft two-note chime (+ a buzz on phones) for incoming requests. Synthesised
// with Web Audio, so there's no asset to load. Audio is allowed by then: the
// user has already clicked "Enter Pulse".
let ctx: AudioContext | null = null;

export function playChime() {
  try {
    ctx ??= new AudioContext();
    const ac = ctx;
    const start = ac.currentTime;
    [660, 990].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const t = start + i * 0.14;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  } catch {}
  navigator.vibrate?.([60, 40, 60]);
}
