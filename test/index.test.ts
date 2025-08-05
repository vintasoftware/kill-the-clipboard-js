import { beforeEach, describe, expect, it } from 'vitest'
import {
  type FhirBundle,
  FhirBundleProcessor,
  FhirValidationError,
  JWSError,
  JWSProcessor,
  SmartHealthCard,
  type SmartHealthCardConfig,
  SmartHealthCardError,
  type SmartHealthCardJWT,
  type VerifiableCredential,
  type VerifiableCredentialOptions,
  VerifiableCredentialProcessor,
} from '../src/index'

// Test data fixtures
const createValidFhirBundle = (): FhirBundle => ({
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      fullUrl: 'Patient/123',
      resource: {
        resourceType: 'Patient',
        id: '123',
        name: [{ family: 'Doe', given: ['John'] }],
        birthDate: '1990-01-01',
      },
    },
    {
      fullUrl: 'Immunization/456',
      resource: {
        resourceType: 'Immunization',
        id: '456',
        status: 'completed',
        vaccineCode: {
          coding: [
            {
              system: 'http://hl7.org/fhir/sid/cvx',
              code: '207',
              display: 'COVID-19 vaccine',
            },
          ],
        },
        patient: { reference: 'Patient/123' },
        occurrenceDateTime: '2023-01-15',
      },
    },
  ],
})

const createInvalidBundle = (): any => ({
  resourceType: 'Patient', // Wrong resource type
  id: '123',
})

