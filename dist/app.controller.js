"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppController = void 0;
const common_1 = require("@nestjs/common");
const access_control_1 = require("@mis/access-control");
const SERVICE = 'mis-document-service';
let AppController = class AppController {
    // Functional route — requires the 'profile:read' permission (accessGuard).
    index() {
        return { service: SERVICE, message: 'hello from document', route: '/api/documents' };
    }
    // Whoami — any authenticated user may introspect their own identity,
    // roles and resolved permissions on any service.
    me(req) {
        return {
            service: SERVICE,
            user: req.user ?? null,
            correlationId: req.correlationId ?? null,
            roles: req.user?.roles ?? [],
            permissions: (0, access_control_1.permissionsForRoles)(req.user?.roles ?? []),
        };
    }
    health() {
        return { status: 'ok', service: SERVICE };
    }
    ready() {
        return { status: 'ready', service: SERVICE };
    }
};
exports.AppController = AppController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "index", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AppController.prototype, "me", null);
__decorate([
    (0, common_1.Get)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "health", null);
__decorate([
    (0, common_1.Get)('ready'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "ready", null);
exports.AppController = AppController = __decorate([
    (0, common_1.Controller)()
], AppController);
//# sourceMappingURL=app.controller.js.map