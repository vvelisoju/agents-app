import { Request, Response, NextFunction } from 'express';

// Wrap an async route so rejected promises reach Express's error handler.
export const asyncHandler =
  (fn: (req: Request, res: Response) => any) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
