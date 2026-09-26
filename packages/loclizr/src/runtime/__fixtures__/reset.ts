// The store and the request scope are immutable handles on globalThis, so a
// test isolates itself by dropping both handles rather than by reaching into
// module state.
export function resetRuntime(): void {
  Reflect.deleteProperty(globalThis, Symbol.for('loclizr.store'))
  Reflect.deleteProperty(globalThis, Symbol.for('loclizr.locale'))
}
