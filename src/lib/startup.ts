import { upgradeDatabaseIfNeeded } from './database-upgrader';
import { initializeEngines } from './engines';

export async function initSystem() {
  try {
    console.log('========================');
    console.log('LinkAI Gateway starting...');

    await upgradeDatabaseIfNeeded();
    await initializeEngines();

    console.log('========================');
    return true;
  } catch (error) {
    console.error('System initialization failed:', error);
    return false;
  }
}

export const SYSTEM_INITIALIZED = true; 