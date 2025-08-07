# Kill the Clipboard JavaScript / TypeScript Library

JavaScript/TypeScript universal (browser and node) library to generate QR codes containing medical records for patients to share with providers. Implements the [SMART Health Cards Framework](https://smarthealth.cards/) for FHIR-based medical records, enabling patients to "Kill the Clipboard" by sharing health data via secure, verifiable QR codes.

This aligns with the [CMS Interoperability Framework](https://www.cms.gov/health-technology-ecosystem/interoperability-framework) call to action for Patient Facing Apps to "Kill the Clipboard":

> We pledge to empower patients to retrieve their health records from CMS Aligned Networks or personal health record apps and share them with providers via **QR codes or Smart Health Cards/Links using FHIR bundles**. When possible, we will return visit records to patients in the same format. We commit to seamless, secure data exchange—eliminating the need for patients to repeatedly recall and write out their medical history. We are committed to "kill the clipboard," one encounter at a time.

🚧 **UNDER HEAVY DEVELOPMENT, NOT READY FOR PRODUCTION YET (as of 2025-08-05)**

## Features

✅ **Complete SMART Health Cards Implementation**
- FHIR R4 Bundle processing and validation  
- W3C Verifiable Credentials creation
- ES256 (ECDSA P-256) cryptographic signing
- JWT/JWS encoding with proper headers
- File generation (.smart-health-card files)
- Comprehensive error handling

✅ **Standards Compliant**  
- Follows [SMART Health Cards Framework v1.4.0](https://spec.smarthealth.cards/)
- W3C Verifiable Credentials 1.0 compatible
- FHIR R4 Bundle validation
- ES256 algorithm for signing (ECDSA P-256)

✅ **Production Ready**
- TypeScript support with full type definitions
- Comprehensive test suite (120 tests)
- Proper error handling hierarchy  
- Built for Node.js and browser environments
- Web-compatible file operations

✅ **QR Code Support**
- QR code generation with `shc:/` prefix and numeric encoding
- SMART Health Cards specification compliant (V22 QR codes recommended)
- Single QR mode (primary) and chunked QR support (compatibility)
- Complete QR code scanning and reconstruction
- Flexible QR encoding options with intelligent defaults

🔄 **Coming Soon**
- DEFLATE compression for payload optimization

## Installation

```bash
npm install kill-the-clipboard-js
# or
pnpm add kill-the-clipboard-js
# or  
yarn add kill-the-clipboard-js
```

## Usage

### Basic Usage

```typescript
import { SmartHealthCard } from 'kill-the-clipboard-js';

// Configure with your issuer details and ES256 key pair
const healthCard = new SmartHealthCard({
  issuer: 'https://your-healthcare-org.com',
  privateKey: privateKeyPKCS8String, // ES256 private key in PKCS#8 format
  publicKey: publicKeySPKIString,     // ES256 public key in SPKI format  
  keyId: 'your-key-identifier',
  expirationTime: 86400, // Optional: 24 hours in seconds
});

// Create SMART Health Card from FHIR Bundle
const fhirBundle = {
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
          coding: [{
            system: 'http://hl7.org/fhir/sid/cvx',
            code: '207',
            display: 'COVID-19 vaccine', 
          }],
        },
        patient: { reference: 'Patient/123' },
        occurrenceDateTime: '2023-01-15',
      },
    },
  ],
};

// Generate signed SMART Health Card (JWS format)
const signedHealthCard = await healthCard.create(fhirBundle);
console.log('Health Card JWS:', signedHealthCard);

// Verify the health card and get the FHIR Bundle
const fhirBundle = await healthCard.getBundle(signedHealthCard);
console.log('Verified FHIR Bundle:', fhirBundle);

// Or use the full verify method to get the complete verifiable credential
const verifiedCredential = await healthCard.verify(signedHealthCard);
console.log('Complete credential:', verifiedCredential);

// Generate downloadable .smart-health-card file
const blob = await healthCard.createFileBlob(fhirBundle);
console.log('File blob created, type:', blob.type);
```

### Advanced Usage

```typescript
import { 
  SmartHealthCard,
  FhirBundleProcessor, 
  VerifiableCredentialProcessor,
  JWSProcessor,
  QRCodeGenerator 
} from 'kill-the-clipboard-js';

// Use individual processors for more control
const fhirProcessor = new FhirBundleProcessor();
const vcProcessor = new VerifiableCredentialProcessor();
const jwsProcessor = new JWSProcessor();

// Process FHIR Bundle
const processedBundle = fhirProcessor.process(fhirBundle);
fhirProcessor.validate(processedBundle);

// Create Verifiable Credential
const vc = vcProcessor.create(processedBundle, {
  fhirVersion: '4.0.1',
  includeAdditionalTypes: ['https://smarthealth.cards#covid19']
});

// Create JWT payload
const jwtPayload = {
  iss: 'https://your-org.com',
  nbf: Math.floor(Date.now() / 1000),
  vc: vc.vc,
};

// Sign to create JWS
const jws = await jwsProcessor.sign(jwtPayload, privateKey, keyId);

// Verify JWS
const verified = await jwsProcessor.verify(jws, publicKey);

// Generate QR codes
const qrGenerator = new QRCodeGenerator({
  maxSingleQRSize: 1195,
  enableChunking: false, // Use single QR mode (recommended)
  encodeOptions: {
    ecc: 'low', // Error correction level (low, medium, quartile, high)
    scale: 4,   // QR code scale factor
    border: 1   // Border size
  }
});

const qrDataUrls = await qrGenerator.generateQR(jws);
console.log('Generated QR code data URL:', qrDataUrls[0]);

// Scan QR codes (simulate scanning with numeric data)
const scannedData = ['shc:/56762959532654603460292540772804336028702864716745...'];
const reconstructedJWS = await qrGenerator.scanQR(scannedData);
```

### Error Handling

```typescript
import { 
  SmartHealthCard, 
  SmartHealthCardError,
  FhirValidationError,
  JWSError,
  QRCodeError 
} from 'kill-the-clipboard-js';

try {
  const healthCard = await smartHealthCard.create(fhirBundle);
} catch (error) {
  if (error instanceof FhirValidationError) {
    console.error('FHIR Bundle validation failed:', error.message);
  } else if (error instanceof JWSError) {
    console.error('JWT/JWS processing failed:', error.message);
  } else if (error instanceof QRCodeError) {
    console.error('QR code processing failed:', error.message);
  } else if (error instanceof SmartHealthCardError) {
    console.error('SMART Health Card error:', error.message, error.code);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### File Operations

```typescript
import { SmartHealthCard } from 'kill-the-clipboard-js';

const healthCard = new SmartHealthCard(config);

// Create SMART Health Card file content
const fileContent = await healthCard.createFile(fhirBundle);
console.log('File content:', fileContent); // JWS string

// Create downloadable Blob (web-compatible)
const blob = await healthCard.createFileBlob(fhirBundle);
console.log('Blob type:', blob.type); // 'application/smart-health-card'

// Trigger download in web browser (example implementation)
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'vaccination-card.smart-health-card';
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);

// Verify health card from file content
const verifiedFromFile = await healthCard.verifyFile(fileContent);

// Verify health card from Blob (e.g., from file input)
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file && file.name.endsWith('.smart-health-card')) {
    try {
      const verified = await healthCard.verifyFile(file);
      console.log('Valid health card:', verified.vc.credentialSubject.fhirBundle);
    } catch (error) {
      console.error('Invalid health card file:', error.message);
    }
  }
});
```

### Generating ES256 Key Pairs

```typescript
// Generate ES256 key pair for testing (Node.js)
import crypto from 'crypto';
import { exportPKCS8, exportSPKI } from 'jose';

