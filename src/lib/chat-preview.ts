export interface ChatPreviewScenario {
  readonly question: string;
  readonly answer: string;
}

export type ChatPreviewPhase = 'user-typing' | 'thinking' | 'answer-typing' | 'holding';

export interface ChatPreviewFrame {
  readonly phase: ChatPreviewPhase;
  readonly userText: string;
  readonly answerText: string;
}

export const USER_CHAR_MS = 35;
export const ANSWER_CHAR_MS = 22;
export const THINKING_MS = 1800;
const TARGET_SCENARIO_MS = 11_000;
const MIN_HOLD_MS = 2500;

export const CHAT_PREVIEW_SCENARIOS: readonly ChatPreviewScenario[] = [
  {
    question: 'How many vacation days do new hires get?',
    answer: 'New hires get 20 vacation days in their first year, per the employee handbook.',
  },
  { question: 'Can I work remotely?', answer: 'Yes — remote work is allowed on Tuesdays and Thursdays.' },
  { question: "What's the support email?", answer: 'You can reach support at help@acme.test.' },
  { question: 'Who won the World Cup?', answer: "I don't know based on these documents." },
];

function activeMs(scenario: ChatPreviewScenario): number {
  return scenario.question.length * USER_CHAR_MS + THINKING_MS + scenario.answer.length * ANSWER_CHAR_MS;
}

/** Total time one scenario occupies, including the final hold, so loops last about 10-12 s. */
export function scenarioDurationMs(scenario: ChatPreviewScenario): number {
  return activeMs(scenario) + Math.max(MIN_HOLD_MS, TARGET_SCENARIO_MS - activeMs(scenario));
}

export function getPreviewFrame(scenario: ChatPreviewScenario, elapsedMs: number): ChatPreviewFrame {
  const t = Math.max(0, elapsedMs);
  const typedMs = scenario.question.length * USER_CHAR_MS;
  if (t < typedMs) {
    return { phase: 'user-typing', userText: scenario.question.slice(0, Math.floor(t / USER_CHAR_MS)), answerText: '' };
  }
  const thinkingEnd = typedMs + THINKING_MS;
  if (t < thinkingEnd) return { phase: 'thinking', userText: scenario.question, answerText: '' };

  const answerMs = scenario.answer.length * ANSWER_CHAR_MS;
  if (t < thinkingEnd + answerMs) {
    const chars = Math.floor((t - thinkingEnd) / ANSWER_CHAR_MS);
    return { phase: 'answer-typing', userText: scenario.question, answerText: scenario.answer.slice(0, chars) };
  }
  return { phase: 'holding', userText: scenario.question, answerText: scenario.answer };
}

/** Maps total animation time onto a looping list of scenarios. */
export function locateScenario(
  scenarios: readonly ChatPreviewScenario[],
  totalMs: number,
): { readonly index: number; readonly elapsedMs: number } {
  const loopMs = scenarios.reduce((sum, scenario) => sum + scenarioDurationMs(scenario), 0);
  if (loopMs <= 0) return { index: 0, elapsedMs: 0 };
  let remaining = Math.max(0, totalMs) % loopMs;
  for (const [index, scenario] of scenarios.entries()) {
    const duration = scenarioDurationMs(scenario);
    if (remaining < duration) return { index, elapsedMs: remaining };
    remaining -= duration;
  }
  return { index: 0, elapsedMs: 0 };
}
