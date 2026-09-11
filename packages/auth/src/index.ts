export {
  RESOURCES,
  ACTIONS,
  PERMISSION_MATRIX,
  can,
  assertPermission,
  ForbiddenError,
  studentScopeWhere,
} from "./permissions";
export type { Resource, Action, AuthUser } from "./permissions";
export { hashPassword, verifyPassword } from "./passwords";
export { Role, ALL_ROLES } from "./roles";
