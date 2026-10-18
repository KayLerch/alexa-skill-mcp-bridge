/**
 * Model text → TTS-friendly plain text. Strips what a voice cannot carry.
 * SSML escaping is the frontend's job.
 */
export function cleanSpeech(text: string): string {
  let t = text;
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/`([^`]*)`/g, '$1');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/https?:\/\/\S+/gi, 'a link');
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '');
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
  t = t.replace(/(?<!\w)(\*|_)(\S.*?\S|\S)\1(?!\w)/g, '$2');
  t = t.replace(/\p{Extended_Pictographic}/gu, '');
  t = t.replace(/\s*\n+\s*/g, ' ');
  t = t.replace(/\s{2,}/g, ' ');
  return t.trim();
}

/** A spoken answer that ends without a question does not need the microphone open. */
export function endsWithQuestion(speech: string): boolean {
  return /\?\s*$/.test(speech);
}

/**
 * The last question alone, without the feedback before it: the last sentence that ends with a
 * question mark, together with the sentences right before it that end with one too, so a question
 * followed by its options ("Which vendor? A, Adyen; or B, Stripe?") comes back whole.
 */
export function lastQuestion(speech: string): string | undefined {
  const sentences = speech.split(/(?<=[.!?])\s+/);
  let end = sentences.length - 1;
  while (end >= 0 && !sentences[end]?.endsWith('?')) end -= 1;
  if (end < 0) return undefined;
  let start = end;
  while (start > 0 && sentences[start - 1]?.endsWith('?')) start -= 1;
  return sentences.slice(start, end + 1).join(' ');
}
