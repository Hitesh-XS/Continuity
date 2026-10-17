import { defineConfig } from 'wxt';
import { PROVIDERS } from './src/shared/providers';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Continuity',
    description: 'Persistent memory for AI work: save the state of your work, not just the chat.',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'storage', 'scripting'],
    // Site access is optional: Chrome asks only when the user enables a provider.
    optional_host_permissions: PROVIDERS.flatMap((provider) => [...provider.matches]),
    action: { default_title: 'Open Continuity' },
  },
});