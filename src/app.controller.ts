import { Controller, Get, Req } from '@nestjs/common';
import { permissionsForRoles } from '@mis/access-control';

const SERVICE = 'mis-document-service';

@Controller()
export class AppController {
  // Functional route — requires the 'profile:read' permission (accessGuard).
  @Get()
  index() {
    return { service: SERVICE, message: 'hello from document', route: '/api/documents' };
  }

  // Whoami — any authenticated user may introspect their own identity,
  // roles and resolved permissions on any service.
  @Get('me')
  me(@Req() req: any) {
    return {
      service: SERVICE,
      user: req.user ?? null,
      correlationId: req.correlationId ?? null,
      roles: req.user?.roles ?? [],
      permissions: permissionsForRoles(req.user?.roles ?? []),
    };
  }

  @Get('health')
  health() {
    return { status: 'ok', service: SERVICE };
  }

  @Get('ready')
  ready() {
    return { status: 'ready', service: SERVICE };
  }
}
