export type ActiveTranscriber = {
  stop: () => void;
};

export const activeGuildTranscribers = new Map<string, ActiveTranscriber>();