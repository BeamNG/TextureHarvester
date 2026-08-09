export const TX = (window.TX = window.TX || {});

TX.version = typeof __TX_VERSION__ === "string" ? __TX_VERSION__ : "dev";

// Refuse on schema mismatch — never half-apply.
TX.schema = {
  document: 1,
  view: 1,
  layout: 1,
  history: 1,
};
