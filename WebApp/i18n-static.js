// The page's static texts in the player's language (GH_I18N.applyStatic), set once: this is the first script after the
// page's own markup, so every game script after it reads the texts in that language.
globalThis.GH_I18N?.applyStatic?.(globalThis.document);
