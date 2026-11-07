// Test-only stand-in for @nestjs/throttler (CJS build can't load under
// Jest's ESM mode with Nest 12). Also avoids 429s during test runs.
class ThrottlerStubModule {}

export const ThrottlerModule = {
  forRoot: () => ({ module: ThrottlerStubModule }),
  forRootAsync: () => ({ module: ThrottlerStubModule }),
};

export class ThrottlerGuard {
  canActivate() {
    return true;
  }
}

export const Throttle = () => () => undefined;
export const SkipThrottle = () => () => undefined;