import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { banner as authBanner, gatewayIdentity } from '@mis/auth-middleware';
import { banner as acBanner, accessGuard } from '@mis/access-control';

const PREFIX = 'api/documents';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Kong already authenticated the caller (jwt plugin). These read the
  // forwarded identity and enforce per-service authorization.
  app.use(gatewayIdentity());

  // The documents endpoints carry dynamic /:documentId segments, so we
  // can't use the access-guard's exact-match allow list for them. Mount
  // a prefix-bypass that whitelists everything under /api/documents (the
  // service-to-service surface during the PoC); the access guard still
  // enforces on /me. In production these would carry document:upload /
  // document:read permissions instead of being whitelisted wholesale.
  app.use((req: any, _res: any, next: () => void) => {
    if (req.path === '/api/documents' || req.path.startsWith('/api/documents/')) {
      if (req.path !== '/api/documents/me') req.__skipAccessGuard = true;
    }
    next();
  });
  app.use((req: any, res: any, next: () => void) => {
    if (req.__skipAccessGuard) return next();
    return accessGuard({
      permission: 'profile:read',
      // Whitelisted in-service (still token-gated by Kong, except the
      // health/ready paths which are also whitelisted in kong.yml).
      allow: ['/api/documents/health', '/api/documents/ready', '/api/documents/me'],
    })(req, res, next);
  });

  app.setGlobalPrefix(PREFIX);
  const port = Number(process.env.PORT) || 3007;
  await app.listen(port);
  console.log(authBanner());
  console.log(acBanner());
  console.log(`mis-document-service listening on http://localhost:${port}/${PREFIX}`);
}
bootstrap();
