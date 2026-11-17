/*
 * RUMCET - ROM's Ultimate Manager, Conversion and Editor Tool
 * Copyright (C) 2025 Nanaki59
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
// src/helpers/operationSignal.ts
// Interruption des opérations longues (scan, consolidation), en deux niveaux :
// - `cancelRequested` : s'arrêter proprement après l'élément en cours ;
// - `abort` : abandonner immédiatement l'élément en cours (arrêt forcé).

export interface OperationSignal {
  cancelRequested: boolean;
  abort: AbortController;
}

export function createOperationSignal(): OperationSignal {
  return { cancelRequested: false, abort: new AbortController() };
}

export class OperationAbortedError extends Error {
  constructor() {
    super('Operation aborted');
    this.name = 'OperationAbortedError';
  }
}

/** Lève OperationAbortedError si un arrêt forcé a été demandé. */
export function throwIfAborted(signal: OperationSignal | AbortSignal | undefined | null): void {
  if (!signal) return;
  const abortSignal = signal instanceof AbortSignal ? signal : signal.abort.signal;
  if (abortSignal.aborted) throw new OperationAbortedError();
}

/**
 * Rejette dès que le signal est déclenché, sans attendre la promesse (qui peut
 * être bloquée). Le résultat tardif de la promesse est ignoré.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new OperationAbortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new OperationAbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(signal.aborted ? new OperationAbortedError() : error); }
    );
  });
}
