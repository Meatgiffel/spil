import "fake-indexeddb/auto";

// fake-indexeddb giver Dexie et rigtigt IndexedDB, så testene rammer den samme
// kode som browseren gør.
//
// Sync-loopet lytter på window og document, som ikke findes i node-miljøet. De
// stubbes her i stedet for at trække jsdom ind for to eventlyttere. navigator
// røres ikke: Node har den allerede som read-only, og uden onLine falder
// offline-tjekket rigtigt igennem til netværksfejlen.
const noop = () => {};

Object.defineProperties(globalThis, {
  window: {
    value: { addEventListener: noop, removeEventListener: noop },
    configurable: true,
  },
  document: {
    value: {
      addEventListener: noop,
      removeEventListener: noop,
      visibilityState: "visible",
    },
    configurable: true,
  },
});
