import crypto from 'crypto';

export class FileEncryption {
  static ALGORITHM = 'aes-256-gcm';
  static IV_LENGTH = 12; // For GCM
  static SALT_LENGTH = 16;
  static TAG_LENGTH = 16;
  static KEY_LENGTH = 32; // 256 bits
  static ITERATIONS = 100000;

  /**
   * Generate a random encryption key
   * @returns {string} Base64 encoded encryption key
   */
  static generateKey() {
    return crypto.randomBytes(this.KEY_LENGTH).toString('base64');
  }

  /**
   * Derive a key from a password using PBKDF2
   * @param {string} password - The password to derive the key from
   * @param {Buffer} salt - The salt to use
   * @returns {Buffer} The derived key
   */
  static deriveKey(password, salt) {
    return crypto.pbkdf2Sync(
      password,
      salt,
      this.ITERATIONS,
      this.KEY_LENGTH,
      'sha256'
    );
  }

  /**
   * Encrypt a file buffer
   * @param {Buffer} fileBuffer - The file buffer to encrypt
   * @param {string} key - The encryption key (base64)
   * @returns {Object} The encrypted data and metadata
   */
  static encrypt(fileBuffer, key) {
    try {
      // Generate IV and salt
      const iv = crypto.randomBytes(this.IV_LENGTH);
      const salt = crypto.randomBytes(this.SALT_LENGTH);

      // Convert key to buffer if it's base64
      const keyBuffer = Buffer.from(key, 'base64');

      // Create cipher
      const cipher = crypto.createCipheriv(this.ALGORITHM, keyBuffer, iv);

      // Encrypt the file
      const encrypted = Buffer.concat([
        cipher.update(fileBuffer),
        cipher.final()
      ]);

      // Get auth tag
      const tag = cipher.getAuthTag();

      // Combine all components
      const result = Buffer.concat([
        salt,
        iv,
        tag,
        encrypted
      ]);

      return {
        encryptedData: result,
        metadata: {
          salt: salt.toString('base64'),
          iv: iv.toString('base64'),
          tag: tag.toString('base64'),
          algorithm: this.ALGORITHM
        }
      };
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt file');
    }
  }

  /**
   * Decrypt a file buffer
   * @param {Buffer} encryptedBuffer - The encrypted file buffer
   * @param {string} key - The encryption key (base64)
   * @returns {Buffer} The decrypted file buffer
   */
  static decrypt(encryptedBuffer, key) {
    try {
      // Extract components
      const salt = encryptedBuffer.slice(0, this.SALT_LENGTH);
      const iv = encryptedBuffer.slice(this.SALT_LENGTH, this.SALT_LENGTH + this.IV_LENGTH);
      const tag = encryptedBuffer.slice(
        this.SALT_LENGTH + this.IV_LENGTH,
        this.SALT_LENGTH + this.IV_LENGTH + this.TAG_LENGTH
      );
      const encrypted = encryptedBuffer.slice(this.SALT_LENGTH + this.IV_LENGTH + this.TAG_LENGTH);

      // Convert key to buffer if it's base64
      const keyBuffer = Buffer.from(key, 'base64');

      // Create decipher
      const decipher = crypto.createDecipheriv(this.ALGORITHM, keyBuffer, iv);
      decipher.setAuthTag(tag);

      // Decrypt the file
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);

      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt file');
    }
  }

  /**
   * Verify file integrity using hash
   * @param {Buffer} fileBuffer - The file buffer to verify
   * @param {string} expectedHash - The expected hash
   * @returns {boolean} Whether the file is valid
   */
  static verifyIntegrity(fileBuffer, expectedHash) {
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    return hash === expectedHash;
  }
}