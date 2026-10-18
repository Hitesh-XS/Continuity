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
  hooks: {
    // WXT derives host_permissions from our runtime-registered content script.
    // We never want install-time site access, so strip it from the final manifest.
    'build:manifestGenerated': (_wxt, manifest) => {
      delete manifest.host_permissions;
    },
  },
});