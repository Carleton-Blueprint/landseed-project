import { ADMIN_ACCESS_DENIED_ACTIONS, buildDeniedAdminAccessEventForTest } from '../adminAccess';

describe('buildDeniedAdminAccessEventForTest', () => {
  it('builds a restricted denial event for admin routes', () => {
    const event = buildDeniedAdminAccessEventForTest({
      surface: 'route',
      actorUserId: 'user-1',
      routePath: '/api/admin/audit/verify',
      method: 'GET',
      resourceType: 'AdminRoute',
      resourceId: '/api/admin/audit/verify',
      reason: 'forbidden',
      metadata: { source: 'middleware' },
      ipAddress: '203.0.113.10',
      userAgent: 'Mozilla/5.0',
    });

    expect(event.action).toBe(ADMIN_ACCESS_DENIED_ACTIONS.ROUTE);
    expect(event.category).toBe('SENSITIVE_ACCESS');
    expect(event.outcome).toBe('DENIED');
    expect(event.sensitivityLevel).toBe('RESTRICTED');
    expect(event.reason).toBe('forbidden');
    expect(event.metadata).toEqual({
      surface: 'route',
      routePath: '/api/admin/audit/verify',
      method: 'GET',
      source: 'middleware',
    });
  });

  it('builds a restricted denial event for admin data access', () => {
    const event = buildDeniedAdminAccessEventForTest({
      surface: 'data',
      actorUserId: 'user-2',
      routePath: '/api/admin/eligibility/assess',
      method: 'POST',
      resourceType: 'Project',
      resourceId: 'project-123',
      projectId: 'project-123',
      reason: 'Unauthorized access to project',
    });

    expect(event.action).toBe(ADMIN_ACCESS_DENIED_ACTIONS.DATA);
    expect(event.projectId).toBe('project-123');
    expect(event.resourceType).toBe('Project');
    expect(event.resourceId).toBe('project-123');
    expect(event.metadata).toEqual({
      surface: 'data',
      routePath: '/api/admin/eligibility/assess',
      method: 'POST',
    });
  });
});