describe('SMART Health Cards Library', () => {
  describe('FhirBundleProcessor', () => {
    let processor: FhirBundleProcessor

    beforeEach(() => {
      processor = new FhirBundleProcessor()
    })

    describe('process()', () => {
      it('should process a valid FHIR Bundle', () => {
        const bundle = createValidFhirBundle()
        const result = processor.process(bundle)

        expect(result).toBeDefined()
        expect(result.resourceType).toBe('Bundle')
        expect(result.type).toBe('collection')
      })

      it('should set default Bundle.type to "collection"', () => {
        const bundle = createValidFhirBundle()
        delete bundle.type

        const result = processor.process(bundle)
        expect(result.type).toBe('collection')
      })

      it('should preserve existing Bundle.type if specified', () => {
        const bundle = createValidFhirBundle()
        bundle.type = 'batch'

        const result = processor.process(bundle)
        expect(result.type).toBe('batch')
      })

      it('should not modify the original bundle', () => {
        const bundle = createValidFhirBundle()
        const originalType = bundle.type

        processor.process(bundle)
        expect(bundle.type).toBe(originalType)
      })

      it('should throw FhirValidationError for null bundle', () => {
        expect(() => processor.process(null as any)).toThrow(FhirValidationError)
        expect(() => processor.process(null as any)).toThrow(
          'Invalid bundle: must be a FHIR Bundle resource'
        )
      })

      it('should throw FhirValidationError for invalid bundle', () => {
        const invalidBundle = createInvalidBundle()

        expect(() => processor.process(invalidBundle)).toThrow(FhirValidationError)
        expect(() => processor.process(invalidBundle)).toThrow(
          'Invalid bundle: must be a FHIR Bundle resource'
        )
      })
    })

    describe('validate()', () => {
      it('should validate a correct FHIR Bundle', () => {
        const bundle = createValidFhirBundle()
        expect(processor.validate(bundle)).toBe(true)
      })

      it('should throw FhirValidationError for null bundle', () => {
        expect(() => processor.validate(null as any)).toThrow(FhirValidationError)
        expect(() => processor.validate(null as any)).toThrow('Bundle cannot be null or undefined')
      })

      it('should throw FhirValidationError for wrong resource type', () => {
        const invalidBundle = createInvalidBundle()

        expect(() => processor.validate(invalidBundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidBundle)).toThrow('Resource must be of type Bundle')
      })

      it('should throw FhirValidationError for invalid Bundle.type', () => {
        const bundle = createValidFhirBundle()
        bundle.type = 'invalid-type' as any

        expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(bundle)).toThrow('Invalid bundle type: invalid-type')
      })

      it('should validate valid Bundle.type values', () => {
        const validTypes = [
          'collection',
          'batch',
          'history',
          'searchset',
          'transaction',
          'transaction-response',
        ]

        for (const type of validTypes) {
          const bundle = createValidFhirBundle()
          bundle.type = type as any
          expect(processor.validate(bundle)).toBe(true)
        }
      })

      it('should throw FhirValidationError for non-array entry', () => {
        const bundle = createValidFhirBundle()
        bundle.entry = 'not-an-array' as any

        expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(bundle)).toThrow('Bundle.entry must be an array')
      })

      it('should throw FhirValidationError for entry without resource', () => {
        const bundle = createValidFhirBundle()
        bundle.entry = [{ fullUrl: 'test' }] as any

        expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(bundle)).toThrow('Bundle.entry[0] must contain a resource')
      })

      it('should throw FhirValidationError for resource without resourceType', () => {
        const bundle = createValidFhirBundle()
        bundle.entry = [{ resource: { id: '123' } }] as any

        expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(bundle)).toThrow(
          'Bundle.entry[0].resource must have a resourceType'
        )
      })
    })
  })

  describe('VerifiableCredentialProcessor', () => {
    let processor: VerifiableCredentialProcessor
    let validBundle: FhirBundle

    beforeEach(() => {
      processor = new VerifiableCredentialProcessor()
      validBundle = createValidFhirBundle()
    })

    describe('create()', () => {
      it('should create a valid W3C Verifiable Credential', () => {
        const vc = processor.create(validBundle)

        expect(vc).toBeDefined()
        expect(vc.vc).toBeDefined()
        expect(vc.vc['@context']).toBeDefined()
        expect(vc.vc.type).toBeDefined()
        expect(vc.vc.credentialSubject).toBeDefined()
      })

      it('should use default FHIR version 4.0.1', () => {
        const vc = processor.create(validBundle)
        expect(vc.vc.credentialSubject.fhirVersion).toBe('4.0.1')
      })

      it('should use custom FHIR version when provided', () => {
        const options: VerifiableCredentialOptions = { fhirVersion: '4.3.0' }
        const vc = processor.create(validBundle, options)

        expect(vc.vc.credentialSubject.fhirVersion).toBe('4.3.0')
      })

      it('should include the provided FHIR Bundle', () => {
        const vc = processor.create(validBundle)
        expect(vc.vc.credentialSubject.fhirBundle).toEqual(validBundle)
      })

      it('should create correct @context array', () => {
        const vc = processor.create(validBundle)
        const context = vc.vc['@context']

        expect(Array.isArray(context)).toBe(true)
        expect(context).toHaveLength(2)
        expect(context[0]).toBe('https://www.w3.org/2018/credentials/v1')

        const smartContext = context[1] as any
        expect(smartContext['@vocab']).toBe('https://smarthealth.cards#')
        expect(smartContext.fhirBundle['@id']).toBe('https://smarthealth.cards#fhirBundle')
        expect(smartContext.fhirBundle['@type']).toBe('@json')
      })

      it('should create correct type array', () => {
        const vc = processor.create(validBundle)
        const types = vc.vc.type

        expect(Array.isArray(types)).toBe(true)
        expect(types).toHaveLength(2)
        expect(types).toContain('VerifiableCredential')
        expect(types).toContain('https://smarthealth.cards#health-card')
      })

      it('should include additional types when provided', () => {
        const options: VerifiableCredentialOptions = {
          includeAdditionalTypes: [
            'https://smarthealth.cards#covid19',
            'https://example.org/vaccination',
          ],
        }
        const vc = processor.create(validBundle, options)

        expect(vc.vc.type).toHaveLength(4)
        expect(vc.vc.type).toContain('VerifiableCredential')
        expect(vc.vc.type).toContain('https://smarthealth.cards#health-card')
        expect(vc.vc.type).toContain('https://smarthealth.cards#covid19')
        expect(vc.vc.type).toContain('https://example.org/vaccination')
      })

      it('should throw FhirValidationError for null bundle', () => {
        expect(() => processor.create(null as any)).toThrow(FhirValidationError)
        expect(() => processor.create(null as any)).toThrow('Invalid FHIR Bundle provided')
      })

      it('should throw FhirValidationError for invalid bundle', () => {
        const invalidBundle = createInvalidBundle()

        expect(() => processor.create(invalidBundle)).toThrow(FhirValidationError)
        expect(() => processor.create(invalidBundle)).toThrow('Invalid FHIR Bundle provided')
      })
    })

    describe('validate()', () => {
      let validVC: VerifiableCredential

      beforeEach(() => {
        validVC = processor.create(validBundle)
      })

      it('should validate a correct Verifiable Credential', () => {
        expect(processor.validate(validVC)).toBe(true)
      })

      it('should throw FhirValidationError for null VC', () => {
        expect(() => processor.validate(null as any)).toThrow(FhirValidationError)
        expect(() => processor.validate(null as any)).toThrow('Invalid VC: missing vc property')
      })

      it('should throw FhirValidationError for VC without vc property', () => {
        const invalidVC = {} as any

        expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidVC)).toThrow('Invalid VC: missing vc property')
      })

      describe('@context validation', () => {
        it('should throw error for non-array @context', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc['@context'] = 'not-an-array' as any

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow('VC @context must be an array')
        })

        it('should throw error for @context with less than 2 elements', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc['@context'] = ['https://www.w3.org/2018/credentials/v1']

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'VC @context must contain at least 2 elements'
          )
        })

        it('should throw error for incorrect first @context element', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc['@context'][0] = 'https://wrong-context.org'

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'First @context element must be https://www.w3.org/2018/credentials/v1'
          )
        })

        it('should throw error for non-object second @context element', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc['@context'][1] = 'not-an-object'

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'Second @context element must be SMART Health Cards context object'
          )
        })

        it('should throw error for incorrect @vocab', () => {
          const invalidVC = { ...validVC }
          const context = invalidVC.vc['@context'][1] as any
          context['@vocab'] = 'https://wrong-vocab.org'

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'SMART Health Cards context must include correct @vocab'
          )
        })

        it('should throw error for incorrect fhirBundle definition', () => {
          const invalidVC = { ...validVC }
          const context = invalidVC.vc['@context'][1] as any
          context.fhirBundle = { '@id': 'wrong-id', '@type': '@json' }

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'SMART Health Cards context must include correct fhirBundle definition'
          )
        })
      })

      describe('type validation', () => {
        it('should throw error for non-array type', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc.type = 'not-an-array' as any

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow('VC type must be an array')
        })

        it('should throw error for type with less than 2 elements', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc.type = ['VerifiableCredential']

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'VC type must contain at least 2 elements'
          )
        })

        it('should throw error for missing VerifiableCredential type', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc.type = ['SomeOtherType', 'https://smarthealth.cards#health-card']

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'VC type must include VerifiableCredential'
          )
        })

        it('should throw error for missing health-card type', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc.type = ['VerifiableCredential', 'SomeOtherType']

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'VC type must include https://smarthealth.cards#health-card'
          )
        })
      })

      describe('credentialSubject validation', () => {
        it('should throw error for missing credentialSubject', () => {
          const invalidVC = { ...validVC }
          delete (invalidVC.vc as any).credentialSubject

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow('VC credentialSubject is required')
        })

        it('should throw error for missing fhirVersion', () => {
          const invalidVC = { ...validVC }
          delete (invalidVC.vc.credentialSubject as any).fhirVersion

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'VC credentialSubject must include fhirVersion'
          )
        })

        it('should throw error for invalid fhirVersion format', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc.credentialSubject.fhirVersion = 'invalid-version'

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'VC fhirVersion must be in semantic version format (e.g., 4.0.1)'
          )
        })

        it('should accept valid semantic versions', () => {
          const validVersions = ['4.0.1', '4.3.0', '5.0.0', '10.25.99']

          for (const version of validVersions) {
            const vc = { ...validVC }
            vc.vc.credentialSubject.fhirVersion = version
            expect(processor.validate(vc)).toBe(true)
          }
        })

        it('should throw error for missing fhirBundle', () => {
          const invalidVC = { ...validVC }
          delete (invalidVC.vc.credentialSubject as any).fhirBundle

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'VC credentialSubject must include fhirBundle'
          )
        })

        it('should throw error for invalid fhirBundle', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc.credentialSubject.fhirBundle = {
            resourceType: 'Patient',
          } as any

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'VC fhirBundle must be a valid FHIR Bundle'
          )
        })
      })
    })
  })

  describe('JWSProcessor', () => {
    let processor: JWSProcessor
    let validBundle: FhirBundle
    let vcProcessor: VerifiableCredentialProcessor
    let validVC: VerifiableCredential
    let validJWTPayload: SmartHealthCardJWT

    // Test key pairs for ES256 (these are for testing only - never use in production)
    const testPrivateKeyPKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`

    const testPublicKeySPKI = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`

    beforeEach(async () => {
      processor = new JWSProcessor()
      validBundle = createValidFhirBundle()
      vcProcessor = new VerifiableCredentialProcessor()
      validVC = vcProcessor.create(validBundle)

      // Create a valid JWT payload
      const now = Math.floor(Date.now() / 1000)
      validJWTPayload = {
        iss: 'https://example.com/issuer',
        nbf: now,
        exp: now + 3600, // 1 hour from now
        vc: validVC.vc,
      }
    })

    describe('sign()', () => {
      it('should sign a valid JWT payload', async () => {
        const jws = await processor.sign(validJWTPayload, testPrivateKeyPKCS8, 'test-key-id')

        expect(jws).toBeDefined()
        expect(typeof jws).toBe('string')

        // JWS should have 3 parts separated by dots
        const parts = jws.split('.')
        expect(parts).toHaveLength(3)

        // Decode to verify structure (without verification)
        const decoded = await processor.decode(jws)
        expect(decoded.header.alg).toBe('ES256')
        expect(decoded.header.kid).toBe('test-key-id')
        expect(decoded.header.typ).toBe('JWT')
        expect(decoded.payload.iss).toBe(validJWTPayload.iss)
        expect(decoded.payload.nbf).toBe(validJWTPayload.nbf)
      })

      it('should throw JWSError for invalid payload', async () => {
        const invalidPayload = {
          // Missing required 'iss' field
          nbf: Math.floor(Date.now() / 1000),
          vc: validVC.vc,
        } as any

        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow(JWSError)
      })

      it('should throw JWSError for null payload', async () => {
        await expect(
          processor.sign(null as any, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow(JWSError)
        await expect(
          processor.sign(null as any, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow('Invalid JWT payload: must be an object')
      })

      it('should throw JWSError for missing issuer', async () => {
        const invalidPayload = { ...validJWTPayload }
        delete (invalidPayload as any).iss

        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow(JWSError)
        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow("'iss' (issuer) is required")
      })

      it('should throw JWSError for missing nbf', async () => {
        const invalidPayload = { ...validJWTPayload }
        delete (invalidPayload as any).nbf

        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow(JWSError)
        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow("'nbf' (not before) is required")
      })

      it('should throw JWSError for invalid exp vs nbf', async () => {
        const invalidPayload = { ...validJWTPayload }
        invalidPayload.exp = invalidPayload.nbf - 1000 // exp before nbf

        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow(JWSError)
        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow("'exp' must be greater than 'nbf'")
      })

      it('should work without exp field', async () => {
        const payloadWithoutExp = { ...validJWTPayload }
        delete payloadWithoutExp.exp

        const jws = await processor.sign(payloadWithoutExp, testPrivateKeyPKCS8, 'test-key-id')
        expect(jws).toBeDefined()

        const decoded = await processor.decode(jws)
        expect(decoded.payload.exp).toBeUndefined()
      })
    })

    describe('verify()', () => {
      it('should verify a valid JWS', async () => {
        const jws = await processor.sign(validJWTPayload, testPrivateKeyPKCS8, 'test-key-id')
        const verifiedPayload = await processor.verify(jws, testPublicKeySPKI)

        expect(verifiedPayload).toBeDefined()
        expect(verifiedPayload.iss).toBe(validJWTPayload.iss)
        expect(verifiedPayload.nbf).toBe(validJWTPayload.nbf)
        expect(verifiedPayload.exp).toBe(validJWTPayload.exp)
        expect(verifiedPayload.vc).toEqual(validJWTPayload.vc)
      })

      it('should throw JWSError for invalid JWS format', async () => {
        await expect(processor.verify('invalid.jws', testPublicKeySPKI)).rejects.toThrow(JWSError)
        await expect(processor.verify('invalid.jws', testPublicKeySPKI)).rejects.toThrow(
          'Invalid JWS format: must have 3 parts'
        )
      })

      it('should throw JWSError for empty JWS', async () => {
        await expect(processor.verify('', testPublicKeySPKI)).rejects.toThrow(JWSError)
        await expect(processor.verify('', testPublicKeySPKI)).rejects.toThrow(
          'Invalid JWS: must be a non-empty string'
        )
      })

      it('should throw JWSError for non-string JWS', async () => {
        await expect(processor.verify(null as any, testPublicKeySPKI)).rejects.toThrow(JWSError)
        await expect(processor.verify(123 as any, testPublicKeySPKI)).rejects.toThrow(JWSError)
      })

      it('should throw JWSError for wrong signature', async () => {
        const jws = await processor.sign(validJWTPayload, testPrivateKeyPKCS8, 'test-key-id')
        // Try to verify with wrong public key (using the private key string, which will fail)
        await expect(processor.verify(jws, 'wrong-public-key')).rejects.toThrow(JWSError)
      })
    })

    describe('decode()', () => {
      it('should decode JWS without verification', async () => {
        const jws = await processor.sign(validJWTPayload, testPrivateKeyPKCS8, 'test-key-id')
        const decoded = await processor.decode(jws)

        expect(decoded).toBeDefined()
        expect(decoded.header).toBeDefined()
        expect(decoded.payload).toBeDefined()

        expect(decoded.header.alg).toBe('ES256')
        expect(decoded.header.kid).toBe('test-key-id')
        expect(decoded.header.typ).toBe('JWT')

        expect(decoded.payload.iss).toBe(validJWTPayload.iss)
        expect(decoded.payload.nbf).toBe(validJWTPayload.nbf)
        expect(decoded.payload.exp).toBe(validJWTPayload.exp)
        expect(decoded.payload.vc).toEqual(validJWTPayload.vc)
      })

      it('should throw JWSError for invalid JWS format', async () => {
        await expect(processor.decode('invalid.jws')).rejects.toThrow(JWSError)
        await expect(processor.decode('invalid.jws')).rejects.toThrow(
          'Invalid JWS format: must have 3 parts'
        )
      })

      it('should throw JWSError for empty JWS', async () => {
        await expect(processor.decode('')).rejects.toThrow(JWSError)
        await expect(processor.decode('')).rejects.toThrow(
          'Invalid JWS: must be a non-empty string'
        )
      })
    })

    describe('validateJWTPayload() private method validation', () => {
      it('should validate payload structure through sign method', async () => {
        // Test various invalid payloads
        const testCases = [
          {
            payload: { iss: 123, nbf: Date.now(), vc: validVC.vc }, // invalid iss type
            error: "'iss' (issuer) is required and must be a string",
          },
          {
            payload: { iss: 'test', nbf: 'invalid', vc: validVC.vc }, // invalid nbf type
            error: "'nbf' (not before) is required and must be a number",
          },
          {
            payload: {
              iss: 'test',
              nbf: Date.now(),
              exp: 'invalid',
              vc: validVC.vc,
            }, // invalid exp type
            error: "'exp' (expiration) must be a number if provided",
          },
          {
            payload: { iss: 'test', nbf: Date.now() }, // missing vc
            error: "'vc' (verifiable credential) is required and must be an object",
          },
        ]

        for (const testCase of testCases) {
          await expect(
            processor.sign(testCase.payload as any, testPrivateKeyPKCS8, 'test-key-id')
          ).rejects.toThrow(JWSError)
          await expect(
            processor.sign(testCase.payload as any, testPrivateKeyPKCS8, 'test-key-id')
          ).rejects.toThrow(testCase.error)
        }
      })
    })
  })

  describe('SmartHealthCard', () => {
    let smartHealthCard: SmartHealthCard
    let validBundle: FhirBundle
    let config: SmartHealthCardConfig

    // Test key pairs for ES256 (these are for testing only - never use in production)
    const testPrivateKeyPKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`

    const testPublicKeySPKI = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`

    beforeEach(() => {
      validBundle = createValidFhirBundle()
      config = {
        issuer: 'https://example.com/issuer',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
        keyId: 'test-key-id',
      }
      smartHealthCard = new SmartHealthCard(config)
    })

    describe('create()', () => {
      it('should create a complete SMART Health Card from FHIR Bundle', async () => {
        const healthCard = await smartHealthCard.create(validBundle)

        expect(healthCard).toBeDefined()
        expect(typeof healthCard).toBe('string')

        // Should be a valid JWS format (3 parts separated by dots)
        const parts = healthCard.split('.')
        expect(parts).toHaveLength(3)
      })

      it('should create health card with expiration when configured', async () => {
        const configWithExpiration: SmartHealthCardConfig = {
          ...config,
          expirationTime: 3600, // 1 hour
        }
        const cardWithExpiration = new SmartHealthCard(configWithExpiration)

        const healthCard = await cardWithExpiration.create(validBundle)
        expect(healthCard).toBeDefined()

        // Decode to check expiration is set
        const jwsProcessor = new JWSProcessor()
        const decoded = await jwsProcessor.decode(healthCard)
        expect(decoded.payload.exp).toBeDefined()
        expect(decoded.payload.exp).toBeGreaterThan(decoded.payload.nbf)
      })

      it('should throw error for invalid FHIR Bundle', async () => {
        const invalidBundle = createInvalidBundle()

        await expect(smartHealthCard.create(invalidBundle)).rejects.toThrow(FhirValidationError)
        await expect(smartHealthCard.create(invalidBundle)).rejects.toThrow(
          'Invalid bundle: must be a FHIR Bundle resource'
        )
      })

      it('should throw error for null bundle', async () => {
        await expect(smartHealthCard.create(null as any)).rejects.toThrow(SmartHealthCardError)
      })

      it('should include correct issuer in JWT payload', async () => {
        const healthCard = await smartHealthCard.create(validBundle)

        const jwsProcessor = new JWSProcessor()
        const decoded = await jwsProcessor.decode(healthCard)
        expect(decoded.payload.iss).toBe(config.issuer)
        expect(decoded.payload.nbf).toBeDefined()
        expect(decoded.payload.vc).toBeDefined()
      })

      it('should create verifiable credential with correct structure', async () => {
        const healthCard = await smartHealthCard.create(validBundle)

        const jwsProcessor = new JWSProcessor()
        const decoded = await jwsProcessor.decode(healthCard)

        // Check VC structure
        expect(decoded.payload.vc['@context']).toBeDefined()
        expect(decoded.payload.vc.type).toContain('VerifiableCredential')
        expect(decoded.payload.vc.type).toContain('https://smarthealth.cards#health-card')
        expect(decoded.payload.vc.credentialSubject).toBeDefined()
        expect(decoded.payload.vc.credentialSubject.fhirBundle).toEqual(validBundle)
      })
    })

    describe('verify()', () => {
      it('should verify a valid SMART Health Card', async () => {
        const healthCard = await smartHealthCard.create(validBundle)
        const verifiedVC = await smartHealthCard.verify(healthCard)

        expect(verifiedVC).toBeDefined()
        expect(verifiedVC.vc).toBeDefined()
        expect(verifiedVC.vc.credentialSubject.fhirBundle).toEqual(validBundle)
      })

      it('should throw error when no public key is configured', async () => {
        const configWithoutPublicKey: SmartHealthCardConfig = {
          ...config,
          publicKey: undefined,
        }
        const cardWithoutPublicKey = new SmartHealthCard(configWithoutPublicKey)

        const healthCard = await smartHealthCard.create(validBundle)

        await expect(cardWithoutPublicKey.verify(healthCard)).rejects.toThrow(SmartHealthCardError)
        await expect(cardWithoutPublicKey.verify(healthCard)).rejects.toThrow(
          'Public key required for verification'
        )
      })

      it('should throw error for invalid JWS', async () => {
        await expect(smartHealthCard.verify('invalid.jws.signature')).rejects.toThrow(JWSError)
        await expect(smartHealthCard.verify('invalid.jws.signature')).rejects.toThrow(
          'JWS verification failed'
        )
      })

      it('should throw error for tampered health card', async () => {
        const healthCard = await smartHealthCard.create(validBundle)

        // Tamper with the health card by changing a character
        const tamperedCard = healthCard.slice(0, -5) + 'XXXXX'

        await expect(smartHealthCard.verify(tamperedCard)).rejects.toThrow(SmartHealthCardError)
      })

      it('should validate round-trip: create then verify', async () => {
        const healthCard = await smartHealthCard.create(validBundle)
        const verifiedVC = await smartHealthCard.verify(healthCard)

        // The verified VC should match the original bundle
        expect(verifiedVC.vc.credentialSubject.fhirBundle).toEqual(validBundle)
        expect(verifiedVC.vc.credentialSubject.fhirVersion).toBe('4.0.1')
      })
    })

    describe('file operations', () => {
      it('should create SMART Health Card file content', async () => {
        const fileContent = await smartHealthCard.createFile(validBundle)

        expect(fileContent).toBeDefined()
        expect(typeof fileContent).toBe('string')

        // Should be a valid JWS format
        const parts = fileContent.split('.')
        expect(parts).toHaveLength(3)
      })

      it('should create downloadable file blob', async () => {
        const blob = await smartHealthCard.createFileBlob(validBundle)

        expect(blob).toBeInstanceOf(Blob)
        expect(blob.type).toBe('application/smart-health-card')
        expect(blob.size).toBeGreaterThan(0)
      })

      it('should verify SMART Health Card from file content string', async () => {
        const fileContent = await smartHealthCard.createFile(validBundle)
        const verifiedVC = await smartHealthCard.verifyFile(fileContent)

        expect(verifiedVC).toBeDefined()
        expect(verifiedVC.vc.credentialSubject.fhirBundle).toEqual(validBundle)
      })

      it('should verify SMART Health Card from Blob', async () => {
        const blob = await smartHealthCard.createFileBlob(validBundle)
        const verifiedVC = await smartHealthCard.verifyFile(blob)

        expect(verifiedVC).toBeDefined()
        expect(verifiedVC.vc.credentialSubject.fhirBundle).toEqual(validBundle)
      })

      it('should handle round-trip file operations', async () => {
        // Create file
        const blob = await smartHealthCard.createFileBlob(validBundle)

        // Verify file
        const verifiedVC = await smartHealthCard.verifyFile(blob)

        // Data should match original
        expect(verifiedVC.vc.credentialSubject.fhirBundle).toEqual(validBundle)
      })

      it('should throw error for invalid file content', async () => {
        await expect(smartHealthCard.verifyFile('invalid-content')).rejects.toThrow(JWSError)
        await expect(smartHealthCard.verifyFile('invalid-content')).rejects.toThrow(
          'Invalid JWS format'
        )
      })

      it('should throw error for invalid Blob content', async () => {
        const invalidBlob = new Blob(['invalid-jws-content'], {
          type: 'application/smart-health-card',
        })

        await expect(smartHealthCard.verifyFile(invalidBlob)).rejects.toThrow(SmartHealthCardError)
      })
    })

    describe('end-to-end workflow', () => {
      it('should handle complete SMART Health Card workflow', async () => {
        // Step 1: Create health card from FHIR bundle
        const healthCard = await smartHealthCard.create(validBundle)
        expect(healthCard).toBeDefined()

        // Step 2: Verify the health card
        const verifiedVC = await smartHealthCard.verify(healthCard)
        expect(verifiedVC).toBeDefined()

        // Step 3: Verify the data integrity
        expect(verifiedVC.vc.credentialSubject.fhirBundle).toEqual(validBundle)

        // Step 4: Verify it's a proper SMART Health Card structure
        expect(verifiedVC.vc.type).toContain('VerifiableCredential')
        expect(verifiedVC.vc.type).toContain('https://smarthealth.cards#health-card')
        expect(verifiedVC.vc['@context'][0]).toBe('https://www.w3.org/2018/credentials/v1')
      })

      it('should handle complete file-based workflow', async () => {
        // Step 1: Create health card file blob
        const blob = await smartHealthCard.createFileBlob(validBundle)
        expect(blob).toBeInstanceOf(Blob)
        expect(blob.type).toBe('application/smart-health-card')

        // Step 2: Verify the file
        const verifiedVC = await smartHealthCard.verifyFile(blob)
        expect(verifiedVC).toBeDefined()

        // Step 3: Verify data integrity
        expect(verifiedVC.vc.credentialSubject.fhirBundle).toEqual(validBundle)
      })
    })
  })

  describe('Error Classes', () => {
    describe('SmartHealthCardError', () => {
      it('should create error with message and code', () => {
        const error = new SmartHealthCardError('Test error', 'TEST_CODE')

        expect(error).toBeInstanceOf(Error)
        expect(error.name).toBe('SmartHealthCardError')
        expect(error.message).toBe('Test error')
        expect(error.code).toBe('TEST_CODE')
      })
    })

    describe('FhirValidationError', () => {
      it('should create FHIR validation error', () => {
        const error = new FhirValidationError('FHIR validation failed')

        expect(error).toBeInstanceOf(SmartHealthCardError)
        expect(error.name).toBe('FhirValidationError')
        expect(error.message).toBe('FHIR validation failed')
        expect(error.code).toBe('FHIR_VALIDATION_ERROR')
      })
    })

    describe('JWSError', () => {
      it('should create JWS error', () => {
        const error = new JWSError('JWS processing failed')

        expect(error).toBeInstanceOf(SmartHealthCardError)
        expect(error.name).toBe('JWSError')
        expect(error.message).toBe('JWS processing failed')
        expect(error.code).toBe('JWS_ERROR')
      })
    })
  })
})
