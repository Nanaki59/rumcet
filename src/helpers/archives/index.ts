// src/helpers/archives/index.ts

/**
 * Module d'archivage unifié
 * 
 * Exports:
 * - ArchiveManager: Gestionnaire principal (singleton)
 * - Handlers individuels pour chaque format
 * - Types et interfaces
 */

// Types
export * from './types.js';

// Handlers individuels
export { ZipHandler } from './ZipHandler.js';
export { SevenZipHandler } from './SevenZipHandler.js';
export { RarHandler } from './RarHandler.js';
export { ChdHandler } from './ChdHandler.js';
export { IsoHandler } from './IsoHandler.js';
export { CsoHandler } from './CsoHandler.js';

// Gestionnaire principal (singleton)
export { ArchiveManager, archiveManager } from './ArchiveManager.js';
