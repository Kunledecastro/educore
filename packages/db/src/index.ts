export * from "@prisma/client";
export { prisma } from "./client";
export { forTenant, platformPrisma, TENANT_OWNED_MODELS } from "./tenant-scope";
export type { TenantScopedClient } from "./tenant-scope";
export { recordAudit, withAudit, AUDITED_ENTITY_TYPES } from "./audit";
export type { AuditContext, AuditedEntityType } from "./audit";
export { withRls } from "./rls";
