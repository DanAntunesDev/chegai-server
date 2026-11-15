import { z } from 'zod';
import { paginationSchema } from '../../common/validation/fields';

const period = {
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  tenantId: z.uuid().optional(),
};

export const requestLogsQuerySchema = paginationSchema.extend({
  ...period,
  method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE', 'GET']).optional(),
  status: z.enum(['success', 'client_error', 'server_error']).optional(),
  statusCode: z.coerce.number().int().min(100).max(599).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  actor: z.enum(['admin', 'staff', 'customer', 'webhook', 'anonymous']).optional(),
});

export const auditLogsQuerySchema = paginationSchema.extend({
  ...period,
  action: z.string().trim().min(2).max(80).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

export type RequestLogsQuery = z.infer<typeof requestLogsQuerySchema>;
export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
