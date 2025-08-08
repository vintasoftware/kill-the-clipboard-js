# SMART Health Cards JavaScript/TypeScript Library Implementation

JavaScript/TypeScript universal (browser and node) library to generate QR codes containing medical records for patients to share with providers. Implements the [SMART Health Cards Framework](https://smarthealth.cards/) for FHIR-based medical records, enabling patients to "Kill the Clipboard" by sharing health data via secure, verifiable QR codes.

## Completed Tasks

- [x] Updated package.json with SMART Health Cards library information, installed required dependencies (jose, qrcode, fflate, ajv, @medplum/fhirtypes)
- [x] Designed and implemented TypeScript interfaces and base classes for SmartHealthCard, FhirBundleProcessor, JWSProcessor, QRCodeGenerator with proper error handling hierarchy
- [x] Implemented FHIR Bundle handling with validation and spec-compliant processing (Bundle.type="collection" default, removed aggressive field minification per spec analysis)
- [x] Updated FHIR Bundle validation to allow any FHIR `Bundle.type` per spec (1.3.0) while still defaulting to `collection` when absent
- [x] Analyzed official SMART Health Cards spec and corrected data minimization approach to follow actual spec requirements (credential-level granularity, not aggressive field removal)
- [x] Implemented VerifiableCredentialProcessor with create() and validate() methods, proper @context and type array handling, FHIR version validation, and comprehensive test suite (44 tests passing)
- [x] Removed deprecated minify() method, streamlined Bundle processing with clean process() method, aligned API with actual spec requirements
- [x] Implemented JWS creation and verification with ES256 algorithm using jose library, proper JWT payload validation, and comprehensive test suite (61 tests passing)
- [x] Implemented complete SmartHealthCard class with create() and verify() methods, integrating all components into a simple API with 73 tests passing
- [x] Implemented .smart-health-card file generation and verification per SMART Health Cards specification, with web-compatible Blob support and 81 tests passing
- [x] Complete QR code generation and scanning with single and chunked modes, numeric encoding (Ord(c)-45), shc:/ prefix handling, and comprehensive testing
- [x] Created detailed README with usage examples, API reference, and technical specifications including file operations
- [x] Tested implementation against official SMART Health Cards dev tools validator, identified areas for optimization and compliance improvements
- [x] Comprehensive testing of all 4 QR validation types (qrnumeric single/chunked, qr single/chunked) using health-cards-dev-tools validator v1.3.0-2
- [x] Added 'zip' property to JWS header and implemented DEFLATE compression using fflate for web compatibility. Compression is enabled by default (zip: "DEF").
- [x] Fixed .smart-health-card file format to use JSON wrapper with verifiableCredential array instead of raw JWS.
- [x] Implemented short resource-scheme URIs (`resource:0`, `resource:1`, etc.) and removal of unnecessary .id/.display fields for QR-optimized bundles via `enableQROptimization` config flag.
- [x] Implement QR code generation with single-code optimization (primary implementation) Full QR code implementation with single and chunked modes
- [x] Create QR code scanning with numeric decoding (Ord(c)-45 format) Complete QR scanning with proper numeric decoding
- [x] Add QR code chunking support (deprecated in spec but may be needed for CMS Interoperability Framework) Chunked QR support fully implemented and tested
- [x] Handle SMART Health Card 'shc:/' prefix format for QR codes SHC prefix handling implemented and tested
- [x] Add DEFLATE compression support for FHIR Bundle payload optimization Implemented with fflate library for web compatibility
- [x] Create W3C VC @context and type array handling for compliance Implemented in VerifiableCredentialProcessor with comprehensive validation
- [x] Implement robust error handling with specific exception types for different failure modes SmartHealthCardError hierarchy with FhirValidationError, JWSError, QRCodeError
- [x] Develop comprehensive test suite covering encoding, decoding, and validation scenarios
- [x] Re-run manual validator and fix all warnings
- [x] Aligned QR encode options to match `qrcode` library API (`errorCorrectionLevel`, `margin`, `color`, etc.) and updated README examples accordingly

## In Progress Tasks

## Future Tasks

- [ ] Add certificate management utilities for public/private key handling
- [ ] Implement JWKS (JSON Web Key Set) provider for public key retrieval and validation
- [ ] Add FHIR profile validation for vaccination and lab result bundles
- [ ] Add optional JWT exp claim support for expiring health cards
- [ ] Test the library with Inferno Smart Health Card Test Kit: https://github.com/inferno-framework/smart-health-cards-test-kit
- [ ] Create detailed documentation with practical examples for common use cases
- [ ] Configure build system for both CommonJS and ES modules with proper TypeScript declarations
- [x] Derive kid from public key per RFC7638 (JWK Thumbprint) and remove reliance on user-supplied keyId for signing

## Reference Implementation Analysis

Based on analysis of existing implementations:

### From [DVCI Health Cards Walkthrough](https://github.com/dvci/health-cards-walkthrough):
- FHIR Bundle structure and minification process
- Verifiable Credential format with proper `@context` and type definitions
- JWS payload structure and encoding methods
- QR code chunking strategy for large payloads

### From [SmartHealthCard C# Implementation](https://github.com/angusmillar/SmartHealthCard):
- Certificate management patterns
- JWKS provider interface design  
- Error handling hierarchy
- Validation framework structure
- Multi-chunk QR code handling

### SMART Health Cards Specification Requirements:
- W3C Verifiable Credentials format compliance
- FHIR R4 bundle structure requirements
- ES256 signature algorithm usage
- QR code format with 'shc:/' prefix
- DEFLATE compression for payload optimization
- JWKS endpoint discovery and validation

## Official Validator Testing Results

**Keep testing with [SMART Health Cards Dev Tools](https://github.com/smart-on-fhir/health-cards-dev-tools) v1.3.0-2**

### How to Run Validation Tests:

1. **Setup Official Validator:**
   ```bash
   cd health-cards-dev-tools
   npm run build
   ```

2. **Generate Test Files:**
   ```bash
   node test-with-validator.ts        # Complete validation with PNG QR codes
   ```

3. **Check the output from the test-with-validator for test commands**
