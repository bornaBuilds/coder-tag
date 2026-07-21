import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const mediaDirectory = path.join(projectRoot, "media");
const sampleRate = 44_100;
const toneDuration = 0.16;
const gapDuration = 0.035;
const clips = [
  [523.25, 659.25, 783.99],
  [392, 587.33, 783.99],
  [659.25, 493.88, 329.63],
];

fs.mkdirSync(mediaDirectory, { recursive: true });

for (const [clipIndex, frequencies] of clips.entries()) {
  const sampleCount = Math.floor(
    sampleRate *
      (frequencies.length * toneDuration +
        (frequencies.length - 1) * gapDuration),
  );
  const audioData = Buffer.alloc(sampleCount * 2);
  let cursor = 0;

  for (const [frequencyIndex, frequency] of frequencies.entries()) {
    const toneSamples = Math.floor(sampleRate * toneDuration);
    const fadeSamples = Math.floor(sampleRate * 0.015);

    for (let index = 0; index < toneSamples; index += 1) {
      const envelope = Math.min(
        1,
        index / fadeSamples,
        (toneSamples - index - 1) / fadeSamples,
      );
      const sample = Math.round(
        Math.sin((2 * Math.PI * frequency * index) / sampleRate) *
          envelope *
          7_000,
      );
      audioData.writeInt16LE(sample, cursor * 2);
      cursor += 1;
    }

    if (frequencyIndex < frequencies.length - 1) {
      cursor += Math.floor(sampleRate * gapDuration);
    }
  }

  const waveFile = Buffer.alloc(44 + audioData.length);
  waveFile.write("RIFF", 0);
  waveFile.writeUInt32LE(36 + audioData.length, 4);
  waveFile.write("WAVEfmt ", 8);
  waveFile.writeUInt32LE(16, 16);
  waveFile.writeUInt16LE(1, 20);
  waveFile.writeUInt16LE(1, 22);
  waveFile.writeUInt32LE(sampleRate, 24);
  waveFile.writeUInt32LE(sampleRate * 2, 28);
  waveFile.writeUInt16LE(2, 32);
  waveFile.writeUInt16LE(16, 34);
  waveFile.write("data", 36);
  waveFile.writeUInt32LE(audioData.length, 40);
  audioData.copy(waveFile, 44);

  fs.writeFileSync(
    path.join(mediaDirectory, `demo-tag-${clipIndex + 1}.wav`),
    waveFile,
  );
}

console.log("Generated three original demo sounds in media/.");
