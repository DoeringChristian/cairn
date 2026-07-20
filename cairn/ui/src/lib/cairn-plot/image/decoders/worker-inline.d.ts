/**
 * Ambient types for Vite's `?worker&inline` imports (the repo doesn't reference
 * `vite/client`). A `?worker&inline` module's default export is a zero-arg
 * constructor that returns a Web `Worker` backed by a self-contained inline blob.
 */
declare module "*?worker&inline" {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}
