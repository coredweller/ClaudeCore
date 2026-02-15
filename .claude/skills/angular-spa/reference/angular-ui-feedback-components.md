# Angular UI Feedback & Utility Components

Reusable Angular 21+ feedback and utility components using daisyUI 5.5.5 + TailwindCSS 4.x.
All components use standalone, OnPush, and signal-based APIs.

## Toast Service & Component

```typescript
// toast.service.ts
import { Injectable, signal } from '@angular/core';

export type ToastType = 'info' | 'success' | 'warning' | 'error';
export interface Toast { id: string; type: ToastType; message: string; title?: string; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  show(type: ToastType, message: string, opts: { title?: string; duration?: number } = {}): string {
    const id = crypto.randomUUID();
    const duration = opts.duration ?? (type === 'error' ? 0 : 5000);
    this._toasts.update(t => [...t, { id, type, message, title: opts.title }]);
    if (duration > 0) setTimeout(() => this.dismiss(id), duration);
    return id;
  }

  dismiss(id: string): void { this._toasts.update(t => t.filter(x => x.id !== id)); }

  info(msg: string, title?: string) { return this.show('info', msg, { title }); }
  success(msg: string, title?: string) { return this.show('success', msg, { title }); }
  warning(msg: string, title?: string) { return this.show('warning', msg, { title }); }
  error(msg: string, title?: string) { return this.show('error', msg, { title, duration: 0 }); }
}
```

