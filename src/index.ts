// Core Smart Health Cards Library
// Implementation of SMART Health Cards Framework specification
// https://spec.smarthealth.cards/

import type { Bundle } from '@medplum/fhirtypes'

// Re-export FHIR Bundle type for convenience
export type FhirBundle = Bundle

export interface VerifiableCredential {
  vc: {
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
}

// Additional QR encoding options that can be passed to the qrcode library
// This interface matches the expected qrcode library options
export interface QREncodeOptions {
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' // Error correction level
  version?: number // 1..40, QR code version
  maskPattern?: number // 0..7, mask number
  margin?: number // Quiet zone size (border)
  scale?: number // Scale factor for output
  width?: number // Forces specific width for output
  color?: {
    dark?: string // Color of dark modules (default: #000000ff)
    light?: string // Color of light modules (default: #ffffffff)
  }
}

export interface QRCodeConfig {
  maxSingleQRSize?: number // Maximum size for single QR code (default: 1195 per SMART Health Cards spec)
  enableChunking?: boolean // Whether to support multi-chunk QR codes (deprecated per SMART Health Cards spec)
  encodeOptions?: QREncodeOptions // Options to pass to encodeQR function (includes ecc, scale, version, etc.)
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
  async create(
    fhirBundle: FhirBundle,
    vcOptions: VerifiableCredentialOptions = {}
  ): Promise<string> {
    try {
      // Step 1: Process and validate FHIR Bundle
      const processedBundle = this.config.enableQROptimization
        ? this.fhirProcessor.processForQR(fhirBundle)
        : this.fhirProcessor.process(fhirBundle)
      this.fhirProcessor.validate(processedBundle)

      // Step 2: Create W3C Verifiable Credential
      const vc = this.vcProcessor.create(processedBundle, vcOptions)
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

      // Step 4: Sign the JWT to create JWS (with compression)
      const jws = await this.jwsProcessor.sign(
        jwtPayload,
        this.config.privateKey,
        this.config.keyId,
        true // Enable compression per SMART Health Cards spec
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
    let contentString: string

    if (fileContent instanceof Blob) {
      // Read text from Blob
      contentString = await fileContent.text()
    } else {
      contentString = fileContent
    }

    // Parse the JWS content
    const contentToParse = contentString

    let jws: string

    try {
      // Try to parse as JSON wrapper format first
      const parsed = JSON.parse(contentToParse)

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
    } catch (error) {
      if (error instanceof SmartHealthCardError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new SmartHealthCardError(
        `Invalid file format - expected JSON with verifiableCredential array: ${errorMessage}`,
        'FILE_FORMAT_ERROR'
      )
    }

    // Verify the JWS content
    return await this.verify(jws)
  }

  /**
   * Verifies a SMART Health Card JWS and returns the contained Verifiable Credential
   */
  async verify(jws: string): Promise<VerifiableCredential> {
    try {
      // Step 1: Verify JWS signature and extract payload (decompression handled automatically)
      const publicKey = this.config.publicKey
      if (!publicKey) {
        throw new SmartHealthCardError('Public key required for verification', 'VERIFICATION_ERROR')
      }

      const payload = await this.jwsProcessor.verify(jws, publicKey)

      // Step 2: Validate and return the VC
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
   * Verifies a SMART Health Card JWS and returns the contained FHIR Bundle
   * Convenience method that extracts the FHIR Bundle from the verified credential
   */
  async getBundle(jws: string): Promise<FhirBundle> {
    const verifiedCredential = await this.verify(jws)
    return verifiedCredential.vc.credentialSubject.fhirBundle
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

      // Remove Resource.id for all resources
      if (key === 'id') {
        continue
      }

      // Handle Resource.meta - only keep meta.security if present
      if (key === 'meta') {
        if (typeof value === 'object' && value !== null) {
          const metaObj = value as Record<string, unknown>
          if (metaObj.security && Array.isArray(metaObj.security)) {
            optimized[key] = { security: metaObj.security }
          }
        }
        continue
      }

      // Remove text from DomainResource and CodeableConcept
      if (
        (key === 'text' && this.isDomainResource(resource)) ||
        (key === 'text' && this.isCodeableConcept(resource))
      ) {
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
   * Checks if a resource is a DomainResource
   * DomainResource is a base resource type with additional optional fields like text
   */
  private isDomainResource(resource: unknown): boolean {
    const domainResourceFields = ['text', 'contained', 'extension', 'modifierExtension']

    return (
      resource !== null &&
      typeof resource === 'object' &&
      domainResourceFields.some(field => field in resource)
    )
  }

  /**
   * Checks if a resource is a CodeableConcept
   * CodeableConcept typically has 'coding' and optional 'text' fields
   */
  private isCodeableConcept(resource: unknown): boolean {
    return (
      resource !== null &&
      typeof resource === 'object' &&
      'coding' in resource &&
      Array.isArray((resource as Record<string, unknown>).coding)
    )
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

      // Validate bundle type (SMART Health Cards requires 'collection')
      if (bundle.type && bundle.type !== 'collection') {
        throw new FhirValidationError(`Invalid bundle type for SMART Health Cards: ${bundle.type}`)
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

    // Create the standard type array per SMART Health Cards spec
    const type = this.createStandardTypes(options.includeAdditionalTypes)

    // Create the verifiable credential structure
    const vc: VerifiableCredential = {
      vc: {
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
   * Creates the standard type array per SMART Health Cards specification
   */
  private createStandardTypes(additionalTypes?: string[]): string[] {
    const standardTypes = ['https://smarthealth.cards#health-card']

    if (additionalTypes && additionalTypes.length > 0) {
      return [...standardTypes, ...additionalTypes]
    }

    return standardTypes
  }

  /**
   * Validates the type array
   */
  private validateTypes(types: string[]): void {
    if (!Array.isArray(types)) {
      throw new FhirValidationError('VC type must be an array')
    }

    if (types.length < 1) {
      throw new FhirValidationError('VC type must contain at least 1 element')
    }

    // Must include health-card type
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
   * Raw DEFLATE compression helper
   */
  private async deflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const { deflate } = await import('fflate')
    return new Promise<Uint8Array>((resolve, reject) => {
      // fflate.deflate is raw DEFLATE (no headers)
      deflate(data, (err: Error | null, out: Uint8Array) => {
        if (err) reject(err)
        else resolve(out)
      })
    })
  }

  /**
   * Raw DEFLATE decompression helper
   */
  private async inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const { inflate } = await import('fflate')
    return new Promise<Uint8Array>((resolve, reject) => {
      // fflate.inflate expects raw DEFLATE input
      inflate(data, (err: Error | null, out: Uint8Array) => {
        if (err) reject(err)
        else resolve(out)
      })
    })
  }

  /**
   * Signs a SMART Health Card JWT payload using ES256 algorithm
   * Returns JWS in compact serialization format (header.payload.signature)
   */
  async sign(
    payload: SmartHealthCardJWT,
    privateKey: CryptoKey | string,
    keyId: string,
    enableCompression = true
  ): Promise<string> {
    try {
      const { CompactSign } = await import('jose')

      // Validate required payload fields
      this.validateJWTPayload(payload)

      // Protected header per SMART Health Cards
      const header: { alg: 'ES256'; kid: string; typ: 'JWT'; zip?: 'DEF' } = {
        alg: 'ES256',
        kid: keyId,
        typ: 'JWT',
      }

      // Serialize payload
      const payloadJson = JSON.stringify(payload)
      const encoder = new TextEncoder()
      let payloadBytes = encoder.encode(payloadJson)

      // Compress the payload BEFORE signing using raw DEFLATE (zip: "DEF")
      if (enableCompression) {
        payloadBytes = await this.deflateRaw(payloadBytes)
        header.zip = 'DEF'
      }

      // Import key
      let key: CryptoKey
      if (typeof privateKey === 'string') {
        const { importPKCS8 } = await import('jose')
        key = await importPKCS8(privateKey, 'ES256')
      } else {
        key = privateKey
      }

      // Build compact JWS (base64url(header) + '.' + base64url(payloadBytes))
      const jws = await new CompactSign(payloadBytes).setProtectedHeader(header).sign(key)
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
      const { compactVerify } = await import('jose')

      if (!jws || typeof jws !== 'string') {
        throw new JWSError('Invalid JWS: must be a non-empty string')
      }

      // Import key
      let key: CryptoKey
      if (typeof publicKey === 'string') {
        const { importSPKI } = await import('jose')
        key = await importSPKI(publicKey, 'ES256')
      } else {
        key = publicKey
      }

      // Verify signature over original compact JWS
      const { payload, protectedHeader } = await compactVerify(jws, key)

      // Decompress payload if zip: 'DEF'
      let payloadBytes = payload
      if (protectedHeader.zip === 'DEF') {
        payloadBytes = await this.inflateRaw(payload)
      }

      // Parse JSON
      const payloadJson = new TextDecoder().decode(payloadBytes)
      const smartPayload = JSON.parse(payloadJson) as SmartHealthCardJWT

      // Validate structure
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
  }
}

export class QRCodeGenerator {
  constructor(public readonly config: QRCodeConfig = {}) {
    // Set default configuration values
    this.config.maxSingleQRSize = this.config.maxSingleQRSize || 1195
    this.config.enableChunking = this.config.enableChunking ?? false
  }

  /**
   * Generates QR code data URLs from a JWS string
   * Returns array of data URLs (single QR for most cases, multiple for chunked)
   */
  async generateQR(jws: string): Promise<string[]> {
    try {
      // Check chunking
      const needsChunking = jws.length > (this.config.maxSingleQRSize || 1195)
      if (!this.config.enableChunking && needsChunking) {
        throw new QRCodeError(
          `Chunking is not enabled, but JWS length exceeds maxSingleQRSize: ${jws.length} > ${this.config.maxSingleQRSize}`
        )
      }

      // Convert JWS to SMART Health Cards numeric format
      const numericData = this.encodeJWSToNumeric(jws)

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
   * Builds the final options object for encodeQR by merging defaults with user options
   * Defaults are aligned with SMART Health Cards specification recommendations
   */
  private buildEncodeOptions(): QREncodeOptions {
    // Default options aligned with SMART Health Cards specification
    // See: https://spec.smarthealth.cards/#health-cards-as-qr-codes
    const defaultOptions: QREncodeOptions = {
      errorCorrectionLevel: 'L', // L level error correction per SMART Health Cards spec
      scale: 4, // Default scale factor for readability
      margin: 1, // Minimal quiet zone size
      color: {
        dark: '#000000ff', // Black modules (SMART Health Cards compliant)
        light: '#ffffffff', // White background (SMART Health Cards compliant)
      },
    }

    // Merge user-provided options, giving them precedence
    return {
      ...defaultOptions,
      ...this.config.encodeOptions,
    }
  }

  /**
   * Generates a single QR code with multi-segment encoding per SMART Health Cards spec
   */
  private async generateSingleQR(numericData: string): Promise<string[]> {
    const QRCode = await import('qrcode')

    const options = this.buildEncodeOptions()

    // Create multi-segment encoding per SMART Health Cards specification:
    // Segment 1: Bytes mode for "shc:/" prefix
    // Segment 2: Numeric mode for JWS numeric data
    const segments = [
      { data: Buffer.from('shc:/', 'utf8'), mode: 'byte' as const },
      { data: numericData, mode: 'numeric' as const },
    ]

    // Generate QR code as data URL using the qrcode library
    // @ts-ignore - qrcode types don't perfectly match our usage with segments
    const qrDataUrl: string = await QRCode.toDataURL(segments, options)

    return [qrDataUrl]
  }

  /**
   * Generates chunked QR codes with multi-segment encoding (deprecated but supported for compatibility)
   */
  private async generateChunkedQR(numericData: string): Promise<string[]> {
    const QRCode = await import('qrcode')

    const options = this.buildEncodeOptions()

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

      // Create multi-segment encoding per SMART Health Cards specification:
      // Segment 1: Bytes mode for "shc:/{index}/{total}/" prefix
      // Segment 2: Numeric mode for chunk data
      const chunkPrefix = `shc:/${chunkIndex}/${totalChunks}/`
      const segments = [
        { data: Buffer.from(chunkPrefix, 'utf8'), mode: 'byte' as const },
        { data: chunks[i], mode: 'numeric' as const },
      ]

      // Generate QR code as data URL using the qrcode library
      // @ts-ignore - qrcode types don't perfectly match our usage with segments
      const qrDataUrl: string = await QRCode.toDataURL(segments, options)
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
  public decodeNumericToJWS(numericData: string): string {
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
