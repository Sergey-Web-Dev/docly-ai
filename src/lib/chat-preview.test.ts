import { describe, expect, it } from 'vitest';
import {
  ANSWER_CHAR_MS,
  CHAT_PREVIEW_SCENARIOS,
  THINKING_MS,
  USER_CHAR_MS,
  getPreviewFrame,
  locateScenario,
  scenarioDurationMs,
  type ChatPreviewScenario,
} from './chat-preview';

const SCENARIO: ChatPreviewScenario = { question: 'Hello there', answer: 'General Kenobi, you are bold.' };

describe('CHAT_PREVIEW_SCENARIOS', () => {
  it('should start with the vacation days exchange', () => {
    expect(CHAT_PREVIEW_SCENARIOS[0]?.question).toBe('How many vacation days do new hires get?');
  });

  it('should include an out-of-scope question with a grounded refusal', () => {
    expect(CHAT_PREVIEW_SCENARIOS.some((s) => s.answer === "I don't know based on these documents.")).toBe(true);
  });
});

describe('getPreviewFrame', () => {
  it('should show no text at time zero while the user bubble is typing', () => {
    const frame = getPreviewFrame(SCENARIO, 0);
    expect(frame).toMatchObject({ phase: 'user-typing', userText: '', answerText: '' });
  });

  it('should reveal one character per USER_CHAR_MS', () => {
    const frame = getPreviewFrame(SCENARIO, USER_CHAR_MS * 5);
    expect(frame.userText).toBe('Hello');
    expect(frame.phase).toBe('user-typing');
  });

  it('should show the thinking state once the question is fully typed', () => {
    const typed = SCENARIO.question.length * USER_CHAR_MS;
    const frame = getPreviewFrame(SCENARIO, typed + 600);
    expect(frame.phase).toBe('thinking');
    expect(frame.userText).toBe(SCENARIO.question);
    expect(frame.answerText).toBe('');
  });

  it('should type the answer after the thinking delay', () => {
    const typed = SCENARIO.question.length * USER_CHAR_MS;
    const frame = getPreviewFrame(SCENARIO, typed + THINKING_MS + ANSWER_CHAR_MS * 7);
    expect(frame.phase).toBe('answer-typing');
    expect(frame.answerText).toBe('General');
  });

  it('should hold the complete exchange at the end of the scenario', () => {
    const frame = getPreviewFrame(SCENARIO, scenarioDurationMs(SCENARIO) - 1);
    expect(frame).toMatchObject({ phase: 'holding', userText: SCENARIO.question, answerText: SCENARIO.answer });
  });

  it('should clamp negative time to the first frame', () => {
    expect(getPreviewFrame(SCENARIO, -500).userText).toBe('');
  });
});

describe('scenarioDurationMs', () => {
  it('should last between 10 and 12 seconds for every built-in scenario', () => {
    for (const scenario of CHAT_PREVIEW_SCENARIOS) {
      expect(scenarioDurationMs(scenario)).toBeGreaterThanOrEqual(10_000);
      expect(scenarioDurationMs(scenario)).toBeLessThanOrEqual(12_000);
    }
  });
});

describe('locateScenario', () => {
  it('should return the first scenario at time zero', () => {
    expect(locateScenario(CHAT_PREVIEW_SCENARIOS, 0)).toEqual({ index: 0, elapsedMs: 0 });
  });

  it('should advance to the next scenario after the first one ends', () => {
    const first = CHAT_PREVIEW_SCENARIOS[0];
    if (!first) throw new Error('missing scenario');
    const located = locateScenario(CHAT_PREVIEW_SCENARIOS, scenarioDurationMs(first) + 100);
    expect(located).toEqual({ index: 1, elapsedMs: 100 });
  });

  it('should loop back to the first scenario after the last one', () => {
    const total = CHAT_PREVIEW_SCENARIOS.reduce((sum, s) => sum + scenarioDurationMs(s), 0);
    expect(locateScenario(CHAT_PREVIEW_SCENARIOS, total + 5)).toEqual({ index: 0, elapsedMs: 5 });
  });
});
