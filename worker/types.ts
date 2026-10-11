export interface Env {
  // Bindings
  DB: D1Database;
  PHOTO_BUCKET: R2Bucket;
  ASSETS?: Fetcher;

  // Environment variables
  ENVIRONMENT: string;
}

export interface AuthUser {
  userId: string;
  email: string;
  employeeId?: string;
  name: string;
  roles: ('ADMIN' | 'OPERATOR' | 'REVIEWER')[];
}
