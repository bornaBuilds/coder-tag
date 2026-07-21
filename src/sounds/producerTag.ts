export type ProducerTagSource = "builtin" | "user";

/**
 * Metadata describing a playable producer tag. Future sound-pack sources can
 * extend ProducerTagSource without changing the audio system.
 */
export interface ProducerTag {
  readonly id: string;
  readonly name: string;
  readonly filePath: string;
  readonly source: ProducerTagSource;
}
