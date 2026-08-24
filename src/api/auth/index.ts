// ariesModAPI/auth/index.ts
// Exports publics pour l'authentification

export {
  requestApiKey,
  ensureApiKey,
  hasApiKey,
  getApiKey,
  setApiKey,
  verifyApiKey,
  type ApiKeyCheck,
} from "./core";
export { initAuthBridgeIfNeeded } from "./bridge";
export { promptApiAuthOnStartup, showAuthModalIfNeeded } from "./gate";
