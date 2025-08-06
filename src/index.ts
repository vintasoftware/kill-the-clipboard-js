// Core Smart Health Cards Library
// Implementation of SMART Health Cards Framework specification
// https://spec.smarthealth.cards/

import type { Bundle } from '@medplum/fhirtypes'

// Re-export FHIR Bundle type for convenience
export type FhirBundle = Bundle

export interface VerifiableCredential {
  vc: {
    '@context': Array<string | object>
    type: string[]
    credentialSubject: {
      fhirVersion: string
      fhirBundle: FhirBundle
    }
  }
}

export interface VerifiableCredentialOptions {
  fhirVersion?: string
  includeAdditionalTypes?: string[]
}

export interface SmartHealthCardJWT {
  iss: string // Issuer URL
  nbf: number // Not before timestamp
  exp?: number // Optional expiration timestamp
  vc: VerifiableCredential['vc']
  [key: string]: unknown // Index signature to match JWTPayload
}

export interface JwksKey {
  kty: 'EC'
  use: 'sig'
  kid: string
  x: string
  y: string
  crv: 'P-256'
  alg: 'ES256'
}

export interface JwksResponse {
  keys: JwksKey[]
}

// Error Classes
export class SmartHealthCardError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message)
    this.name = 'SmartHealthCardError'
  }
}

export class FhirValidationError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'FHIR_VALIDATION_ERROR')
    this.name = 'FhirValidationError'
  }
}

export class JWSError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'JWS_ERROR')
    this.name = 'JWSError'
  }
}

export class QRCodeError extends SmartHealthCardError {
  constructor(message: string) {
    super(message, 'QR_CODE_ERROR')
    this.name = 'QRCodeError'
  }
}

// Configuration Interfaces
export interface SmartHealthCardConfig {
  issuer: string
  privateKey: CryptoKey | string
  publicKey?: CryptoKey | string
  keyId: string
  expirationTime?: number // Optional expiration in seconds from now
  enableQROptimization?: boolean // Whether to optimize FHIR Bundle for QR codes
  enableCompression?: boolean // Whether to enable DEFLATE compression (experimental)
}

export interface QRCodeConfig {
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  maxSingleQRSize?: number // Maximum size for single QR code
  enableChunking?: boolean // Whether to support multi-chunk QR codes (deprecated but may be needed)
}

// Core Classes
export class SmartHealthCard {
  private fhirProcessor: FhirBundleProcessor
  private vcProcessor: VerifiableCredentialProcessor
  private jwsProcessor: JWSProcessor

  constructor(private config: SmartHealthCardConfig) {
    this.fhirProcessor = new FhirBundleProcessor()
    this.vcProcessor = new VerifiableCredentialProcessor()
    this.jwsProcessor = new JWSProcessor()
  }

