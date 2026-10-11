import { Env, AuthUser } from '../types';

/**
 * Universal Access Authenticator
 * Zero Trust / Access mandatory login has been removed per user decision.
 * Requests are never rejected due to missing Access JWT tokens.
 * If Cloudflare Access headers are present, they are captured for operator attribution.
 * All operators/visitors share full operational capabilities.
 */
export async function authenticateRequest(
  request: Request,
  _env: Env
): Promise<{ user: AuthUser; error?: string }> {
  const emailHeader = request.headers.get('Cf-Access-Authenticated-User-Email');
  const email = emailHeader || 'operator@warehouse.local';
  const name = email.split('@')[0];

  return {
    user: {
      userId: 'user-operator',
      email,
      employeeId: 'OP001',
      name,
      roles: ['ADMIN', 'OPERATOR', 'REVIEWER'],
    },
  };
}
