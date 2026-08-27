import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { Button } from '@/shared/components/ui';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Phase 29 Section 25: the top-level render-crash safety net. A React
 * render error anywhere below this (a null-pointer bug, a bad third-party
 * response shape, anything) must never surface a blank white screen or a
 * raw stack trace to a real customer — it must show one recoverable,
 * Azerbaijani-language screen instead. The actual error is logged locally
 * for developer diagnosis only; nothing about it (message, stack,
 * component names) is rendered into the DOM.
 */
export class ErrorBoundary extends Component<Props, State> {
  public override state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error caught by ErrorBoundary:', error, info.componentStack);
  }

  private handleRetry = (): void => {
    window.location.reload();
  };

  private handleGoToDashboard = (): void => {
    window.location.href = '/';
  };

  public override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-xl font-semibold text-foreground">Xəta baş verdi</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Gözlənilməz bir xəta baş verdi. İşiniz təhlükəsizdir — heç nə itirilməyib. Problem davam edərsə, bizə "Rəy bildir" bölməsindən yazın.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={this.handleRetry}>Yenidən cəhd et</Button>
          <Button onClick={this.handleGoToDashboard}>Panelə qayıt</Button>
        </div>
      </div>
    );
  }
}
