// Augment Express Request with the resolved organisation scope.
declare global {
  namespace Express {
    interface Request {
      orgId?: string;
    }
  }
}

export {};
