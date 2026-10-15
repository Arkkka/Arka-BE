declare global {
  namespace Express {
    interface Request {
      requestId: string;
      sessionContext?: {
        userId: string;
        email: string;
        name: string;
        image: string | null;
        institutionId: string | null;
        institutionName: string | null;
        sessionId: string;
        sessionExpiresAt: Date;
      };
      authContext?: {
        userId: string;
        email: string;
        name: string;
        image: string | null;
        institutionId: string;
        institutionName: string;
        sessionId: string;
        sessionExpiresAt: Date;
      };
    }
  }
}

export {};
