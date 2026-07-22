export type ProducerTagSource = "builtin" | "user";
export const defaultSoundId = "builtin-demo-1";

/**
 * Metadata describing a playable producer tag. Future sound-pack sources can
 * extend ProducerTagSource without changing the audio system.
 */
export interface ProducerTag {
  readonly id: string;
  readonly name: string;
  readonly filePath: string;
  readonly source: ProducerTagSource;
  readonly contentHash?: string;
}
