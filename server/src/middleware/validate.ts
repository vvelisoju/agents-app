import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

// Validate req.body against a Zod schema; on failure return a 400 with a clear,
// machine-readable error. On success, req.body is the parsed/typed value.
export const validate = (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    const first = r.error.issues[0];
    return res.status(400).json({
      error: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'invalid input',
      code: 'invalid_input',
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  req.body = r.data;
  next();
};
