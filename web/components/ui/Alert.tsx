import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';

const TONES = {
  error: { box: 'border-red-200 bg-red-50 text-red-800', Icon: AlertCircle },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-800', Icon: AlertTriangle },
  info: { box: 'border-sky-200 bg-sky-50 text-sky-800', Icon: Info },
} as const;

export function Alert({ tone = 'warning', title, children, action }: {
  tone?: keyof typeof TONES;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const { box, Icon } = TONES[tone];
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${box}`}>
      <Icon className="mt-0.5 shrink-0" size={18} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 text-xs leading-5 opacity-85">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
