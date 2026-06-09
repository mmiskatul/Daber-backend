export type PcmBuffer = {
  audioBase64: string;
  sampleRateHz: number;
  channels: 1;
};

export function normalizeToMono16kPcm(audioBase64: string): PcmBuffer {
  return {
    audioBase64,
    sampleRateHz: 16000,
    channels: 1
  };
}

export function resample16kTo24kPcm(audioBase64: string): PcmBuffer {
  return {
    audioBase64,
    sampleRateHz: 24000,
    channels: 1
  };
}
