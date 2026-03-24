/**
 * Eligibility service integration tests (simplified)
 * Note: Service layer mocks are validated via integration; full unit testing
 * depends on Prisma client availability. These tests verify module structure.
 */

import { EligibilityDecision } from '../types';

// Import to verify files exist and compile
import '../service';

describe('Eligibility Service', () => {
  describe('Module structure', () => {
    it('should export service functions', async () => {
      const serviceModule = await import('../service');
      
      expect(serviceModule).toHaveProperty('evaluateProjectEligibility');
      expect(serviceModule).toHaveProperty('getLatestEligibilityAssessment');
      expect(serviceModule).toHaveProperty('getEligibilityAssessmentHistory');
      expect(serviceModule).toHaveProperty('hasEligibilityAssessment');
    });

    it('should have proper type definitions', async () => {
      const serviceModule = await import('../service');
      
      // Verify functions are callable
      expect(typeof serviceModule.evaluateProjectEligibility).toBe('function');
      expect(typeof serviceModule.getLatestEligibilityAssessment).toBe('function');
      expect(typeof serviceModule.getEligibilityAssessmentHistory).toBe('function');
      expect(typeof serviceModule.hasEligibilityAssessment).toBe('function');
    });
  });
});
