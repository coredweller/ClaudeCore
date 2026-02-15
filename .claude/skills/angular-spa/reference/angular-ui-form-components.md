# Angular UI Form Components

Reusable Angular 21+ form components using daisyUI 5.5.5 + TailwindCSS 4.x.
All components use standalone, OnPush, and signal-based APIs.

## Form Field Component

```typescript
import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';

@Component({
  selector: 'app-form-field',

  template: `
    <div class="form-control w-full">
      <label class="label" [for]="inputId()">
        <span class="label-text">
          {{ label() }}
          @if (required()) {
            <span class="text-error ml-1" aria-hidden="true">*</span>
          }
        </span>
        @if (labelAlt()) {
          <span class="label-text-alt">{{ labelAlt() }}</span>
        }
      </label>
      <ng-content></ng-content>
      @if (errorMessage()) {
        <label class="label">
          <span class="label-text-alt text-error" role="alert">{{ errorMessage() }}</span>
        </label>
      }
      @if (hint() && !errorMessage()) {
        <label class="label">
          <span class="label-text-alt text-base-content/60">{{ hint() }}</span>
        </label>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FormFieldComponent {
  label = input.required<string>();
  hint = input<string>('');
  labelAlt = input<string>('');
  required = input<boolean>(false);
  errorMessage = input<string | null>(null);

  protected readonly inputId = computed(() =>
    `field-${this.label().toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 9)}`
  );
}
```

## Form with Validation

```typescript
import {
  Component, ChangeDetectionStrategy, signal, inject
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormFieldComponent } from './form-field.component';

@Component({
  selector: 'app-contact-form',

  imports: [ReactiveFormsModule, FormFieldComponent],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="space-y-4">
      <app-form-field label="Full Name" [required]="true" [errorMessage]="getError('name')">
        <input type="text" formControlName="name"
          class="input input-bordered w-full" [class.input-error]="hasError('name')" />
      </app-form-field>

      <app-form-field label="Email" [required]="true" [errorMessage]="getError('email')">
        <input type="email" formControlName="email"
          class="input input-bordered w-full" [class.input-error]="hasError('email')" />
      </app-form-field>

      <app-form-field label="Message" [required]="true" [errorMessage]="getError('message')" labelAlt="Max 500 chars">
        <textarea formControlName="message"
          class="textarea textarea-bordered w-full h-32" [class.textarea-error]="hasError('message')"></textarea>
      </app-form-field>

      <div class="flex justify-end gap-2 pt-4">
        <button type="button" class="btn btn-ghost" (click)="form.reset()">Clear</button>
        <button type="submit" class="btn btn-primary" [disabled]="!form.valid || submitting()">
          @if (submitting()) { <span class="loading loading-spinner loading-sm"></span> }
          Send
        </button>
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContactFormComponent {
  private readonly fb = inject(FormBuilder);
  protected readonly submitting = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    message: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(500)]]
  });

  protected hasError(field: string): boolean {
    const c = this.form.get(field);
    return !!(c?.invalid && c?.touched);
  }

  protected getError(field: string): string | null {
    const c = this.form.get(field);
    if (!c?.invalid || !c?.touched) return null;
    if (c.errors?.['required']) return `${field.charAt(0).toUpperCase() + field.slice(1)} is required`;
    if (c.errors?.['email']) return 'Please enter a valid email';
    if (c.errors?.['minlength']) return `Minimum ${c.errors['minlength'].requiredLength} characters`;
    if (c.errors?.['maxlength']) return `Maximum ${c.errors['maxlength'].requiredLength} characters`;
    return 'Invalid value';
  }

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.submitting.set(true);
    try {
      // API call here
      this.form.reset();
    } finally {
      this.submitting.set(false);
    }
  }
}
```
