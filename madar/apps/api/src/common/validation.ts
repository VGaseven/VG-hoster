import { z } from 'zod';
import { AppError } from './errors';

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new AppError('VALIDATION', 'بيانات غير صالحة', 400, r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const zTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'HH:MM');
export const zUuid = z.string().uuid();
