import 'dotenv/config';
import { discoverAndEvaluateGrants } from '@/backend/eligibility/discoverySearchProvider';
import { EligibilityInput } from '@/backend/eligibility/types';

const input: EligibilityInput = {
  project: { projectId: 'cli-test', projectStatus: 'draft', address: '22 e, Toronto, ON' },
  required: {
    province: 'ON',
    ownershipStatus: 'owner',
    clientConsentConfirmed: true,
    modificationCodes: ['GRAB_BARS'],
  },
  optional: {
    name: null,
    email: null,
    phone: null,
    city: 'Toronto',
    postalCode: null,
    ownershipOtherDetails: null,
    landlordName: null,
    landlordPhone: null,
    isCaregiver: false,
    seniorName: null,
    relationshipToSenior: null,
    caregiverConsentConfirmed: null,
  },
  missingRequiredFields: [],
  malformedDraftFields: [],
};

const startedAt = Date.now();
console.log('Starting discovery (mock AI)...');

discoverAndEvaluateGrants(input)
  .then((result) => {
    console.log(`Done in ${Date.now() - startedAt}ms`);
    console.log(
      JSON.stringify(
        {
          provider: result.discoveryMetadata.provider,
          returnedCount: result.discoveryMetadata.returnedCount,
          grantIds: result.discoveredGrants.map((g) => g.grantId),
        },
        null,
        2
      )
    );
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
