// biome-ignore-all lint/suspicious/noExplicitAny: The test needs to use `any` to check validation errors

import type { Bundle, Immunization, Patient } from '@medplum/fhirtypes'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type FhirBundle,
  FhirBundleProcessor,
  FhirValidationError,
  JWSError,
  JWSProcessor,
  QRCodeError,
  QRCodeGenerator,
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

const createInvalidBundle = (): Bundle => ({
  resourceType: 'Patient' as any, // Wrong resource type
  id: '123',
  type: 'collection',
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
        delete (bundle as unknown as Record<string, unknown>).type

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
        expect(() => processor.process(null as unknown as Bundle)).toThrow(FhirValidationError)
        expect(() => processor.process(null as unknown as Bundle)).toThrow(
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
        expect(() => processor.validate(null as unknown as Bundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(null as unknown as Bundle)).toThrow(
          'Bundle cannot be null or undefined'
        )
      })

      it('should throw FhirValidationError for wrong resource type', () => {
        const invalidBundle = createInvalidBundle()

        expect(() => processor.validate(invalidBundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidBundle)).toThrow('Resource must be of type Bundle')
      })

      it('should throw FhirValidationError for invalid Bundle.type', () => {
        const bundle = createValidFhirBundle()
        ;(bundle as any).type = 'invalid-type'

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
          bundle.type = type as any // @ts-ignore
          expect(processor.validate(bundle)).toBe(true)
        }
      })

      it('should throw FhirValidationError for non-array entry', () => {
        const bundle = createValidFhirBundle()
        bundle.entry = 'not-an-array' as any // @ts-ignore

        expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(bundle)).toThrow('Bundle.entry must be an array')
      })

      it('should throw FhirValidationError for entry without resource', () => {
        const bundle = createValidFhirBundle()
        bundle.entry = [{ fullUrl: 'test' }] as any // @ts-ignore

        expect(() => processor.validate(bundle)).toThrow(FhirValidationError)
        expect(() => processor.validate(bundle)).toThrow('Bundle.entry[0] must contain a resource')
      })

      it('should throw FhirValidationError for resource without resourceType', () => {
        const bundle = createValidFhirBundle()
        bundle.entry = [{ resource: { id: '123' } }] as any // @ts-ignore

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

        const smartContext = context[1] as Record<string, any>
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
        expect(() => processor.create(null as unknown as Bundle)).toThrow(FhirValidationError)
        expect(() => processor.create(null as unknown as Bundle)).toThrow(
          'Invalid FHIR Bundle provided'
        )
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
        expect(() => processor.validate(null as unknown as VerifiableCredential)).toThrow(
          FhirValidationError
        )
        expect(() => processor.validate(null as unknown as VerifiableCredential)).toThrow(
          'Invalid VC: missing vc property'
        )
      })

      it('should throw FhirValidationError for VC without vc property', () => {
        const invalidVC = {} as VerifiableCredential

        expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
        expect(() => processor.validate(invalidVC)).toThrow('Invalid VC: missing vc property')
      })

      describe('@context validation', () => {
        it('should throw error for non-array @context', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc['@context'] = 'not-an-array' as any // @ts-ignore

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
          const context = invalidVC.vc['@context'][1] as any // @ts-ignore
          context['@vocab'] = 'https://wrong-vocab.org'

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'SMART Health Cards context must include correct @vocab'
          )
        })

        it('should throw error for incorrect fhirBundle definition', () => {
          const invalidVC = { ...validVC }
          const context = invalidVC.vc['@context'][1] as any // @ts-ignore
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
          invalidVC.vc.type = 'not-an-array' as any // @ts-ignore

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
          delete (invalidVC.vc as Record<string, unknown>).credentialSubject

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow('VC credentialSubject is required')
        })

        it('should throw error for missing fhirVersion', () => {
          const invalidVC = { ...validVC }
          delete (invalidVC.vc.credentialSubject as Record<string, unknown>).fhirVersion

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
          delete (invalidVC.vc.credentialSubject as Record<string, unknown>).fhirBundle

          expect(() => processor.validate(invalidVC)).toThrow(FhirValidationError)
          expect(() => processor.validate(invalidVC)).toThrow(
            'VC credentialSubject must include fhirBundle'
          )
        })

        it('should throw error for invalid fhirBundle', () => {
          const invalidVC = { ...validVC }
          invalidVC.vc.credentialSubject.fhirBundle = {
            resourceType: 'Patient',
          } as any // @ts-ignore

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
        } as any // @ts-ignore

        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow(JWSError)
      })

      it('should throw JWSError for null payload', async () => {
        await expect(
          processor.sign(null as unknown as SmartHealthCardJWT, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow(JWSError)
        await expect(
          processor.sign(null as unknown as SmartHealthCardJWT, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow('Invalid JWT payload: must be an object')
      })

      it('should throw JWSError for missing issuer', async () => {
        const invalidPayload = { ...validJWTPayload }
        delete (invalidPayload as Record<string, unknown>).iss

        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow(JWSError)
        await expect(
          processor.sign(invalidPayload, testPrivateKeyPKCS8, 'test-key-id')
        ).rejects.toThrow("'iss' (issuer) is required")
      })

      it('should throw JWSError for missing nbf', async () => {
        const invalidPayload = { ...validJWTPayload }
        delete (invalidPayload as Record<string, unknown>).nbf

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
        await expect(
          processor.verify(null as unknown as string, testPublicKeySPKI)
        ).rejects.toThrow(JWSError)
        await expect(processor.verify(123 as unknown as string, testPublicKeySPKI)).rejects.toThrow(
          JWSError
        )
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
            processor.sign(
              testCase.payload as any, // @ts-ignore
              testPrivateKeyPKCS8,
              'test-key-id'
            )
          ).rejects.toThrow(JWSError)
          await expect(
            processor.sign(
              testCase.payload as any, // @ts-ignore
              testPrivateKeyPKCS8,
              'test-key-id'
            )
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
        await expect(smartHealthCard.create(null as unknown as Bundle)).rejects.toThrow(
          SmartHealthCardError
        )
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
        const tamperedCard = `${healthCard.slice(0, -5)}XXXXX`

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
        await expect(smartHealthCard.verifyFile('invalid-content')).rejects.toThrow(
          SmartHealthCardError
        )
        await expect(smartHealthCard.verifyFile('invalid-content')).rejects.toThrow(
          'Invalid file format - expected JSON with verifiableCredential array'
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

  describe('QRCodeGenerator', () => {
    let qrGenerator: QRCodeGenerator
    let validJWS: string

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
      qrGenerator = new QRCodeGenerator()

      // Create a valid JWS for testing
      const smartHealthCard = new SmartHealthCard({
        issuer: 'https://example.com/issuer',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
        keyId: 'test-key-id',
      })

      const validBundle = createValidFhirBundle()
      validJWS = await smartHealthCard.create(validBundle)
    })

    describe('generateQR()', () => {
      it('should generate a single QR code data URL', async () => {
        const qrDataUrls = await qrGenerator.generateQR(validJWS)

        expect(qrDataUrls).toBeDefined()
        expect(Array.isArray(qrDataUrls)).toBe(true)
        expect(qrDataUrls).toHaveLength(1)
        expect(qrDataUrls[0]).toMatch(/^data:image\/png;base64,/)
      })

      it('should generate chunked QR codes when enabled and JWS is large', async () => {
        const chunkedGenerator = new QRCodeGenerator({
          enableChunking: true,
          maxSingleQRSize: 100, // Very small size to force chunking
        })

        const qrDataUrls = await chunkedGenerator.generateQR(validJWS)

        expect(qrDataUrls).toBeDefined()
        expect(Array.isArray(qrDataUrls)).toBe(true)
        expect(qrDataUrls.length).toBeGreaterThan(1)

        // All should be valid data URLs
        for (const dataUrl of qrDataUrls) {
          expect(dataUrl).toMatch(/^data:image\/png;base64,/)
        }
      })

      it('should throw QRCodeError for invalid JWS characters', async () => {
        const invalidJWS = 'invalid-jws-with-unicode-€'

        await expect(qrGenerator.generateQR(invalidJWS)).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.generateQR(invalidJWS)).rejects.toThrow('Invalid character')
      })

      it('should use default configuration values', () => {
        const defaultGenerator = new QRCodeGenerator()

        expect(defaultGenerator.config.errorCorrectionLevel).toBe('L')
        expect(defaultGenerator.config.maxSingleQRSize).toBe(1195)
        expect(defaultGenerator.config.enableChunking).toBe(false)
      })

      it('should respect custom configuration values', () => {
        const customGenerator = new QRCodeGenerator({
          errorCorrectionLevel: 'H',
          maxSingleQRSize: 2000,
          enableChunking: true,
        })

        expect(customGenerator.config.errorCorrectionLevel).toBe('H')
        expect(customGenerator.config.maxSingleQRSize).toBe(2000)
        expect(customGenerator.config.enableChunking).toBe(true)
      })
    })

    describe('scanQR()', () => {
      it('should decode a single QR code back to original JWS', async () => {
        // First generate QR code
        const qrDataUrls = await qrGenerator.generateQR(validJWS)
        expect(qrDataUrls).toHaveLength(1) // Ensure QR was generated

        // Extract the numeric data from the QR code content manually
        // Since we can't actually scan an image in tests, we'll simulate the process
        const numericData = qrGenerator.encodeJWSToNumeric(validJWS)
        const qrContent = `shc:/${numericData}`

        // Decode back to JWS
        const decodedJWS = await qrGenerator.scanQR([qrContent])

        expect(decodedJWS).toBe(validJWS)
      })

      it('should decode chunked QR codes back to original JWS', async () => {
        const chunkedGenerator = new QRCodeGenerator({
          enableChunking: true,
          maxSingleQRSize: 100, // Force chunking
        })

        // Simulate chunked QR content
        const numericData = chunkedGenerator.encodeJWSToNumeric(validJWS)
        const chunkSize = 80 // Smaller than maxSingleQRSize minus header
        const chunks: string[] = []

        for (let i = 0; i < numericData.length; i += chunkSize) {
          chunks.push(numericData.substring(i, i + chunkSize))
        }

        const qrContents = chunks.map(
          (chunk, index) => `shc:/${index + 1}/${chunks.length}/${chunk}`
        )

        const decodedJWS = await qrGenerator.scanQR(qrContents)
        expect(decodedJWS).toBe(validJWS)
      })

      it('should throw QRCodeError for empty QR data', async () => {
        await expect(qrGenerator.scanQR([])).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR([])).rejects.toThrow('No QR code data provided')
      })

      it('should throw QRCodeError for invalid QR format', async () => {
        await expect(qrGenerator.scanQR(['invalid-qr-data'])).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR(['invalid-qr-data'])).rejects.toThrow(
          "Invalid QR code format. Expected 'shc:/' prefix"
        )
      })

      it('should throw QRCodeError for invalid chunked format', async () => {
        const invalidChunked = ['shc:/1/2', 'shc:/2/2/data'] // Missing data in first chunk

        await expect(qrGenerator.scanQR(invalidChunked)).rejects.toThrow(QRCodeError)
      })

      it('should throw QRCodeError for missing chunks', async () => {
        const incompleteChunks = [
          'shc:/1/3/123456',
          'shc:/3/3/789012', // Missing chunk 2
        ]

        await expect(qrGenerator.scanQR(incompleteChunks)).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR(incompleteChunks)).rejects.toThrow(
          'Missing chunks. Expected 3, got 2'
        )
      })

      it('should throw QRCodeError for inconsistent chunk totals', async () => {
        const inconsistentChunks = [
          'shc:/1/2/123456',
          'shc:/2/3/789012', // Different total count
        ]

        await expect(qrGenerator.scanQR(inconsistentChunks)).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR(inconsistentChunks)).rejects.toThrow(
          'Inconsistent total chunk count'
        )
      })

      it('should throw QRCodeError for invalid numeric data', async () => {
        const invalidNumeric = 'shc:/12345' // Odd length

        await expect(qrGenerator.scanQR([invalidNumeric])).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR([invalidNumeric])).rejects.toThrow(
          'Invalid numeric data: must have even length'
        )
      })

      it('should throw QRCodeError for out-of-range digit pairs', async () => {
        const outOfRange = 'shc:/9999' // 99 > 77 (max value for 'z')

        await expect(qrGenerator.scanQR([outOfRange])).rejects.toThrow(QRCodeError)
        await expect(qrGenerator.scanQR([outOfRange])).rejects.toThrow(
          "Invalid digit pair '99': value 99 exceeds maximum 77"
        )
      })
    })

    describe('numeric encoding/decoding', () => {
      it('should correctly encode and decode all valid base64url characters', () => {
        const base64urlChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_='

        const encoded = qrGenerator.encodeJWSToNumeric(base64urlChars)
        const decoded = qrGenerator.decodeNumericToJWS(encoded)

        expect(decoded).toBe(base64urlChars)
      })

      it('should produce expected numeric values for known characters', () => {
        // Test specific character mappings
        const testCases = [
          { char: '-', expected: '00' }, // ASCII 45 - 45 = 0
          { char: 'A', expected: '20' }, // ASCII 65 - 45 = 20
          { char: 'a', expected: '52' }, // ASCII 97 - 45 = 52
          { char: 'z', expected: '77' }, // ASCII 122 - 45 = 77
          { char: '0', expected: '03' }, // ASCII 48 - 45 = 3
          { char: '9', expected: '12' }, // ASCII 57 - 45 = 12
        ]

        for (const testCase of testCases) {
          const encoded = qrGenerator.encodeJWSToNumeric(testCase.char)
          expect(encoded).toBe(testCase.expected)
        }
      })

      it('should handle round-trip encoding correctly', () => {
        // Use part of a real JWS header
        const jwtHeader = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9'

        const encoded = qrGenerator.encodeJWSToNumeric(jwtHeader)
        const decoded = qrGenerator.decodeNumericToJWS(encoded)

        expect(decoded).toBe(jwtHeader)
      })
    })

    describe('end-to-end QR workflow', () => {
      it('should handle complete QR generation and scanning workflow', async () => {
        // Generate QR codes
        const qrDataUrls = await qrGenerator.generateQR(validJWS)
        expect(qrDataUrls).toHaveLength(1)

        // Simulate scanning process (extract content from QR)
        const numericData = qrGenerator.encodeJWSToNumeric(validJWS)
        const qrContent = `shc:/${numericData}`

        // Scan and decode
        const scannedJWS = await qrGenerator.scanQR([qrContent])

        // Should match original
        expect(scannedJWS).toBe(validJWS)

        // Should be verifiable
        const smartHealthCard = new SmartHealthCard({
          issuer: 'https://example.com/issuer',
          privateKey: testPrivateKeyPKCS8,
          publicKey: testPublicKeySPKI,
          keyId: 'test-key-id',
        })

        const verifiedVC = await smartHealthCard.verify(scannedJWS)
        expect(verifiedVC).toBeDefined()
        expect(verifiedVC.vc.credentialSubject.fhirBundle).toEqual(createValidFhirBundle())
      })

      it('should handle chunked QR workflow', async () => {
        const chunkedGenerator = new QRCodeGenerator({
          enableChunking: true,
          maxSingleQRSize: 100,
        })

        // Generate chunked QR codes
        const qrDataUrls = await chunkedGenerator.generateQR(validJWS)
        expect(qrDataUrls.length).toBeGreaterThan(1)

        // Simulate chunked scanning
        const numericData = chunkedGenerator.encodeJWSToNumeric(validJWS)
        const chunkSize = 80
        const chunks: string[] = []

        for (let i = 0; i < numericData.length; i += chunkSize) {
          chunks.push(numericData.substring(i, i + chunkSize))
        }

        const qrContents = chunks.map(
          (chunk, index) => `shc:/${index + 1}/${chunks.length}/${chunk}`
        )

        // Scan and decode
        const scannedJWS = await chunkedGenerator.scanQR(qrContents)
        expect(scannedJWS).toBe(validJWS)
      })
    })
  })

  describe('Compression Features', () => {
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
        enableCompression: true, // Enable compression for these tests
      }
      smartHealthCard = new SmartHealthCard(config)
    })

    it('should create compressed SMART Health Card', async () => {
      const healthCard = await smartHealthCard.create(validBundle)

      expect(healthCard).toBeDefined()
      expect(typeof healthCard).toBe('string')

      // Should be a valid JWS format (3 parts separated by dots)
      const parts = healthCard.split('.')
      expect(parts).toHaveLength(3)

      // Decode header to check for compression
      const jwsProcessor = new JWSProcessor()
      const decoded = await jwsProcessor.decode(healthCard)
      expect(decoded.header.zip).toBe('DEF')
    })

    it('should verify compressed SMART Health Card', async () => {
      const healthCard = await smartHealthCard.create(validBundle)
      const verifiedVC = await smartHealthCard.verify(healthCard)

      expect(verifiedVC).toBeDefined()
      expect(verifiedVC.vc.credentialSubject.fhirBundle).toEqual(validBundle)
    })

    it('should handle round-trip compression and decompression', async () => {
      const healthCard = await smartHealthCard.create(validBundle)
      const verifiedVC = await smartHealthCard.verify(healthCard)

      // Data should match original
      expect(verifiedVC.vc.credentialSubject.fhirBundle).toEqual(validBundle)
    })
  })

  describe('File Format Features', () => {
    let smartHealthCard: SmartHealthCard
    let validBundle: FhirBundle

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
      const config: SmartHealthCardConfig = {
        issuer: 'https://example.com/issuer',
        privateKey: testPrivateKeyPKCS8,
        publicKey: testPublicKeySPKI,
        keyId: 'test-key-id',
      }
      smartHealthCard = new SmartHealthCard(config)
    })

    it('should create file with JSON wrapper format', async () => {
      const fileContent = await smartHealthCard.createFile(validBundle)

      expect(fileContent).toBeDefined()
      expect(typeof fileContent).toBe('string')

      // Should be valid JSON
      const parsed = JSON.parse(fileContent)
      expect(parsed).toHaveProperty('verifiableCredential')
      expect(Array.isArray(parsed.verifiableCredential)).toBe(true)
      expect(parsed.verifiableCredential).toHaveLength(1)

      // The JWS should be valid
      const jws = parsed.verifiableCredential[0]
      expect(typeof jws).toBe('string')
      expect(jws.split('.')).toHaveLength(3)
    })

    it('should verify file with JSON wrapper format', async () => {
      const fileContent = await smartHealthCard.createFile(validBundle)
      const verifiedVC = await smartHealthCard.verifyFile(fileContent)

      expect(verifiedVC).toBeDefined()
      expect(verifiedVC.vc.credentialSubject.fhirBundle).toEqual(validBundle)
    })

    it('should throw error for empty verifiableCredential array', async () => {
      const invalidFileContent = JSON.stringify({
        verifiableCredential: [],
      })

      await expect(smartHealthCard.verifyFile(invalidFileContent)).rejects.toThrow(
        'File contains empty verifiableCredential array'
      )
    })

    it('should throw error for missing verifiableCredential property', async () => {
      const invalidFileContent = JSON.stringify({
        somethingElse: ['jws'],
      })

      await expect(smartHealthCard.verifyFile(invalidFileContent)).rejects.toThrow(
        'File does not contain expected verifiableCredential array'
      )
    })
  })

  describe('QR Optimization Features', () => {
    let fhirProcessor: FhirBundleProcessor
    let validBundle: FhirBundle

    beforeEach(() => {
      fhirProcessor = new FhirBundleProcessor()
      validBundle = createValidFhirBundle()
    })

    describe('SMART Health Cards QR optimization requirements', () => {
      let optimizedBundle: FhirBundle

      beforeEach(() => {
        // Create a bundle with all the elements that should be removed
        const bundleWithAllElements: Bundle = {
          resourceType: 'Bundle',
          type: 'collection',
          entry: [
            {
              fullUrl: 'Patient/123',
              resource: {
                resourceType: 'Patient',
                id: '123',
                meta: {
                  versionId: '1',
                  lastUpdated: '2023-01-01T00:00:00Z',
                  security: [{ system: 'test', code: 'test' }],
                },
                text: {
                  status: 'generated',
                  div: '<div>Patient narrative</div>',
                },
                name: [
                  {
                    text: 'Display Name',
                    family: 'Doe',
                    given: ['John'],
                  },
                ],
                identifier: [
                  {
                    system: 'test',
                    value: '123',
                    type: {
                      coding: [
                        {
                          system: 'test',
                          code: 'test',
                          display: 'Test Display',
                        },
                      ],
                      text: 'Type Text',
                    },
                  },
                ],
              } as Patient,
            },
            {
              fullUrl: 'Immunization/456',
              resource: {
                resourceType: 'Immunization',
                id: '456',
                meta: {
                  security: [{ system: 'test', code: 'secure' }],
                },
                status: 'completed',
                vaccineCode: {
                  coding: [
                    {
                      system: 'http://hl7.org/fhir/sid/cvx',
                      code: '207',
                      display: 'COVID-19 vaccine',
                    },
                  ],
                  text: 'Vaccine Text',
                },
                patient: { reference: 'Patient/123' },
              } as Immunization,
            },
          ],
        }

        optimizedBundle = fhirProcessor.processForQR(bundleWithAllElements)
      })

      it('should remove Resource.id elements', () => {
        optimizedBundle.entry?.forEach(entry => {
          expect(entry.resource).not.toHaveProperty('id')
        })
      })

      it('should remove Resource.meta elements except meta.security', () => {
        optimizedBundle.entry?.forEach(entry => {
          const resource = entry.resource as { meta?: { security?: unknown[] } }
          if (resource.meta) {
            // Should only have security field if meta exists
            expect(Object.keys(resource.meta)).toEqual(['security'])
          }
        })
      })

      it('should remove DomainResource.text elements', () => {
        optimizedBundle.entry?.forEach(entry => {
          expect(entry.resource).not.toHaveProperty('text')
        })
      })

      it('should remove CodeableConcept.text elements', () => {
        // Check vaccineCode.text
        const immunization = optimizedBundle.entry?.find(
          e => e.resource?.resourceType === 'Immunization'
        )?.resource as Immunization
        expect(immunization?.vaccineCode).not.toHaveProperty('text')

        // Check identifier.type.text
        const patient = optimizedBundle.entry?.find(e => e.resource?.resourceType === 'Patient')
          ?.resource as Patient
        expect(patient?.identifier?.[0]?.type).not.toHaveProperty('text')
      })

      it('should remove Coding.display elements', () => {
        // Check vaccineCode.coding.display
        const immunization = optimizedBundle.entry?.find(
          e => e.resource?.resourceType === 'Immunization'
        )?.resource as Immunization
        immunization?.vaccineCode?.coding?.forEach(coding => {
          expect(coding).not.toHaveProperty('display')
        })

        // Check identifier.type.coding.display
        const patient = optimizedBundle.entry?.find(e => e.resource?.resourceType === 'Patient')
          ?.resource as Patient
        patient?.identifier?.[0]?.type?.coding?.forEach(coding => {
          expect(coding).not.toHaveProperty('display')
        })
      })

      it('should use short resource-scheme URIs for Bundle.entry.fullUrl', () => {
        optimizedBundle.entry?.forEach((entry, index) => {
          expect(entry.fullUrl).toBe(`resource:${index}`)
        })
      })

      it('should use short resource-scheme URIs for Reference.reference', () => {
        const immunization = optimizedBundle.entry?.find(
          e => e.resource?.resourceType === 'Immunization'
        )?.resource as Immunization
        expect(immunization?.patient?.reference).toBe('resource:0')
      })

      it('should preserve essential data after optimization', () => {
        // Check that essential data is preserved
        const patient = optimizedBundle.entry?.find(e => e.resource?.resourceType === 'Patient')
          ?.resource as Patient
        expect(patient?.name?.[0]?.family).toBe('Doe')
        expect(patient?.name?.[0]?.given).toEqual(['John'])

        const immunization = optimizedBundle.entry?.find(
          e => e.resource?.resourceType === 'Immunization'
        )?.resource as Immunization
        expect(immunization?.status).toBe('completed')
        expect(immunization?.vaccineCode?.coding?.[0]?.code).toBe('207')
      })
    })

    it('should create SmartHealthCard with QR optimization enabled', async () => {
      const config: SmartHealthCardConfig = {
        issuer: 'https://example.com/issuer',
        privateKey: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`,
        publicKey: `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`,
        keyId: 'test-key-id',
        enableQROptimization: true,
      }

      const smartHealthCard = new SmartHealthCard(config)
      const healthCard = await smartHealthCard.create(validBundle)

      expect(healthCard).toBeDefined()
      expect(typeof healthCard).toBe('string')

      // Verify the optimized bundle can still be verified
      const verifiedVC = await smartHealthCard.verify(healthCard)
      expect(verifiedVC).toBeDefined()

      // Check that optimization was applied by looking at the bundle structure
      const bundle = verifiedVC.vc.credentialSubject.fhirBundle
      if (bundle.entry) {
        bundle.entry.forEach((entry, index) => {
          if (entry.fullUrl) {
            expect(entry.fullUrl).toBe(`resource:${index}`)
          }
        })
      }
    })

    it('should preserve bundle data integrity after optimization', async () => {
      const config: SmartHealthCardConfig = {
        issuer: 'https://example.com/issuer',
        privateKey: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgF+y5n2Nu3g2hwBj+
uVYulsHxb7VQg+0yIHMBgD0dLwyhRANCAAScrWM5QO21TdhCZpZhRwlD8LzgTYkR
CpCKmMQlrMSk1cpRsngZXTNiLipmog4Lm0FPIBhqzskn1FbqYW43KyAk
-----END PRIVATE KEY-----`,
        publicKey: `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEnK1jOUDttU3YQmaWYUcJQ/C84E2J
EQqQipjEJazEpNXKUbJ4GV0zYi4qZqIOC5tBTyAYas7JJ9RW6mFuNysgJA==
-----END PUBLIC KEY-----`,
        keyId: 'test-key-id',
        enableQROptimization: true,
      }

      const smartHealthCard = new SmartHealthCard(config)
      const healthCard = await smartHealthCard.create(validBundle)
      const verifiedVC = await smartHealthCard.verify(healthCard)

      // Essential data should be preserved
      const optimizedBundle = verifiedVC.vc.credentialSubject.fhirBundle
      expect(optimizedBundle.resourceType).toBe('Bundle')
      expect(optimizedBundle.type).toBe('collection')
      expect(optimizedBundle.entry).toHaveLength(validBundle.entry?.length || 0)

      // Resources should still have their core data
      if (optimizedBundle.entry && validBundle.entry) {
        for (let i = 0; i < optimizedBundle.entry.length; i++) {
          const optimizedResource = optimizedBundle.entry[i].resource
          const originalResource = validBundle.entry[i].resource

          if (optimizedResource && originalResource) {
            expect(optimizedResource.resourceType).toBe(originalResource.resourceType)
            // Other essential fields should be preserved (exact comparison depends on optimization rules)
          }
        }
      }
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
