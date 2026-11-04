import { Prisma } from '../../generated/prisma/client';

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function describe(error: unknown, depth = 0): string {
  if (!error || depth > 4) {
    return '';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error !== 'object') {
    return '';
  }
  const record = error as Record<string, unknown>;
  return [
    typeof record.message === 'string' ? record.message : '',
    typeof record.code === 'string' ? record.code : '',
    JSON.stringify(record.meta ?? {}),
    describe(record.cause, depth + 1),
  ].join(' ');
}

export function isExclusionViolation(error: unknown, constraint?: string): boolean {
  const text = describe(error);
  const isExclusion = text.includes('23P01') || /exclusion constraint/i.test(text);
  return isExclusion && (!constraint || text.includes(constraint));
}
