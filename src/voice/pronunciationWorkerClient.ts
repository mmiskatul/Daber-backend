import { PronunciationResult } from "./types";

export type PronunciationResultHandler = (result: PronunciationResult) => Promise<void> | void;

export class PronunciationWorkerClient {
  onResult(_handler: PronunciationResultHandler): void {}
}
