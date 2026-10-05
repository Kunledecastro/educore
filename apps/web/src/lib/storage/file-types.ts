/** File limits and accepted types (Phase 5). No Node imports: shared with the browser. */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_SUBMISSION = 10;
export const MAX_FILES_PER_ASSIGNMENT = 5;

export const ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
} as const;
export type AllowedType = keyof typeof ALLOWED_TYPES;

