# Improved ISBN Validation

## ISBN Validation Rules

The application now performs strict validation for ISBN numbers according to these rules:

1. **ISBN-13 Format**:
   - Must be exactly 13 digits
   - Must begin with '978' or '979'
   - Checksum digit must be valid (calculated according to ISBN-13 standards)

2. **ISBN-10 Format**:
   - Must be exactly 10 digits (last character can be 'X' representing 10)
   - Checksum digit must be valid (calculated according to ISBN-10 standards)

3. **Non-Standard Formats**:
   - Custom SKUs and non-standard identifiers are allowed
   - Must be non-empty
   - If the identifier is purely numeric, it must be either 10 or 13 digits

## Implementation Details

The validation is implemented through three functions:

1. `validateISBN(isbn)`: The main validation function that:
   - Normalizes the input by removing spaces and hyphens
   - Checks if the input is all digits
   - Applies appropriate validation based on length
   - Returns validation status and error messages

2. `isValidISBN13(isbn)`: Calculates and validates the ISBN-13 checksum:
   - Uses the alternating 1-3 weights for positions 1-12
   - Verifies the check digit in position 13

3. `isValidISBN10(isbn)`: Calculates and validates the ISBN-10 checksum:
   - Uses weights 10-1 for positions 1-9
   - Handles 'X' as a check digit representing 10
   - Verifies the check digit in position 10

## User Experience

1. **Better Input Guidance**:
   - Updated placeholder text explains expected format
   - Clear error messages explain validation failures

2. **Consistent Validation**:
   - Both ISBN-10 and ISBN-13 are validated properly
   - Input normalization handles common user input variations (spaces, hyphens)

## Example Valid ISBNs

### Valid ISBN-13 Examples:
- `9780306406157` (ISBN-13 with valid checksum)
- `978-0-306-40615-7` (Same ISBN with hyphens)

### Valid ISBN-10 Examples:
- `0306406152` (ISBN-10 with valid checksum)
- `0-306-40615-2` (Same ISBN with hyphens)
- `123456789X` (ISBN-10 with 'X' as check digit)

### Valid Non-Standard Examples:
- `CUSTOM-123` (Non-numeric SKU)
- `ISBN-NA` (Text indicating no ISBN)

## Invalid ISBN Examples

### Invalid ISBN-13:
- `9780306406158` (Invalid checksum)
- `978666` (Numeric but wrong length)
- `1234567890123` (13 digits but doesn't start with 978 or 979)

### Invalid ISBN-10:
- `0306406153` (Invalid checksum)
- `123456789` (Only 9 digits)

## Technical Implementation

The checksum validation algorithms follow the international ISBN standard:

- **ISBN-13**: Each of the first 12 digits is multiplied by an alternating weight (1 or 3). The sum is calculated, and the check digit should make this sum modulo 10 equal to 0.

- **ISBN-10**: Each of the first 9 digits is multiplied by a weight (10 down to 2). The check digit (which can be 'X' representing 10) is added, and the sum should be modulo 11 equal to 0.