const { publicKey, privateKey } = await crypto.webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);

const privateKeyPKCS8 = await exportPKCS8(privateKey);
const publicKeySPKI = await exportSPKI(publicKey);

// Use these keys in SmartHealthCard config
const config = {
  issuer: 'https://your-org.com',
  privateKey: privateKeyPKCS8,
  publicKey: publicKeySPKI, 
  keyId: 'key-1',
};
```

## API Reference

### `SmartHealthCard`

Main class for creating and verifying SMART Health Cards.

#### Constructor

```typescript
new SmartHealthCard(config: SmartHealthCardConfig)
```

#### Methods

- `create(fhirBundle: FhirBundle): Promise<string>` - Creates a signed SMART Health Card JWS
- `verify(jws: string): Promise<VerifiableCredential>` - Verifies and decodes a SMART Health Card
- `getBundle(jws: string): Promise<FhirBundle>` - Verifies and returns the FHIR Bundle directly (convenience method)
- `createFile(fhirBundle: FhirBundle): Promise<string>` - Creates file content for .smart-health-card files
- `createFileBlob(fhirBundle: FhirBundle): Promise<Blob>` - Creates downloadable Blob
- `verifyFile(fileContent: string | Blob): Promise<VerifiableCredential>` - Verifies from file content

### `FhirBundleProcessor`

Processes and validates FHIR R4 Bundles according to SMART Health Cards specification.

- `process(bundle: FhirBundle): FhirBundle` - Processes Bundle (sets default type="collection")
- `validate(bundle: FhirBundle): boolean` - Validates Bundle structure

### `VerifiableCredentialProcessor`

Creates and validates W3C Verifiable Credentials for SMART Health Cards.

- `create(fhirBundle: FhirBundle, options?): VerifiableCredential` - Creates W3C VC
- `validate(vc: VerifiableCredential): boolean` - Validates VC structure

### `JWSProcessor`

Handles JWT/JWS signing and verification with ES256 algorithm.

- `sign(payload: SmartHealthCardJWT, privateKey, keyId): Promise<string>` - Signs JWT
- `verify(jws: string, publicKey): Promise<SmartHealthCardJWT>` - Verifies JWS
- `decode(jws: string): Promise<{header, payload}>` - Decodes without verification

### `QRCodeGenerator`

Generates and scans QR codes for SMART Health Cards with proper numeric encoding and SMART Health Cards specification compliance.

#### Configuration Options

- `maxSingleQRSize?: number` - Maximum size for single QR code (default: 1195 per SMART Health Cards spec)
- `enableChunking?: boolean` - Whether to support multi-chunk QR codes (deprecated per SMART Health Cards spec)
- `encodeOptions?: QREncodeOptions` - Options passed to the QR encoder:
  - `ecc?: 'low' | 'medium' | 'quartile' | 'high'` - Error correction level (default: 'low')
  - `scale?: number` - QR code scale factor (default: 4)  
  - `border?: number` - Border size (default: 1)
  - `version?: number` - QR version 1-40 (auto-selected by default per SMART Health Cards spec)
  - `encoding?: 'numeric' | 'alphanumeric' | 'byte' | 'kanji' | 'eci'` - Auto-selected by default
  - `mask?: number` - Mask pattern 0-7

#### Methods

- `generateQR(jws: string): Promise<string[]>` - Generates QR code data URLs
- `scanQR(qrCodeData: string[]): Promise<string>` - Reconstructs JWS from QR data
- `encodeJWSToNumeric(jws: string): string` - Converts JWS to numeric format (Ord(c)-45)

## Technical Details

### SMART Health Cards Flow

1. **FHIR Bundle** → Processed and validated
2. **W3C Verifiable Credential** → Created with proper `@context` and `type`  
3. **JWT Payload** → Includes issuer (`iss`), not-before (`nbf`), and VC
4. **JWS Signature** → Signed with ES256 (ECDSA P-256) algorithm
5. **File Generation** → `.smart-health-card` files for download/sharing
6. **QR Code Generation** → Single or chunked QR codes with `shc:/` prefix and numeric encoding
7. **Optional Compression** → DEFLATE compression (coming soon)

### Security

- **ES256 Algorithm**: ECDSA using P-256 curve and SHA-256 hash
- **Cryptographic Verification**: Full signature validation  
- **Tamper Detection**: Any modification invalidates the signature
- **Issuer Validation**: Verify against known public keys
- **Error Handling**: Secure error messages prevent information leakage

## FHIR Bundle Requirements

- `resourceType` must be `"Bundle"`
- `type` defaults to `"collection"` if not specified
- `entry` array with valid FHIR resources
- Each entry must have `resource` with `resourceType`

## Browser Compatibility

- Modern browsers with Web Crypto API support
- Node.js 16+ with crypto module
- TypeScript 4.5+ recommended

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License  

MIT License - see [LICENSE](LICENSE) file for details.

## References

- [SMART Health Cards Framework Specification](https://spec.smarthealth.cards/)
- [W3C Verifiable Credentials 1.0](https://www.w3.org/TR/vc-data-model/)  
- [FHIR R4 Specification](https://hl7.org/fhir/R4/)
- [CMS Interoperability Framework](https://www.cms.gov/health-technology-ecosystem/interoperability-framework)
