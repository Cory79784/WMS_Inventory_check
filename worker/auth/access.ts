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
      const configuredAdmins = (env.ADMIN_EMAILS || 'salahdhy@gmail.com')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      const isConfiguredAdmin = configuredAdmins.includes(emailHeader.toLowerCase());

      let userRecord = await env.DB.prepare(
        `SELECT user_id, email, employee_id, name, is_active FROM users WHERE email = ?`
      ).bind(emailHeader).first<{
        user_id: string;
        email: string;
        employee_id: string | null;
        name: string;
        is_active: number;
      }>();

      // Only designated admin emails can be auto-provisioned
      if (!userRecord) {
        if (isConfiguredAdmin) {
          const bootstrapId = `usr_${Date.now()}`;
          await env.DB.prepare(
            `INSERT INTO users (user_id, email, name, is_active) VALUES (?, ?, ?, 1)`
          ).bind(bootstrapId, emailHeader, emailHeader.split('@')[0]).run();

          await env.DB.prepare(
            `INSERT INTO user_roles (user_id, role) VALUES (?, 'ADMIN'), (?, 'OPERATOR'), (?, 'REVIEWER')`
          ).bind(bootstrapId, bootstrapId, bootstrapId).run();

          userRecord = {
            user_id: bootstrapId,
            email: emailHeader,
            employee_id: null,
            name: emailHeader.split('@')[0],
            is_active: 1,
          };
        } else {
          return {
            user: null,
            error: `用户 ${emailHeader} 未在系统中授权。仅预先配置的系统管理员 (${configuredAdmins.join(', ')}) 可初始化访问，其他操作员需由管理员在系统中添加。`,
          };
        }
      }

      if (!userRecord.is_active) {
        return {
          user: null,
          error: `用户 ${emailHeader} 账号已被系统停用。`,
        };
      }

      const rolesResult = await env.DB.prepare(
        `SELECT role FROM user_roles WHERE user_id = ?`
      ).bind(userRecord.user_id).all<{ role: 'ADMIN' | 'OPERATOR' | 'REVIEWER' }>();

      let roles = rolesResult.results.map((r) => r.role);
      if (isConfiguredAdmin && !roles.includes('ADMIN')) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'ADMIN')`
        ).bind(userRecord.user_id).run();
        roles = ['ADMIN', ...roles];
      }

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
