export interface Env {
  // Bindings
  DB: D1Database;
  PHOTO_BUCKET: R2Bucket;
  ASSETS?: Fetcher;

  // Environment variables
  ENVIRONMENT: string;
  AUTH_MODE?: string; // 'access' | 'development'
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
}

export interface AuthUser {
  userId: string;
  email: string;
  employeeId?: string;
  name: string;
  roles: ('ADMIN' | 'OPERATOR' | 'REVIEWER')[];
}
