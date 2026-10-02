export class StorageError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class FileNotFoundError extends StorageError {
  constructor(message = 'The requested file does not exist') {
    super('FILE_NOT_FOUND', message, 404);
    this.name = 'FileNotFoundError';
  }
}

export class InvalidStorageIdError extends StorageError {
  constructor(message = 'Invalid storage identifier') {
    super('INVALID_STORAGE_ID', message, 400);
    this.name = 'InvalidStorageIdError';
  }
}

export class ConfigurationError extends StorageError {
  constructor(message: string) {
    super('CONFIGURATION_ERROR', message, 500);
    this.name = 'ConfigurationError';
  }
}
