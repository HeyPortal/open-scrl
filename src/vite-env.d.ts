/// <reference types="vite/client" />
declare module '*.css';
declare module '*.wasm?url' {
  const src: string;
  export default src;
}
declare module 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url' {
  const src: string;
  export default src;
}
declare module 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url' {
  const src: string;
  export default src;
}
