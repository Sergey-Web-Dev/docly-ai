import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatMessage, type ChatMessageData } from './chat-message';

function render(message: ChatMessageData, mode: 'owner' | 'public'): string {
  return renderToStaticMarkup(createElement(ChatMessage, { message, mode }));
}

const ANSWER: ChatMessageData = {
  id: 'm1',
  role: 'assistant',
  content: 'New hires get 20 vacation days.',
  sources: [
    { documentId: 'd1', fileName: 'employee-handbook.pdf' },
    { documentId: 'd2', fileName: 'benefits.txt' },
  ],
};

describe('ChatMessage sources', () => {
  it('should render a chip per source with the plural label when the owner sees an answer with sources', () => {
    const html = render(ANSWER, 'owner');
    expect(html).toContain('data-testid="chat-sources"');
    expect(html).toContain('employee-handbook.pdf');
    expect(html).toContain('benefits.txt');
    expect(html).toContain('>Sources<');
  });

  it('should use the singular label when there is exactly one source', () => {
    const html = render({ ...ANSWER, sources: [{ documentId: 'd1', fileName: 'faq.txt' }] }, 'owner');
    expect(html).toContain('>Source<');
    expect(html).not.toContain('>Sources<');
  });

  it('should never render chips or file names in public mode, even when the data is present', () => {
    const html = render(ANSWER, 'public');
    expect(html).not.toContain('chat-sources');
    expect(html).not.toContain('employee-handbook.pdf');
    expect(html).toContain('New hires get 20 vacation days.');
  });

  it('should render no chips when the answer has no sources or the field is missing', () => {
    expect(render({ ...ANSWER, sources: [] }, 'owner')).not.toContain('chat-sources');
    expect(render({ id: 'm2', role: 'assistant', content: 'Hello' }, 'owner')).not.toContain('chat-sources');
  });

  it('should not render chips on user messages or error bubbles', () => {
    expect(render({ ...ANSWER, role: 'user' }, 'owner')).not.toContain('chat-sources');
    expect(render({ ...ANSWER, kind: 'error' }, 'owner')).not.toContain('chat-sources');
  });

  it('should escape file names so markup in a name cannot inject HTML', () => {
    const html = render({ ...ANSWER, sources: [{ documentId: 'd1', fileName: '<img src=x onerror=alert(1)>.pdf' }] }, 'owner');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
