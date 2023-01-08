import type { Prisma } from "@prisma/client";
export type NestedAction = Prisma.PrismaAction | 'connectOrCreate';
export type NestedParams = Omit<Prisma.MiddlewareParams, 'action'> & {
    action: NestedAction;
    scope?: NestedParams;
};
export type NestedMiddleware<T = any> = (params: NestedParams, next: (modifiedParams: NestedParams) => Promise<T>) => Promise<T>;
export declare function init(prisma?: typeof Prisma): void;
export declare function createNestedMiddleware<T>(middleware: NestedMiddleware): Prisma.Middleware<T>;
