/**
 * Spoken fallbacks used at the edges when something goes wrong.
 * Never speak raw error text; log the cause and say one of these.
 */
export const SPOKEN = {
  error: 'Sorry, something went wrong on my side. Please try again in a moment.',
  notUnderstood: "Sorry, I didn't catch that. What would you like to do?",
  cancelled: 'Okay, cancelled.',
  goodbye: 'Goodbye.',
  urlElicitationDeclined:
    "That step needs a link to be opened, which I can't do by voice. Let's try something else.",
  questionRepeat: 'Sorry, I still need an answer.',
} as const;
