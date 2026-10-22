export interface StoredFile {
  key: string;
  url: string;
}

export abstract class StorageService {
  abstract putPublic(key: string, body: Buffer, contentType: string): Promise<StoredFile>;
}
