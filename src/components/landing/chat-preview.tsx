'use client';

import { useRef } from 'react';
import { FileText, Sparkles } from 'lucide-react';
import { CHAT_PREVIEW_SCENARIOS, getPreviewFrame, locateScenario, type ChatPreviewFrame } from '@/lib/chat-preview';
import { usePrefersReducedMotion, usePreviewClock } from '@/lib/use-preview-clock';

const FIRST_SCENARIO = CHAT_PREVIEW_SCENARIOS[0] ?? { question: '', answer: '' };
const STATIC_FRAME: ChatPreviewFrame = {
  phase: 'holding',
  userText: FIRST_SCENARIO.question,
  answerText: FIRST_SCENARIO.answer,
};
const DOT_DELAYS: readonly string[] = ['0ms', '150ms', '300ms'];

function Caret(): React.ReactElement {
  return <span aria-hidden="true" className="preview-caret ml-0.5 inline-block h-[1em] w-px translate-y-[2px] bg-current" />;
}

function ThinkingIndicator(): React.ReactElement {
  return (
    <span className="flex items-center gap-2 text-xs text-zinc-500">
      <span className="flex items-center gap-1">
        {DOT_DELAYS.map((delay) => (
          <span key={delay} style={{ animationDelay: delay }} className="size-1.5 animate-bounce rounded-full bg-indigo-400" />
        ))}
      </span>
      Searching employee-handbook.pdf…
    </span>
  );
}

/** Decorative animated chat: the user types, the assistant "thinks", then answers from the document. */
export function ChatPreview(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const isReduced = usePrefersReducedMotion();
  const totalMs = usePreviewClock(containerRef, !isReduced);

  // Server render, first paint and reduced motion all show the static first exchange until the clock starts.
  const located = locateScenario(CHAT_PREVIEW_SCENARIOS, totalMs ?? 0);
  const scenario = CHAT_PREVIEW_SCENARIOS[located.index] ?? FIRST_SCENARIO;
  const frame = isReduced || totalMs === null ? STATIC_FRAME : getPreviewFrame(scenario, located.elapsedMs);

  const isUserVisible = frame.userText.length > 0 || frame.phase === 'user-typing';
  const isAnswerVisible = frame.phase === 'thinking' || frame.phase === 'answer-typing' || frame.phase === 'holding';

  return (
    <div ref={containerRef}>
      <p className="sr-only">
        Example conversation. Question: {FIRST_SCENARIO.question} Answer: {FIRST_SCENARIO.answer}
      </p>
      <div aria-hidden="true" data-testid="chat-preview" className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 border-b border-zinc-100 pb-3 text-xs text-zinc-500">
          <FileText className="size-4 text-indigo-600" />
          employee-handbook.pdf
        </div>
        <div className="h-52 space-y-3 sm:h-44 overflow-hidden pt-4 text-sm">
          <div className={isUserVisible ? 'ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-indigo-600 px-3 py-2 text-white' : 'invisible h-9'}>
            {frame.userText}
            {frame.phase === 'user-typing' ? <Caret /> : null}
          </div>
          <div className={isAnswerVisible ? 'w-fit max-w-[85%] rounded-lg rounded-bl-sm bg-zinc-100 px-3 py-2 text-zinc-800' : 'invisible h-9'}>
            {isAnswerVisible ? (
              <>
                <span className="mb-1 flex items-center gap-1 text-xs font-medium text-indigo-600">
                  <Sparkles className="size-3" /> Docly AI
                </span>
                {frame.phase === 'thinking' ? <ThinkingIndicator /> : frame.answerText}
                {frame.phase === 'answer-typing' ? <Caret /> : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
