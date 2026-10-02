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

/**
 * A spoken answer that ends without a question does not need the microphone open —
 * except when it explicitly asks the user to say "yes"/"no" (a confirmation prompt).
 * Some tools return a confirmation request that a model may phrase as a statement
 * ("Please say yes to approve."), dropping the question mark; closing the mic there
 * would strand the user mid-confirmation. Treat those as open turns too.
 */
export function endsWithQuestion(speech: string): boolean {
  if (/\?\s*$/.test(speech)) return true;
  // Confirmation prompts that invite a spoken yes/no, even without a "?".
  return /\bsay\s+(?:["']?yes["']?|["']?no["']?)\b/i.test(speech);
}
