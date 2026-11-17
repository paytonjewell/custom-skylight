// Lets `npm test` import app files the way the app does: `import … from './repeat'` with no
// extension (Vite resolves those; Node needs the .ts added).
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
      throw e;
    }
  },
});
