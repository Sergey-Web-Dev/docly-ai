import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface DocumentStatusBadgeProps {
  readonly status: string;
}

export function DocumentStatusBadge({ status }: DocumentStatusBadgeProps): React.ReactElement {
  if (status === 'ready') {
    return <Badge className="bg-emerald-100 text-emerald-800"><CheckCircle2 aria-hidden />Ready</Badge>;
  }
  if (status === 'failed') {
    return <Badge variant="destructive"><XCircle aria-hidden />Failed</Badge>;
  }
  return <Badge variant="secondary"><Loader2 className="animate-spin" aria-hidden />Processing</Badge>;
}
