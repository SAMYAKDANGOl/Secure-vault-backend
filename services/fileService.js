import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { FileEncryption } from '../utils/encryption.js';

export class FileService {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async getFiles(userId) {
    try {
      const { data: files, error } = await this.supabase
        .from('files')
        .select('*')
        .eq('user_id', userId)
        .eq('deleted', false)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return files.map(file => ({
        id: file.id,
        name: file.original_name,
        size: file.size,
        type: file.mime_type,
        uploadedAt: file.created_at,
        encrypted: file.encrypted,
        shared: file.shared,
        accessControl: typeof file.access_control === 'string' ? JSON.parse(file.access_control) : file.access_control,
        downloadCount: file.download_count || 0,
        lastAccessed: file.last_accessed
      }));
    } catch (error) {
      throw new Error(`Failed to get files: ${error.message}`);
    }
  }

  async uploadFile(file, userId, options = {}) {
    try {
      // Read file buffer
      const fileBuffer = await fs.readFile(file.path);

      // Calculate file hash
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      let encryptedData = null;
      let encryptionKey = null;
      let encryptionMetadata = null;

      // Encrypt file if requested
      if (options.encryption) {
        encryptionKey = FileEncryption.generateKey();
        const encryptionResult = FileEncryption.encrypt(fileBuffer, encryptionKey);
        encryptedData = encryptionResult.encryptedData;
        encryptionMetadata = encryptionResult.metadata;
      }

      // Upload to storage
      const fileExt = path.extname(file.originalname);
      const fileName = `${userId}/${crypto.randomUUID()}${fileExt}`;

      const { data: storageData, error: storageError } = await this.supabase.storage
        .from('secure-files')
        .upload(fileName, encryptedData || fileBuffer, {
          contentType: file.mimetype,
          cacheControl: '3600',
        });

      if (storageError) throw storageError;

      // Create file record
      const { data: fileRecord, error: dbError } = await this.supabase
        .from('files')
        .insert({
          user_id: userId,
          original_name: file.originalname,
          stored_name: fileName,
          size: file.size,
          mime_type: file.mimetype,
          encrypted: options.encryption || false,
          encryption_key: encryptionKey,
          encryption_metadata: encryptionMetadata ? JSON.stringify(encryptionMetadata) : null,
          file_hash: fileHash,
          shared: false,
          access_control: options.accessControl || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (dbError) throw dbError;

      return fileRecord;
    } catch (error) {
      throw new Error(`File upload failed: ${error.message}`);
    }
  }

  async downloadFile(fileId, userId) {
    try {
      // Get file metadata
      const { data: file, error: fileError } = await this.supabase
        .from('files')
        .select('*')
        .eq('id', fileId)
        .eq('deleted', false)
        .single();

      if (fileError || !file) {
        throw new Error('File not found');
      }

      // Check access
      if (file.user_id !== userId && !file.shared) {
        throw new Error('Access denied');
      }

      // Check if download is enabled
      if (!file.download_enabled) {
        throw new Error('File download is disabled');
      }

      // Get file from storage
      const { data: fileData, error: storageError } = await this.supabase.storage
        .from('secure-files')
        .download(file.stored_name);

      if (storageError) throw storageError;

      // Decrypt if needed
      let fileBuffer = fileData;
      if (file.encrypted && file.encryption_key) {
        fileBuffer = FileEncryption.decrypt(fileData, file.encryption_key);
        
        // Verify integrity
        if (!FileEncryption.verifyIntegrity(fileBuffer, file.file_hash)) {
          throw new Error('File integrity check failed');
        }
      }

      // Update download stats
      await this.supabase
        .from('files')
        .update({
          download_count: file.download_count + 1,
          last_accessed: new Date().toISOString()
        })
        .eq('id', fileId);

      return {
        buffer: fileBuffer,
        metadata: {
          name: file.original_name,
          type: file.mime_type,
          size: file.size
        }
      };
    } catch (error) {
      throw new Error(`File download failed: ${error.message}`);
    }
  }

  async previewFile(fileId, userId) {
    try {
      // Get file metadata
      const { data: file, error: fileError } = await this.supabase
        .from('files')
        .select('*')
        .eq('id', fileId)
        .eq('deleted', false)
        .single();

      if (fileError || !file) {
        throw new Error('File not found');
      }

      // Check access
      if (file.user_id !== userId && !file.shared) {
        throw new Error('Access denied');
      }

      // Check if preview is enabled
      if (!file.preview_enabled) {
        throw new Error('File preview is disabled');
      }

      // Check if file type supports preview
      const previewableTypes = ['image/', 'text/', 'application/pdf'];
      const canPreview = previewableTypes.some(type => file.mime_type.startsWith(type));
      if (!canPreview) {
        throw new Error('File type not supported for preview');
      }

      // Get file from storage
      const { data: fileData, error: storageError } = await this.supabase.storage
        .from('secure-files')
        .download(file.stored_name);

      if (storageError) throw storageError;

      // Decrypt if needed
      let fileBuffer = fileData;
      if (file.encrypted && file.encryption_key) {
        fileBuffer = FileEncryption.decrypt(fileData, file.encryption_key);
        
        // Verify integrity
        if (!FileEncryption.verifyIntegrity(fileBuffer, file.file_hash)) {
          throw new Error('File integrity check failed');
        }
      }

      // Generate preview token
      const previewToken = crypto.randomBytes(32).toString('hex');
      const tokenExpiresAt = new Date(Date.now() + 3600000); // 1 hour

      // Update preview stats and token
      await this.supabase
        .from('files')
        .update({
          preview_count: file.preview_count + 1,
          last_previewed: new Date().toISOString(),
          preview_token: previewToken,
          preview_token_expires_at: tokenExpiresAt.toISOString()
        })
        .eq('id', fileId);

      return {
        buffer: fileBuffer,
        metadata: {
          name: file.original_name,
          type: file.mime_type,
          size: file.size,
          previewToken
        }
      };
    } catch (error) {
      throw new Error(`File preview failed: ${error.message}`);
    }
  }

  async deleteFile(fileId, userId) {
    try {
      // Get file metadata
      const { data: file, error: fileError } = await this.supabase
        .from('files')
        .select('*')
        .eq('id', fileId)
        .eq('user_id', userId)
        .eq('deleted', false)
        .single();

      if (fileError || !file) {
        throw new Error('File not found or access denied');
      }

      // Soft delete
      const { error: updateError } = await this.supabase
        .from('files')
        .update({
          deleted: true,
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', fileId);

      if (updateError) throw updateError;

      return true;
    } catch (error) {
      throw new Error(`File deletion failed: ${error.message}`);
    }
  }

  async shareFile(fileId, userId, shareOptions) {
    try {
      // Get file metadata
      const { data: file, error: fileError } = await this.supabase
        .from('files')
        .select('*')
        .eq('id', fileId)
        .eq('user_id', userId)
        .eq('deleted', false)
        .single();

      if (fileError || !file) {
        throw new Error('File not found or access denied');
      }

      // Create access control object
      const accessControl = {
        allowedUsers: shareOptions.allowedUsers || [],
        allowedRoles: shareOptions.allowedRoles || [],
        permissions: shareOptions.permissions || ['read'],
        expiresAt: shareOptions.expiresAt ? new Date(shareOptions.expiresAt).toISOString() : null,
        createdBy: userId,
        createdAt: new Date().toISOString()
      };

      // Update file
      const { error: updateError } = await this.supabase
        .from('files')
        .update({
          shared: true,
          access_control: JSON.stringify(accessControl),
          updated_at: new Date().toISOString()
        })
        .eq('id', fileId);

      if (updateError) throw updateError;

      return accessControl;
    } catch (error) {
      throw new Error(`File sharing failed: ${error.message}`);
    }
  }
}