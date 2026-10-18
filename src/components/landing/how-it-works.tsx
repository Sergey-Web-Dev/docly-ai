import { Code2, MessageSquare, Upload, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Step {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

const STEPS: readonly Step[] = [
  { title: 'Upload', description: 'Add your PDF, DOCX, TXT or Markdown files. Docly AI reads and indexes them for you.', icon: Upload },
  { title: 'Ask', description: 'Chat with your documents and get answers based only on what your files say.', icon: MessageSquare },
  { title: 'Embed', description: 'Paste one script tag to put the same assistant on your own website.', icon: Code2 },
];

export function HowItWorks(): React.ReactElement {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-14 py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="how-heading" className="text-3xl font-semibold tracking-tight text-white">
          How it works
        </h2>
        <p className="mt-3 max-w-2xl text-zinc-400">From a folder of documents to a working assistant in three steps.</p>
        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Card className="h-full border border-white/10 bg-white/5 text-zinc-100 shadow-none ring-0 backdrop-blur-md">
                <CardHeader>
                  <span className="mb-2 flex size-9 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
                    <step.icon className="size-5" aria-hidden="true" />
                  </span>
                  <CardTitle className="text-base text-white">
                    {index + 1}. {step.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-zinc-400">{step.description}</CardDescription>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
