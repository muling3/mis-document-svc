export declare class AppController {
    index(): {
        service: string;
        message: string;
        route: string;
    };
    me(req: any): {
        service: string;
        user: any;
        correlationId: any;
        roles: any;
        permissions: ("case:read" | "case:write" | "reporting:read" | "reporting:export" | "profile:read")[];
    };
    health(): {
        status: string;
        service: string;
    };
    ready(): {
        status: string;
        service: string;
    };
}
