export interface ReplyOptions {
  options: string[];
  compelled: boolean;
}

export const compulsionNarration = "You have a strange feeling wash over you, as if your free will has been stripped from you. You must respond.";

export function parseReplyOptions(value: unknown, allowEmpty = true): string[] {
  if (value === undefined && allowEmpty) return [];
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error("Reply options must contain one or more responses, or be empty when no suggestions are needed");
  }
  const options = value.map(option => {
    if (typeof option !== "string" || !option.trim() || option.trim().length > 300) throw new Error("Each reply option must be 1–300 characters");
    return option.trim();
  });
  if (new Set(options).size !== options.length) throw new Error("Reply options must be distinct");
  return options;
}