```typescript
// toast-container.component.ts
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast-container',

  template: `
    <div class="toast toast-end toast-bottom z-50">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="alert shadow-lg"
          [class.alert-info]="toast.type === 'info'"
          [class.alert-success]="toast.type === 'success'"
          [class.alert-warning]="toast.type === 'warning'"
          [class.alert-error]="toast.type === 'error'"
          role="alert" [attr.aria-live]="toast.type === 'error' ? 'assertive' : 'polite'">
          <div class="flex-1">
            @if (toast.title) { <h3 class="font-bold">{{ toast.title }}</h3> }
            <p class="text-sm">{{ toast.message }}</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm btn-circle"
            (click)="toastService.dismiss(toast.id)" aria-label="Dismiss">x</button>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ToastContainerComponent {
  protected readonly toastService = inject(ToastService);
}
```

## Theme Toggle Component

```typescript
import {
  Component, ChangeDetectionStrategy, signal, inject, PLATFORM_ID, afterNextRender
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-theme-toggle',

  template: `
    <label class="swap swap-rotate">
      <input type="checkbox" class="theme-controller" value="dark"
        [checked]="isDark()" (change)="onToggle($event)" aria-label="Toggle dark mode" />
      <svg class="swap-off h-8 w-8 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"/>
      </svg>
      <svg class="swap-on h-8 w-8 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z"/>
      </svg>
    </label>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ThemeToggleComponent {
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly isDark = signal(false);

  constructor() {
    afterNextRender(() => {
      if (isPlatformBrowser(this.platformId)) {
        const saved = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.isDark.set(saved ? saved === 'dark' : prefersDark);
      }
    });
  }

  protected onToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.isDark.set(checked);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('theme', checked ? 'dark' : 'light');
    }
  }
}
```

## Theme Service

```typescript
import { Injectable, signal, computed, inject, PLATFORM_ID, effect } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';

export const DAISY_THEMES = [
  { name: 'light', label: 'Light', isDark: false },
  { name: 'dark', label: 'Dark', isDark: true },
  { name: 'corporate', label: 'Corporate', isDark: false },
  { name: 'business', label: 'Business', isDark: true },
  // Add more as needed from daisyUI's 35 themes
] as const;

export type ThemeName = typeof DAISY_THEMES[number]['name'];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  readonly themes = DAISY_THEMES;
  private readonly _current = signal<ThemeName>('light');
  readonly currentTheme = this._current.asReadonly();
  readonly isDarkMode = computed(() => this.themes.find(t => t.name === this._current())?.isDark ?? false);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const saved = localStorage.getItem('theme') as ThemeName;
      if (saved && this.themes.some(t => t.name === saved)) {
        this._current.set(saved);
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        this._current.set(prefersDark ? 'dark' : 'light');
      }
    }
    effect(() => {
      const theme = this._current();
      this.document.documentElement.setAttribute('data-theme', theme);
      const isDark = this.themes.find(t => t.name === theme)?.isDark ?? false;
      this.document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    });
  }

  setTheme(theme: ThemeName): void {
    this._current.set(theme);
    if (isPlatformBrowser(this.platformId)) localStorage.setItem('theme', theme);
  }

  toggleDarkMode(): void {
    this.setTheme(this.isDarkMode() ? 'light' : 'dark');
  }
}
```

## Confirm Dialog Service & Component

```typescript
// confirm-dialog.service.ts
import { Injectable, signal, computed } from '@angular/core';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private readonly _state = signal<{
    isOpen: boolean; title: string; message: string;
    confirmLabel: string; cancelLabel: string;
    variant: string; resolve: ((v: boolean) => void) | null;
  }>({ isOpen: false, title: '', message: '', confirmLabel: 'Confirm', cancelLabel: 'Cancel', variant: 'info', resolve: null });

  readonly state = this._state.asReadonly();
  readonly isOpen = computed(() => this._state().isOpen);

  confirm(opts: ConfirmDialogOptions): Promise<boolean> {
    return new Promise(resolve => {
      this._state.set({
        isOpen: true, title: opts.title, message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        variant: opts.variant ?? 'info', resolve
      });
    });
  }

  handleConfirm(): void { this._state().resolve?.(true); this.close(); }
  handleCancel(): void { this._state().resolve?.(false); this.close(); }
  private close(): void { this._state.update(s => ({ ...s, isOpen: false, resolve: null })); }
}
```

```typescript
// confirm-dialog.component.ts
import { Component, ChangeDetectionStrategy, inject, effect, viewChild, ElementRef } from '@angular/core';
import { ConfirmDialogService } from './confirm-dialog.service';

@Component({
  selector: 'app-confirm-dialog',

  template: `
    <dialog #dialogEl class="modal" (close)="service.handleCancel()">
      <div class="modal-box">
        <h3 class="font-bold text-lg">{{ service.state().title }}</h3>
        <p class="py-4">{{ service.state().message }}</p>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" (click)="service.handleCancel()">
            {{ service.state().cancelLabel }}
          </button>
          <button type="button" class="btn"
            [class.btn-error]="service.state().variant === 'danger'"
            [class.btn-warning]="service.state().variant === 'warning'"
            [class.btn-info]="service.state().variant === 'info'"
            (click)="service.handleConfirm()">
            {{ service.state().confirmLabel }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>close</button></form>
    </dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConfirmDialogComponent {
  protected readonly service = inject(ConfirmDialogService);
  private readonly dialogEl = viewChild<ElementRef<HTMLDialogElement>>('dialogEl');

  constructor() {
    effect(() => {
      const dialog = this.dialogEl()?.nativeElement;
      if (!dialog) return;
      this.service.isOpen() ? dialog.showModal() : dialog.close();
    });
  }
}
```

## Error Boundary

```typescript
import { Component, ChangeDetectionStrategy, input, signal, output } from '@angular/core';

@Component({
  selector: 'app-error-boundary',

  template: `
    @if (hasError()) {
      <div class="alert alert-error shadow-lg">
        <div class="flex-1">
          <h3 class="font-bold">{{ errorTitle() }}</h3>
          <p class="text-sm">{{ errorMessage() }}</p>
        </div>
        <button type="button" class="btn btn-sm btn-ghost" (click)="handleRetry()">Try Again</button>
      </div>
    } @else {
      <ng-content></ng-content>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ErrorBoundaryComponent {
  errorTitle = input<string>('Something went wrong');
  protected readonly hasError = signal(false);
  protected readonly errorMessage = signal('');
  retryAction = output<void>();

  setError(message: string): void { this.hasError.set(true); this.errorMessage.set(message); }
  clearError(): void { this.hasError.set(false); this.errorMessage.set(''); }

  protected handleRetry(): void { this.clearError(); this.retryAction.emit(); }
}
```

## Infinite Scroll Directive

```typescript
import { Directive, ElementRef, inject, input, output, afterNextRender, OnDestroy } from '@angular/core';

@Directive({ selector: '[appInfiniteScroll]' })
export class InfiniteScrollDirective implements OnDestroy {
  private readonly el = inject(ElementRef);
  threshold = input<number>(100);
  disabled = input<boolean>(false);
  loadMore = output<void>();
  private observer?: IntersectionObserver;
  private sentinel?: HTMLElement;

  constructor() {
    afterNextRender(() => {
      this.sentinel = document.createElement('div');
      this.sentinel.style.height = '1px';
      this.sentinel.setAttribute('aria-hidden', 'true');
      this.el.nativeElement.appendChild(this.sentinel);
      this.observer = new IntersectionObserver(
        entries => { if (entries[0].isIntersecting && !this.disabled()) this.loadMore.emit(); },
        { rootMargin: `${this.threshold()}px`, threshold: 0 }
      );
      this.observer.observe(this.sentinel);
    });
  }

  ngOnDestroy(): void { this.observer?.disconnect(); this.sentinel?.remove(); }
}
```
