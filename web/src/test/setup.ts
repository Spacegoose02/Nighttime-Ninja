import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has <dialog> but not its modal methods.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
