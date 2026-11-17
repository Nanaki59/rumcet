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
// src/helpers/archives/processRegistry.ts
// Registre des processus externes (7z, chdman, unrar…) lancés par les handlers
// d'archives. Permet à l'« arrêt forcé » d'un scan de tuer un outil bloqué :
// sans cela, abandonner la promesse côté JS laisserait le processus tourner.

import { ChildProcess, exec, execFile, ExecOptions, ExecFileOptions } from 'child_process';
import { promisify } from 'util';

const running = new Set<ChildProcess>();

/** Suit un processus jusqu'à sa fin ; retourne le processus pour chaîner. */
export function trackProcess<T extends ChildProcess | undefined | null>(child: T): T {
  if (child && child.exitCode === null) {
    running.add(child);
    const forget = () => running.delete(child);
    child.once('exit', forget);
    child.once('error', forget);
  }
  return child;
}

/** Tue tous les processus suivis encore actifs. Retourne le nombre de processus tués. */
export function killAllTrackedProcesses(): number {
  let killed = 0;
  for (const child of running) {
    try {
      if (child.kill()) killed++;
    } catch { /* déjà terminé */ }
  }
  running.clear();
  return killed;
}

const rawExecAsync = promisify(exec);

/** Équivalent de promisify(exec) dont le processus est suivi par le registre. */
export function trackedExecAsync(command: string, options: ExecOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const promise = rawExecAsync(command, options);
  trackProcess(promise.child);
  return promise as Promise<{ stdout: string; stderr: string }>;
}

const rawExecFileAsync = promisify(execFile);

/**
 * Équivalent de promisify(execFile) dont le processus est suivi par le registre.
 * Lance le binaire directement (sans shell) : les arguments n'ont pas à être
 * entourés de guillemets, quel que soit le système ou les caractères du chemin.
 */
export function trackedExecFileAsync(file: string, args: string[], options: ExecFileOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const promise = rawExecFileAsync(file, args, { ...options, encoding: 'utf8' });
  trackProcess(promise.child);
  return promise as Promise<{ stdout: string; stderr: string }>;
}
