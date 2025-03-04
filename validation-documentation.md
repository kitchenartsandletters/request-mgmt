# ISBN and Order Number Validation

## ISBN Validation Rules

The application now validates ISBN numbers according to these rules:

1. **Standard 13-digit ISBN**:
   - Must begin with either '978' or '979'
   - Must be exactly 13 digits long
   - Spaces and hyphens are automatically removed before validation

2. **Legacy ISBN and Custom SKUs**:
   - All non-empty values are accepted
   - For 13-digit numbers that don't start with 978/979, the system allows them but could show a warning

## Order Number Validation Rules

Order numbers are validated according to these rules:

1. **Standard 5-digit Order Number**:
   - Must be exactly 5 digits
   - No alpha characters allowed

2. **Extended Order Number**:
   - More than 5 digits
   - First digit must be a "1"

3. **Draft Order Number**:
   - Must begin with "D"
   - Followed by any number of numeric digits

## Implementation Details

The validation is implemented through two helper functions:

1. `validateISBN(isbn)`: Returns an object with a `valid` property and optional `error` or `warning` message.

2. `validateOrderNumber(orderNumber)`: Returns an object with a `valid` property and optional `error` message.

These functions are called from the appropriate form submission handlers:

- `request_submission`: Validates ISBN numbers when creating new requests
- `required_fields_submission`: Validates order numbers in status update forms
- `mark_as_ordered_submission`: Validates order numbers when marking a request as ordered

## User Experience Improvements

1. **Informative Error Messages**:
   - Clear, specific error messages explain the validation requirements

2. **Helpful Placeholder Text**:
   - Updated placeholder text in form fields guides users to enter correctly formatted values

3. **Pre-processing**:
   - Spaces and hyphens in ISBNs are automatically removed before validation

## Example Valid Values

### Valid ISBN Examples:
- `9781234567890` (Standard 13-digit ISBN starting with 978)
- `9791234567890` (Standard 13-digit ISBN starting with 979)
- `978-1-234-56789-0` (Hyphenated ISBN, normalized before validation)
- `123456789X` (Legacy ISBN)
- `CUSTOM-123` (Custom SKU)

### Valid Order Number Examples:
- `12345` (5-digit order number)
- `123456` (Extended order number starting with 1)
- `10001234` (Extended order number starting with 1)
- `D123` (Draft order number)
- `D9876543` (Draft order number)