  /**
   * Creates a SMART Health Card from a FHIR Bundle
   * Returns a compressed JWS ready for QR code generation
   */
  async create(fhirBundle: FhirBundle): Promise<string> {
    try {
      // Step 1: Process and validate FHIR Bundle
      const processedBundle = this.config.enableQROptimization
        ? this.fhirProcessor.processForQR(fhirBundle)
        : this.fhirProcessor.process(fhirBundle)
      this.fhirProcessor.validate(processedBundle)

      // Step 2: Create W3C Verifiable Credential
      const vc = this.vcProcessor.create(processedBundle)
      this.vcProcessor.validate(vc)

      // Step 3: Create JWT payload with issuer information
      const now = Math.floor(Date.now() / 1000)
      const jwtPayload: SmartHealthCardJWT = {
        iss: this.config.issuer,
        nbf: now,
        vc: vc.vc,
      }

      // Add expiration if configured
      if (this.config.expirationTime) {
        jwtPayload.exp = now + this.config.expirationTime
      }

      // Step 4: Sign the JWT to create JWS (with compression if enabled)
      const jws = await this.jwsProcessor.sign(
        jwtPayload,
        this.config.privateKey,
        this.config.keyId,
        this.config.enableCompression
      )

      return jws
    } catch (error) {
      if (error instanceof SmartHealthCardError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SmartHealthCardError(
        `Failed to create SMART Health Card: ${errorMessage}`,
        'CREATION_ERROR'
      )
    }
  }

  /**
   * Creates a SMART Health Card file content from a FHIR Bundle
   * Returns the file content as a string suitable for .smart-health-card files
   */
  async createFile(fhirBundle: FhirBundle): Promise<string> {
    // Generate the JWS
    const jws = await this.create(fhirBundle)

    // Per SMART Health Cards spec, the file content should be a JSON wrapper
    // with verifiableCredential array containing the JWS
    const fileContent = {
      verifiableCredential: [jws],
    }

    return JSON.stringify(fileContent)
  }

  /**
   * Creates a downloadable Blob for SMART Health Card file (.smart-health-card)
   * Web-compatible method for generating downloadable files
   */
  async createFileBlob(fhirBundle: FhirBundle): Promise<Blob> {
    const fileContent = await this.createFile(fhirBundle)

    // Create a Blob with the appropriate MIME type
    return new Blob([fileContent], {
      type: 'application/smart-health-card',
    })
  }

  /**
   * Verifies a SMART Health Card from file content
   * Accepts file content (string) or Blob from .smart-health-card files
   */
  async verifyFile(fileContent: string | Blob): Promise<VerifiableCredential> {
    try {
      let contentString: string

      if (fileContent instanceof Blob) {
        // Read text from Blob
        contentString = await fileContent.text()
      } else {
        contentString = fileContent
      }

      let jws: string

      // Try to parse as JSON wrapper format first
      const parsed = JSON.parse(contentString)

      if (parsed.verifiableCredential && Array.isArray(parsed.verifiableCredential)) {
        // New JSON wrapper format
        if (parsed.verifiableCredential.length === 0) {
          throw new SmartHealthCardError(
            'File contains empty verifiableCredential array',
            'FILE_FORMAT_ERROR'
          )
        }
        jws = parsed.verifiableCredential[0]
      } else {
        throw new SmartHealthCardError(
          'File does not contain expected verifiableCredential array',
          'FILE_FORMAT_ERROR'
        )
      }

      // Verify the JWS content
      return await this.verify(jws)
    } catch (error) {
      if (error instanceof SmartHealthCardError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SmartHealthCardError(
        `Failed to verify SMART Health Card file: ${errorMessage}`,
        'FILE_VERIFICATION_ERROR'
      )
    }
  }

  /**
   * Verifies a SMART Health Card JWS and returns the contained Verifiable Credential
   */
  async verify(jws: string): Promise<VerifiableCredential> {
    try {
      // Step 1: Decompress if needed
      const decompressedJws = await this.decompressJWS(jws)

      // Step 2: Verify JWS signature and extract payload
      const publicKey = this.config.publicKey
      if (!publicKey) {
        throw new SmartHealthCardError('Public key required for verification', 'VERIFICATION_ERROR')
      }

      const payload = await this.jwsProcessor.verify(decompressedJws, publicKey)

      // Step 3: Validate and return the VC
      const vc: VerifiableCredential = { vc: payload.vc }
      this.vcProcessor.validate(vc)

      return vc
    } catch (error) {
      if (error instanceof SmartHealthCardError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SmartHealthCardError(
        `Failed to verify SMART Health Card: ${errorMessage}`,
        'VERIFICATION_ERROR'
      )
    }
  }

  /**
   * Compresses a JWS using DEFLATE algorithm per SMART Health Cards spec
   * For now, returns uncompressed JWS - compression can be added as optimization
   */
  private async compressJWS(jws: string): Promise<string> {
    try {
      // Import fflate dynamically for web compatibility
      const { deflateSync } = await import('fflate')

      // Split JWS into header, payload, signature
      const parts = jws.split('.')
      if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        throw new SmartHealthCardError('Invalid JWS format for compression', 'COMPRESSION_ERROR')
      }

      // Compress the payload using DEFLATE
      const payloadBytes = new TextEncoder().encode(parts[1])
      const compressedPayload = deflateSync(payloadBytes)

      // Base64url encode the compressed payload
      const compressedPayloadB64 = this.base64urlEncode(compressedPayload)

      // Create new header with 'zip' property
      const headerBytes = this.base64urlDecode(parts[0])
      const headerObj = JSON.parse(new TextDecoder().decode(headerBytes))
      headerObj.zip = 'DEF' // DEFLATE compression indicator
      const newHeader = this.base64urlEncode(new TextEncoder().encode(JSON.stringify(headerObj)))

      // Return compressed JWS
      return `${newHeader}.${compressedPayloadB64}.${parts[2]}`
    } catch (error) {
      throw new SmartHealthCardError(
        `DEFLATE compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'COMPRESSION_ERROR'
      )
    }
  }

  /**
   * Decompresses a JWS - currently handles uncompressed JWS
   */
  private async decompressJWS(jws: string): Promise<string> {
    try {
      // Split JWS into header, payload, signature
      const parts = jws.split('.')
      if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        // If it's not a valid JWS format, return as-is (let other validation catch it)
        return jws
      }

      // Try to parse the header - if it fails, assume uncompressed
      let headerObj: Record<string, unknown> | undefined
      try {
        const headerBytes = this.base64urlDecode(parts[0])
        headerObj = JSON.parse(new TextDecoder().decode(headerBytes))
      } catch {
        // If header parsing fails, assume uncompressed
        return jws
      }

      // If no compression, return as-is
      if (!headerObj || !headerObj.zip || headerObj.zip !== 'DEF') {
        return jws
      }

      // Import fflate dynamically for web compatibility
      const { inflateSync } = await import('fflate')

      // Decompress the payload using DEFLATE
      const compressedPayload = this.base64urlDecode(parts[1])
      const decompressedPayload = inflateSync(compressedPayload)

      // Base64url encode the decompressed payload
      const decompressedPayloadB64 = this.base64urlEncode(decompressedPayload)

      // Remove 'zip' property from header
      delete headerObj.zip
      const newHeader = this.base64urlEncode(new TextEncoder().encode(JSON.stringify(headerObj)))

      // Return decompressed JWS
      return `${newHeader}.${decompressedPayloadB64}.${parts[2]}`
    } catch {
      // If decompression fails, return original JWS (let JWS verification handle the error)
      return jws
    }
  }

  /**
   * Base64url encode a Uint8Array
   */
  private base64urlEncode(data: Uint8Array): string {
    // Convert to base64
    const base64 = btoa(String.fromCharCode(...data))

    // Convert to base64url by replacing characters and removing padding
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }

  /**
   * Base64url decode to Uint8Array
   */
  private base64urlDecode(base64url: string): Uint8Array {
    // Add padding if needed
    let base64 = base64url
    while (base64.length % 4) {
      base64 += '='
    }

    // Convert base64url to base64
    base64 = base64.replace(/-/g, '+').replace(/_/g, '/')

    // Decode base64 to binary string
    const binaryString = atob(base64)

    // Convert to Uint8Array
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    return bytes
  }
}

export class FhirBundleProcessor {
  /**
   * Processes a FHIR Bundle according to SMART Health Cards specification
   */
  process(bundle: FhirBundle): FhirBundle {
    if (!bundle || bundle.resourceType !== 'Bundle') {
      throw new FhirValidationError('Invalid bundle: must be a FHIR Bundle resource')
    }

    // Create a deep copy to avoid modifying the original
    const processedBundle: FhirBundle = JSON.parse(JSON.stringify(bundle))

    // Ensure Bundle.type defaults to "collection" per SMART Health Cards spec
    // This is the only explicit field requirement mentioned in the spec
    if (!processedBundle.type) {
      processedBundle.type = 'collection'
    }

    return processedBundle
  }

  /**
   * Processes a FHIR Bundle with QR code optimizations
   * Implements short resource-scheme URIs and removes unnecessary fields
   */
  processForQR(bundle: FhirBundle): FhirBundle {
    // Start with standard processing
    const processedBundle = this.process(bundle)

    // Apply QR optimizations
    return this.optimizeForQR(processedBundle)
  }

  /**
   * Optimizes a FHIR Bundle for QR code generation
   * - Uses short resource-scheme URIs (resource:0, resource:1, etc.)
   * - Removes unnecessary .id and .display fields
   * - Removes empty arrays and null values
   */
  private optimizeForQR(bundle: FhirBundle): FhirBundle {
    const optimizedBundle: FhirBundle = JSON.parse(JSON.stringify(bundle))

    // Create resource reference mapping
    const resourceMap = new Map<string, string>()

    // First pass: map fullUrl to short resource references
    if (optimizedBundle.entry) {
      optimizedBundle.entry.forEach((entry, index) => {
        if (entry.fullUrl) {
          resourceMap.set(entry.fullUrl, `resource:${index}`)
          entry.fullUrl = `resource:${index}`
        }
      })

      // Second pass: optimize resources and update references
      optimizedBundle.entry.forEach(entry => {
        if (entry.resource) {
          // Remove unnecessary id field if it matches the resource reference
          if (
            entry.resource.id &&
            entry.fullUrl === `resource:${optimizedBundle.entry?.indexOf(entry)}`
          ) {
            delete entry.resource.id
          }

          // Recursively optimize the resource
          entry.resource = this.optimizeResource(
            entry.resource,
            resourceMap
          ) as typeof entry.resource
        }
      })
    }

    return optimizedBundle
  }

  /**
   * Recursively optimizes a FHIR resource for QR codes
   */
  private optimizeResource(resource: unknown, resourceMap: Map<string, string>): unknown {
    if (!resource || typeof resource !== 'object') {
      return resource
    }

    if (Array.isArray(resource)) {
      return resource
        .map(item => this.optimizeResource(item, resourceMap))
        .filter(item => item !== null && item !== undefined)
    }

    const optimized: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(resource as Record<string, unknown>)) {
      // Skip null, undefined, and empty arrays
      if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
        continue
      }

      // Remove .display fields from CodeableConcept.coding
      if (key === 'display' && typeof value === 'string') {
        continue
      }

      // Update references to use short resource-scheme URIs
      if (key === 'reference' && typeof value === 'string') {
        const shortRef = resourceMap.get(value)
        optimized[key] = shortRef || value
        continue
      }

      // Recursively process nested objects and arrays
      optimized[key] = this.optimizeResource(value, resourceMap)
    }

    return optimized
  }

  /**
   * Validates a FHIR Bundle for basic compliance
   * More comprehensive validation can be added based on specific FHIR profiles
   */
  validate(bundle: FhirBundle): boolean {
    try {
      // Basic structure validation
      if (!bundle) {
        throw new FhirValidationError('Bundle cannot be null or undefined')
      }

      if (bundle.resourceType !== 'Bundle') {
        throw new FhirValidationError('Resource must be of type Bundle')
      }

      // Validate bundle type
      const validBundleTypes = [
        'collection',
        'batch',
        'history',
        'searchset',
        'transaction',
        'transaction-response',
      ]
      if (bundle.type && !validBundleTypes.includes(bundle.type)) {
        throw new FhirValidationError(`Invalid bundle type: ${bundle.type}`)
      }

      // Validate entries if present
      if (bundle.entry) {
        if (!Array.isArray(bundle.entry)) {
          throw new FhirValidationError('Bundle.entry must be an array')
        }

        for (const [index, entry] of bundle.entry.entries()) {
          if (!entry.resource) {
            throw new FhirValidationError(`Bundle.entry[${index}] must contain a resource`)
          }

          if (!entry.resource.resourceType) {
            throw new FhirValidationError(
              `Bundle.entry[${index}].resource must have a resourceType`
            )
          }
        }
      }

      return true
    } catch (error) {
      if (error instanceof FhirValidationError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new FhirValidationError(`Bundle validation failed: ${errorMessage}`)
    }
  }
}

export class VerifiableCredentialProcessor {
  /**
   * Creates a W3C Verifiable Credential for SMART Health Cards
   * Following the specification at https://spec.smarthealth.cards/
   */
  create(fhirBundle: FhirBundle, options: VerifiableCredentialOptions = {}): VerifiableCredential {
    // Validate input bundle
    if (!fhirBundle || fhirBundle.resourceType !== 'Bundle') {
      throw new FhirValidationError('Invalid FHIR Bundle provided')
    }

    // Set default FHIR version per SMART Health Cards spec
    const fhirVersion = options.fhirVersion || '4.0.1'

    // Create the standard W3C VC @context per SMART Health Cards spec
    const context = this.createStandardContext()

    // Create the standard type array per SMART Health Cards spec
    const type = this.createStandardTypes(options.includeAdditionalTypes)

    // Create the verifiable credential structure
    const vc: VerifiableCredential = {
      vc: {
        '@context': context,
        type: type,
        credentialSubject: {
          fhirVersion: fhirVersion,
          fhirBundle: fhirBundle,
        },
      },
    }

    return vc
  }

  /**
   * Validates a W3C Verifiable Credential for SMART Health Cards compliance
   */
  validate(vc: VerifiableCredential): boolean {
    try {
      if (!vc || !vc.vc) {
        throw new FhirValidationError('Invalid VC: missing vc property')
      }

      // Validate @context
      this.validateContext(vc.vc['@context'])

      // Validate type array
      this.validateTypes(vc.vc.type)

      // Validate credential subject
      this.validateCredentialSubject(vc.vc.credentialSubject)

      return true
    } catch (error) {
      if (error instanceof FhirValidationError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new FhirValidationError(`VC validation failed: ${errorMessage}`)
    }
  }

  /**
   * Creates the standard @context array per SMART Health Cards specification
   */
  private createStandardContext(): Array<string | object> {
    return [
      'https://www.w3.org/2018/credentials/v1',
      {
        '@vocab': 'https://smarthealth.cards#',
        fhirBundle: {
          '@id': 'https://smarthealth.cards#fhirBundle',
          '@type': '@json',
        },
      },
    ]
  }

  /**
   * Creates the standard type array per SMART Health Cards specification
   */
  private createStandardTypes(additionalTypes?: string[]): string[] {
    const standardTypes = ['VerifiableCredential', 'https://smarthealth.cards#health-card']

    if (additionalTypes && additionalTypes.length > 0) {
      return [...standardTypes, ...additionalTypes]
    }

    return standardTypes
  }

  /**
   * Validates the @context array
   */
  private validateContext(context: Array<string | object>): void {
    if (!Array.isArray(context)) {
      throw new FhirValidationError('VC @context must be an array')
    }

    if (context.length < 2) {
      throw new FhirValidationError('VC @context must contain at least 2 elements')
    }

    // First element must be the W3C VC context
    if (context[0] !== 'https://www.w3.org/2018/credentials/v1') {
      throw new FhirValidationError(
        'First @context element must be https://www.w3.org/2018/credentials/v1'
      )
    }

    // Second element must be SMART Health Cards context object
    const smartContext = context[1]
    if (typeof smartContext !== 'object' || smartContext === null) {
      throw new FhirValidationError(
        'Second @context element must be SMART Health Cards context object'
      )
    }

    // Validate required SMART Health Cards context properties
    const smartContextObj = smartContext as Record<string, unknown>
    if (smartContextObj['@vocab'] !== 'https://smarthealth.cards#') {
      throw new FhirValidationError('SMART Health Cards context must include correct @vocab')
    }

    const fhirBundleContext = smartContextObj.fhirBundle as Record<string, unknown>
    if (
      !fhirBundleContext ||
      fhirBundleContext['@id'] !== 'https://smarthealth.cards#fhirBundle' ||
      fhirBundleContext['@type'] !== '@json'
    ) {
      throw new FhirValidationError(
        'SMART Health Cards context must include correct fhirBundle definition'
      )
    }
  }

  /**
   * Validates the type array
   */
  private validateTypes(types: string[]): void {
    if (!Array.isArray(types)) {
      throw new FhirValidationError('VC type must be an array')
    }

    if (types.length < 2) {
      throw new FhirValidationError('VC type must contain at least 2 elements')
    }

    if (!types.includes('VerifiableCredential')) {
      throw new FhirValidationError('VC type must include VerifiableCredential')
    }

    if (!types.includes('https://smarthealth.cards#health-card')) {
      throw new FhirValidationError('VC type must include https://smarthealth.cards#health-card')
    }
  }

  /**
   * Validates the credential subject
   */
  private validateCredentialSubject(credentialSubject: {
    fhirVersion: string
    fhirBundle: FhirBundle
  }): void {
    if (!credentialSubject) {
      throw new FhirValidationError('VC credentialSubject is required')
    }

    if (!credentialSubject.fhirVersion) {
      throw new FhirValidationError('VC credentialSubject must include fhirVersion')
    }

    // Validate FHIR version format (should be semantic version)
    const fhirVersionRegex = /^\d+\.\d+\.\d+$/
    if (!fhirVersionRegex.test(credentialSubject.fhirVersion)) {
      throw new FhirValidationError(
        'VC fhirVersion must be in semantic version format (e.g., 4.0.1)'
      )
    }

    if (!credentialSubject.fhirBundle) {
      throw new FhirValidationError('VC credentialSubject must include fhirBundle')
    }

    if (credentialSubject.fhirBundle.resourceType !== 'Bundle') {
      throw new FhirValidationError('VC fhirBundle must be a valid FHIR Bundle')
    }
  }
}

export class JWSProcessor {
  /**
   * Signs a SMART Health Card JWT payload using ES256 algorithm
   * Returns JWS in compact serialization format (header.payload.signature)
   */
  async sign(
    payload: SmartHealthCardJWT,
    privateKey: CryptoKey | string,
    keyId: string,
    enableCompression?: boolean
  ): Promise<string> {
    try {
      const { SignJWT } = await import('jose')

      // Validate required payload fields
      this.validateJWTPayload(payload)

      // Use a plain object for the header, as jose does not export JWTHeaderParameters
      const header = {
        alg: 'ES256',
        kid: keyId,
        typ: 'JWT',
      }
      if (enableCompression) {
        ;(header as Record<string, unknown>).zip = 'DEF'
      }

      // Create JWT builder
      const jwt = new SignJWT(payload).setProtectedHeader(header)

      // Handle different key formats
      let key: CryptoKey
      if (typeof privateKey === 'string') {
        const { importPKCS8 } = await import('jose')
        key = await importPKCS8(privateKey, 'ES256')
      } else {
        key = privateKey
      }

      // Sign and return JWS
      const jws = await jwt.sign(key)
      return jws
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      throw new JWSError(`JWS signing failed: ${errorMessage}`)
    }
  }

  /**
   * Verifies a JWS and returns the decoded SMART Health Card JWT payload
   */
  async verify(jws: string, publicKey: CryptoKey | string): Promise<SmartHealthCardJWT> {
    try {
      const { jwtVerify } = await import('jose')

      // Validate JWS format
      if (!jws || typeof jws !== 'string') {
        throw new JWSError('Invalid JWS: must be a non-empty string')
      }

      const parts = jws.split('.')
      if (parts.length !== 3) {
        throw new JWSError('Invalid JWS format: must have 3 parts separated by dots')
      }

      // Handle different key formats
      let key: CryptoKey
      if (typeof publicKey === 'string') {
        const { importSPKI } = await import('jose')
        key = await importSPKI(publicKey, 'ES256')
      } else {
        key = publicKey
      }

      // Verify JWS and extract payload
      const { payload } = await jwtVerify(jws, key, {
        algorithms: ['ES256'],
      })

      // Convert payload to our SmartHealthCardJWT type through unknown
      const smartPayload = payload as unknown as SmartHealthCardJWT

      // Validate the decoded payload structure
      this.validateJWTPayload(smartPayload)

      return smartPayload
    } catch (error) {
      if (error instanceof JWSError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new JWSError(`JWS verification failed: ${errorMessage}`)
    }
  }

  /**
   * Decodes a JWS without verification (for testing/debugging purposes)
   * WARNING: This does not verify the signature - use verify() for production
   */
  async decode(
    jws: string
  ): Promise<{ header: Record<string, unknown>; payload: SmartHealthCardJWT }> {
    try {
      const { decodeJwt, decodeProtectedHeader } = await import('jose')

      // Validate JWS format
      if (!jws || typeof jws !== 'string') {
        throw new JWSError('Invalid JWS: must be a non-empty string')
      }

      const parts = jws.split('.')
      if (parts.length !== 3) {
        throw new JWSError('Invalid JWS format: must have 3 parts separated by dots')
      }

      // Decode header and payload without verification
      const header = decodeProtectedHeader(jws)
      const payload = decodeJwt(jws) as unknown as SmartHealthCardJWT

      return { header, payload }
    } catch (error) {
      if (error instanceof JWSError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new JWSError(`JWS decoding failed: ${errorMessage}`)
    }
  }

  /**
   * Validates the structure of a SMART Health Card JWT payload
   */
  private validateJWTPayload(payload: SmartHealthCardJWT): void {
    if (!payload || typeof payload !== 'object') {
      throw new JWSError('Invalid JWT payload: must be an object')
    }

    // Validate required fields per SMART Health Cards spec
    if (!payload.iss || typeof payload.iss !== 'string') {
      throw new JWSError("Invalid JWT payload: 'iss' (issuer) is required and must be a string")
    }

    if (!payload.nbf || typeof payload.nbf !== 'number') {
      throw new JWSError("Invalid JWT payload: 'nbf' (not before) is required and must be a number")
    }

    // exp is optional but if present must be a number
    if (payload.exp !== undefined && typeof payload.exp !== 'number') {
      throw new JWSError("Invalid JWT payload: 'exp' (expiration) must be a number if provided")
    }

    // Validate exp > nbf if both are present
    if (payload.exp && payload.exp <= payload.nbf) {
      throw new JWSError("Invalid JWT payload: 'exp' must be greater than 'nbf'")
    }

    if (!payload.vc || typeof payload.vc !== 'object') {
      throw new JWSError(
        "Invalid JWT payload: 'vc' (verifiable credential) is required and must be an object"
      )
    }

    // Additional VC structure validation could be added here
    // For now, we rely on the VerifiableCredentialProcessor for detailed VC validation
  }
}

export class QRCodeGenerator {
  constructor(private config: QRCodeConfig = {}) {
    // Set default configuration values
    this.config.errorCorrectionLevel = this.config.errorCorrectionLevel || 'L'
    this.config.maxSingleQRSize = this.config.maxSingleQRSize || 1195
    this.config.enableChunking = this.config.enableChunking ?? false
  }

  /**
   * Generates QR code data URLs from a JWS string
   * Returns array of data URLs (single QR for most cases, multiple for chunked)
   */
  async generateQR(jws: string): Promise<string[]> {
    try {
      // Convert JWS to SMART Health Cards numeric format
      const numericData = this.encodeJWSToNumeric(jws)

      // Check if we need chunking (deprecated but supported for compatibility)
      const needsChunking =
        this.config.enableChunking && numericData.length > (this.config.maxSingleQRSize || 1195)

      if (needsChunking) {
        return await this.generateChunkedQR(numericData)
      } else {
        return await this.generateSingleQR(numericData)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new QRCodeError(`QR code generation failed: ${errorMessage}`)
    }
  }

  /**
   * Scans QR code data and reconstructs the original JWS
   * Accepts array of QR code numeric strings (for chunked QR support)
   */
  async scanQR(qrCodeData: string[]): Promise<string> {
    try {
      if (!qrCodeData || qrCodeData.length === 0) {
        throw new QRCodeError('No QR code data provided')
      }

      // Handle single QR code
      if (qrCodeData.length === 1) {
        const firstQRData = qrCodeData[0]
        if (!firstQRData) {
          throw new QRCodeError('QR code data is undefined')
        }
        return this.decodeSingleQR(firstQRData)
      }

      // Handle chunked QR codes
      return this.decodeChunkedQR(qrCodeData)
    } catch (error) {
      if (error instanceof QRCodeError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new QRCodeError(`QR code scanning failed: ${errorMessage}`)
    }
  }

  /**
   * Encodes a JWS string to SMART Health Cards numeric format
   * Each character is converted to (ASCII code - 45), zero-padded to 2 digits
   */
  public encodeJWSToNumeric(jws: string): string {
    const b64Offset = '-'.charCodeAt(0) // 45

    return jws
      .split('')
      .map(char => {
        const ascii = char.charCodeAt(0)
        const numericValue = ascii - b64Offset

        // Validate that the character is in the expected base64url range
        if (numericValue < 0 || numericValue > 77) {
          throw new QRCodeError(
            `Invalid character '${char}' in JWS. Expected base64url characters only.`
          )
        }

        // Zero-pad to 2 digits
        return numericValue.toString().padStart(2, '0')
      })
      .join('')
  }

  /**
   * Generates a single QR code with shc:/ prefix
   */
  private async generateSingleQR(numericData: string): Promise<string[]> {
    const { default: QRCode } = await import('qrcode')

    const qrContent = `shc:/${numericData}`

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(qrContent, {
      errorCorrectionLevel: this.config.errorCorrectionLevel,
      type: 'image/png',
      margin: 1,
      width: 400, // Reasonable default size
    })

    return [qrDataUrl]
  }

  /**
   * Generates chunked QR codes (deprecated but supported for compatibility)
   */
  private async generateChunkedQR(numericData: string): Promise<string[]> {
    const { default: QRCode } = await import('qrcode')

    // Calculate chunk size based on max QR size minus header overhead
    const headerOverhead = 20 // Estimate for "shc:/1/N/" format
    const chunkSize = (this.config.maxSingleQRSize || 1195) - headerOverhead

    // Split numeric data into chunks
    const chunks: string[] = []
    for (let i = 0; i < numericData.length; i += chunkSize) {
      chunks.push(numericData.substring(i, i + chunkSize))
    }

    const totalChunks = chunks.length
    const qrDataUrls: string[] = []

    // Generate QR code for each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunkIndex = i + 1 // 1-based indexing
      const qrContent = `shc:/${chunkIndex}/${totalChunks}/${chunks[i]}`

      const qrDataUrl = await QRCode.toDataURL(qrContent, {
        errorCorrectionLevel: this.config.errorCorrectionLevel,
        type: 'image/png',
        margin: 1,
        width: 400,
      })

      qrDataUrls.push(qrDataUrl)
    }

    return qrDataUrls
  }

  /**
   * Decodes a single QR code from SMART Health Cards format
   */
  private decodeSingleQR(qrData: string): string {
    // Remove shc:/ prefix
    const prefix = 'shc:/'
    if (!qrData.startsWith(prefix)) {
      throw new QRCodeError(`Invalid QR code format. Expected '${prefix}' prefix.`)
    }

    const numericData = qrData.substring(prefix.length)
    return this.decodeNumericToJWS(numericData)
  }

  /**
   * Decodes chunked QR codes and reconstructs the original JWS
   */
  private decodeChunkedQR(qrDataArray: string[]): string {
    const chunks: { index: number; data: string }[] = []
    let totalChunks = 0

    // Parse each QR code chunk
    for (const qrData of qrDataArray) {
      const prefix = 'shc:/'
      if (!qrData.startsWith(prefix)) {
        throw new QRCodeError(`Invalid chunked QR code format. Expected '${prefix}' prefix.`)
      }

      const content = qrData.substring(prefix.length)
      const parts = content.split('/')

      if (parts.length !== 3) {
        throw new QRCodeError(
          'Invalid chunked QR code format. Expected format: shc:/INDEX/TOTAL/DATA'
        )
      }

      const chunkIndexStr = parts[0]
      const chunkTotalStr = parts[1]
      const chunkData = parts[2]

      if (!chunkIndexStr || !chunkTotalStr || !chunkData) {
        throw new QRCodeError('Invalid chunked QR code format: missing parts')
      }

      const chunkIndex = parseInt(chunkIndexStr)
      const chunkTotal = parseInt(chunkTotalStr)

      if (
        Number.isNaN(chunkIndex) ||
        Number.isNaN(chunkTotal) ||
        chunkIndex < 1 ||
        chunkIndex > chunkTotal
      ) {
        throw new QRCodeError('Invalid chunk index or total in QR code')
      }

      if (totalChunks === 0) {
        totalChunks = chunkTotal
      } else if (totalChunks !== chunkTotal) {
        throw new QRCodeError('Inconsistent total chunk count across QR codes')
      }

      chunks.push({ index: chunkIndex, data: chunkData })
    }

    // Validate we have all chunks
    if (chunks.length !== totalChunks) {
      throw new QRCodeError(`Missing chunks. Expected ${totalChunks}, got ${chunks.length}`)
    }

    // Sort chunks by index and reconstruct numeric data
    chunks.sort((a, b) => a.index - b.index)
    const numericData = chunks.map(chunk => chunk.data).join('')

    return this.decodeNumericToJWS(numericData)
  }

  /**
   * Decodes numeric data back to JWS string
   * Reverses the encoding process: pairs of digits -> (value + 45) -> ASCII character
   */
  private decodeNumericToJWS(numericData: string): string {
    // Validate even length
    if (numericData.length % 2 !== 0) {
      throw new QRCodeError('Invalid numeric data: must have even length')
    }

    const b64Offset = '-'.charCodeAt(0) // 45
    const digitPairs = numericData.match(/(\d\d)/g)

    if (!digitPairs) {
      throw new QRCodeError('Invalid numeric data: cannot parse digit pairs')
    }

    // Validate each pair is within valid range (0-77)
    for (const pair of digitPairs) {
      const value = parseInt(pair)
      if (value > 77) {
        throw new QRCodeError(`Invalid digit pair '${pair}': value ${value} exceeds maximum 77`)
      }
    }

    // Convert digit pairs back to characters
    return digitPairs
      .map(pair => {
        const numericValue = parseInt(pair)
        const asciiCode = numericValue + b64Offset
        return String.fromCharCode(asciiCode)
      })
      .join('')
  }
}

// Main export
export default {
  SmartHealthCard,
  FhirBundleProcessor,
  VerifiableCredentialProcessor,
  JWSProcessor,
  QRCodeGenerator,
  // Error classes
  SmartHealthCardError,
  FhirValidationError,
  JWSError,
  QRCodeError,
}
