import { defineConfig } from 'tsup';

// Dual ESM + CJS build with type declarations. The package.json "react-native"
// field points Metro at untranspiled src so the host app's Babel/JSX transform
// applies; these dist outputs serve Node/Jest/TS-server resolution.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  // Never bundle the host's runtime deps into the library.
  external: ['react', 'react-native', 'react-native-webview'],
  target: 'es2019',
});
