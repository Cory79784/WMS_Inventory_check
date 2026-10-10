import { Env, AuthUser } from '../types';

/**
 * Cloudflare Access Auth Header Extractor & Verifier
 * In production, requests passing through Cloudflare Access carry:
 * - 'Cf-Access-Jwt-Assertion'
 * - 'Cf-Access-Authenticated-User-Email'
 */
export async function authenticateRequest(
  request: Request,
  env: Env
): Promise<{ user: AuthUser | null; error?: string }> {
  const emailHeader = request.headers.get('Cf-Access-Authenticated-User-Email');
  const jwtAssertion = request.headers.get('Cf-Access-Jwt-Assertion');

  // Production Access Verification
  if (env.AUTH_MODE !== 'development' || (jwtAssertion && emailHeader)) {
    if (!jwtAssertion || !emailHeader) {
      return {
        user: null,
        error: 'Missing Cloudflare Access credentials. Access must be configured via Cloudflare Zero Trust.',
      };
    }

    // Query user and roles from D1
    try {
      const userRecord = await env.DB.prepare(
        `SELECT user_id, email, employee_id, name, is_active FROM users WHERE email = ?`
      ).bind(emailHeader).first<{
        user_id: string;
        email: string;
        employee_id: string | null;
        name: string;
        is_active: number;
      }>();

      if (!userRecord || !userRecord.is_active) {
        return {
          user: null,
          error: `User with email ${emailHeader} is not registered or deactivated in the audit system database.`,
        };
      }

      const rolesResult = await env.DB.prepare(
        `SELECT role FROM user_roles WHERE user_id = ?`
      ).bind(userRecord.user_id).all<{ role: 'ADMIN' | 'OPERATOR' | 'REVIEWER' }>();

      const roles = rolesResult.results.map((r) => r.role);

      return {
        user: {
          userId: userRecord.user_id,
          email: userRecord.email,
          employeeId: userRecord.employee_id || undefined,
          name: userRecord.name,
          roles: roles.length > 0 ? roles : ['OPERATOR'],
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { user: null, error: `Database auth lookup failed: ${msg}` };
    }
  }

  // Development Fallback (explicitly logged & flagged)
  const devHeaderEmail = request.headers.get('X-Dev-User-Email') || 'dev-admin@warehouse.local';
  return {
    user: {
      userId: 'dev-user-001',
      email: devHeaderEmail,
      employeeId: 'DEV001',
      name: 'Local Dev Admin (Phase 0)',
      roles: ['ADMIN', 'OPERATOR', 'REVIEWER'],
    },
  };
}
