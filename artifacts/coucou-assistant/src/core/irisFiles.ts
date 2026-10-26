import type { AttachmentInfo } from './irisTypes';

const DB_NAME = 'iris-private-files';
const STORE_NAME = 'attachments';
const DB_VERSION = 1;

interface StoredAttachment extends AttachmentInfo {
  blob: Blob;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('O armazenamento local de ficheiros não está disponível neste navegador.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o arquivo local.'));
  });
}

export async function saveLocalAttachment(file: File): Promise<AttachmentInfo> {
  const info: AttachmentInfo = {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
  };
  const db = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ ...info, blob: file } satisfies StoredAttachment);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível guardar o ficheiro neste dispositivo.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('O armazenamento do ficheiro foi cancelado.'));
  }).finally(() => db.close());

  return info;
}

export async function openLocalAttachment(id: string): Promise<void> {
  const db = await openDatabase();
  const attachment = await new Promise<StoredAttachment | undefined>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as StoredAttachment | undefined);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível ler o ficheiro local.'));
  }).finally(() => db.close());

  if (!attachment) throw new Error('Este ficheiro já não está guardado neste dispositivo.');

  const url = URL.createObjectURL(attachment.blob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.name;
    link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function removeLocalAttachment(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível remover o ficheiro local.'));
  }).finally(() => db.close());
}